import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  AdapterContext,
  FeatureRequestOpenPrInput,
  FeatureRequestOpenPrResult,
  FeatureRequestPushProposalInput,
  FeatureRequestPushProposalResult,
  FeatureRequestWriteReportInput,
  FeatureRequestWriteReportResult,
} from '@agentos/kernel/adapters/types'
import { SecretDetectedError, findSecrets } from '@agentos/kernel/wiki/redact'
import { execa } from 'execa'
import matter from 'gray-matter'
import simpleGit from 'simple-git'
import { ensureClone } from './adapter.js'
import { setStatus } from './frontmatter.js'

interface TechpulseCooOptions {
  proposals_path: string
  state_path: string
  reports_path: string
}

function opts(ctx: AdapterContext): TechpulseCooOptions {
  return ctx.project.options as unknown as TechpulseCooOptions
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  )
}

const posix = (p: string): string => p.replace(/\\/g, '/')

export interface BootstrapCooLayoutResult {
  /** repo-relative, posix paths this call created (empty if the layout already existed) */
  created: string[]
}

const STATE_PLACEHOLDER = '# COO state\n\nAll quiet.\n'

/**
 * Ensures the clone exists and is fresh on base_branch, then creates any
 * of docs/missions/coo/{proposals,reports}/.gitkeep and state.md that are
 * missing (spec §4.3 -- the first feature request on a repo with no COO
 * layout creates it). Idempotent: does nothing on a repo that already has
 * the layout, and is always called before pushProposal writes the
 * proposal file so both land in one commit.
 */
export async function bootstrapCooLayout(
  ctx: AdapterContext,
): Promise<BootstrapCooLayoutResult> {
  await ensureClone(ctx)
  const o = opts(ctx)
  const created: string[] = []

  for (const dirOpt of [o.proposals_path, o.reports_path]) {
    const dirAbs = path.join(ctx.project.clone, dirOpt)
    const gitkeep = path.join(dirAbs, '.gitkeep')
    if (!(await pathExists(gitkeep))) {
      await mkdir(dirAbs, { recursive: true })
      await writeFile(gitkeep, '', 'utf8')
      created.push(posix(`${dirOpt}/.gitkeep`))
    }
  }

  const stateAbs = path.join(ctx.project.clone, o.state_path)
  if (!(await pathExists(stateAbs))) {
    await mkdir(path.dirname(stateAbs), { recursive: true })
    await writeFile(stateAbs, STATE_PLACEHOLDER, 'utf8')
    created.push(posix(o.state_path))
  }

  return { created }
}

async function nextProposalNumber(ctx: AdapterContext): Promise<number> {
  const dir = path.join(ctx.project.clone, opts(ctx).proposals_path)
  const entries = await readdir(dir).catch(() => [] as string[])
  const numbers = entries
    .map((f) => /^(\d{3,})-/.exec(f)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number)
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
}

/**
 * Writes docs/missions/coo/proposals/<NNN>-<slug>.md (NNN computed here,
 * authoritatively, from the clone's own directory listing -- never trusted
 * from agent output), bootstraps the layout if needed, and commits+pushes
 * both in one commit to base_branch (spec §4.3, §5.2 step 2).
 */
export async function pushProposal(
  ctx: AdapterContext,
  input: FeatureRequestPushProposalInput,
): Promise<FeatureRequestPushProposalResult> {
  const bootstrap = await bootstrapCooLayout(ctx)
  const o = opts(ctx)
  const number = await nextProposalNumber(ctx)
  const filename = `${String(number).padStart(3, '0')}-${input.slug}.md`
  const relPath = posix(path.join(o.proposals_path, filename))
  const absPath = path.join(ctx.project.clone, relPath)

  const frontmatter = {
    title: input.title,
    status: input.status,
    attempts: 0,
    branch: null as string | null,
  }
  const content = matter.stringify(
    `# ${input.title}\n\n${input.proposalBody.trim()}\n`,
    frontmatter,
  )
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, 'utf8')

  const git = simpleGit(ctx.project.clone)
  await git.add([...bootstrap.created, relPath])
  const subject = `feat(coo): propose ${input.slug}`
  const commitResult = await git.commit(
    `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
  )
  ctx.log.append({
    type: 'git.commit',
    runId: ctx.runId,
    payload: { slug: input.slug, sha: commitResult.commit, message: subject },
  })
  await git.push('origin', ctx.project.base_branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug: input.slug, branch: ctx.project.base_branch },
  })

  return {
    file: relPath,
    sha: commitResult.commit,
    bootstrapped: bootstrap.created.length > 0,
  }
}

function ghInvoke(args: string[]) {
  const bin = process.env.AGENTOS_GH_BIN ?? 'gh'
  // Mirrors ProcessManager's resolveCommand: a fake gh shipped as a plain
  // .js test double has no OS-level executable bit on every platform, so
  // run it through the current Node binary instead of exec'ing it directly.
  if (bin.endsWith('.js')) return execa(process.execPath, [bin, ...args])
  return execa(bin, args)
}

function buildPrBody(input: FeatureRequestOpenPrInput): string {
  return [
    '## What you get / Why start this now',
    input.proposalWhatWhy.trim(),
    '',
    '## Validation',
    input.validationOutput.trim() || '(no validation output recorded)',
    '',
    '## Review',
    input.reviewOutput.trim() || '(no review output recorded)',
    '',
    '---',
    `Proposal: ${input.proposalFile}`,
    '',
    'Co-Authored-By: Claude via agent-os <noreply@anthropic.com>',
  ].join('\n')
}

/**
 * Pushes the agent-built branch, then opens a PR via `gh pr create` (spec
 * §5.2 step 7). The PR body is scanned with findSecrets before gh ever
 * runs (spec §5.3) -- a hit throws and gh is never invoked.
 */
export async function openPullRequest(
  ctx: AdapterContext,
  input: FeatureRequestOpenPrInput,
): Promise<FeatureRequestOpenPrResult> {
  const body = buildPrBody(input)
  const secrets = findSecrets(body)
  if (secrets.length > 0) throw new SecretDetectedError(secrets)

  const git = simpleGit(ctx.project.clone)
  await git.push('origin', input.branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug: input.slug, branch: input.branch },
  })

  const bodyDir = await mkdtemp(path.join(tmpdir(), 'agentos-pr-'))
  const bodyFile = path.join(bodyDir, 'body.md')
  await writeFile(bodyFile, body, 'utf8')
  try {
    const result = await ghInvoke([
      'pr',
      'create',
      '--repo',
      ctx.project.repo,
      '--base',
      ctx.project.base_branch,
      '--head',
      input.branch,
      '--title',
      `feat: ${input.title}`,
      '--body-file',
      bodyFile,
    ])
    const url = result.stdout.trim().split('\n').pop() ?? ''
    const match = /\/pull\/(\d+)/.exec(url)
    return { url, number: match ? Number(match[1]) : 0 }
  } finally {
    await rm(bodyDir, { recursive: true, force: true })
  }
}

/** Flips the proposal's frontmatter status to shipped on base_branch (spec §5.2 step 7). */
export async function markShipped(
  ctx: AdapterContext,
  slug: string,
  proposalFile: string,
): Promise<{ sha: string }> {
  const git = simpleGit(ctx.project.clone)
  await git.checkout(ctx.project.base_branch)
  await git.pull('origin', ctx.project.base_branch, ['--ff-only'])

  const absPath = path.join(ctx.project.clone, proposalFile)
  const content = await readFile(absPath, 'utf8')
  await writeFile(absPath, setStatus(content, 'shipped'), 'utf8')

  await git.add([posix(proposalFile)])
  const subject = `chore(coo): ship ${slug}`
  const commitResult = await git.commit(
    `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
  )
  ctx.log.append({
    type: 'git.commit',
    runId: ctx.runId,
    payload: { slug, sha: commitResult.commit, message: subject },
  })
  await git.push('origin', ctx.project.base_branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug, branch: ctx.project.base_branch },
  })

  return { sha: commitResult.commit }
}

/** Writes docs/missions/coo/reports/<slug>.md on base_branch (spec §5.2 step 7). */
export async function writeReport(
  ctx: AdapterContext,
  input: FeatureRequestWriteReportInput,
): Promise<FeatureRequestWriteReportResult> {
  const o = opts(ctx)
  const relPath = posix(path.join(o.reports_path, `${input.slug}.md`))
  const absPath = path.join(ctx.project.clone, relPath)
  const content = [
    `# Report: ${input.slug}`,
    '',
    `- branch: ${input.branch}`,
    `- pull request: ${input.prUrl}`,
    `- shipped: ${new Date().toISOString()}`,
    '',
    '## Validation',
    input.validationOutput.trim() || '(no validation output recorded)',
    '',
    '## Review',
    input.reviewOutput.trim() || '(no review output recorded)',
    '',
  ].join('\n')
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, 'utf8')

  const git = simpleGit(ctx.project.clone)
  await git.add([relPath])
  const subject = `docs(coo): report for ${input.slug}`
  const commitResult = await git.commit(
    `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
  )
  ctx.log.append({
    type: 'git.commit',
    runId: ctx.runId,
    payload: { slug: input.slug, sha: commitResult.commit, message: subject },
  })
  await git.push('origin', ctx.project.base_branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug: input.slug, branch: ctx.project.base_branch },
  })

  return { file: relPath, sha: commitResult.commit }
}
