import { access, mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  AdapterContext,
  ProjectSetupOps,
  ProjectSetupResult,
} from '@agentos/kernel/adapters/types'
import { readRepoFile, repoSlug } from '@agentos/kernel/github/gh'
import simpleGit from 'simple-git'
import { ensureClone } from './adapter.js'
import { ghInvoke } from './requests.js'

export const COO_DEFAULT_OPTIONS = {
  proposals_path: 'docs/missions/coo/proposals',
  state_path: 'docs/missions/coo/state.md',
  reports_path: 'docs/missions/coo/reports',
}

export const SETUP_BRANCH = 'agentos/coo-setup'

interface CooPaths {
  proposals_path: string
  state_path: string
  reports_path: string
}

function paths(ctx: AdapterContext): CooPaths {
  const o = ctx.project.options as Partial<CooPaths>
  return {
    proposals_path: o.proposals_path ?? COO_DEFAULT_OPTIONS.proposals_path,
    state_path: o.state_path ?? COO_DEFAULT_OPTIONS.state_path,
    reports_path: o.reports_path ?? COO_DEFAULT_OPTIONS.reports_path,
  }
}

const posix = (p: string): string => p.replace(/\\/g, '/')

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  )
}

function isGithub(repo: string): boolean {
  return /github\.com[/:]/.test(repo)
}

function stateTemplate(projectName: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return [
    `# ${projectName} COO -- State`,
    '',
    'Shipped: 0/0',
    '',
    '## Log',
    `- ${day}: connected to agent-os; no proposals yet.`,
    '',
  ].join('\n')
}

function readmeTemplate(projectName: string, p: CooPaths): string {
  const dir = posix(path.dirname(p.state_path))
  return [
    '# COO missions',
    '',
    `This folder is the contract between \`${projectName}\` and agent-os. A`,
    'Chief Operating Officer agent (the "COO") proposes features here, a human',
    'approves or rejects them from the agent-os dashboard, and either agent-os',
    'or the COO routine builds what was approved and reports back. Nothing in',
    'this folder is application code.',
    '',
    '## Layout',
    '',
    `- \`${posix(p.proposals_path)}/NNN-<slug>.md\` -- one proposal per file, numbered in`,
    '  order of creation. The YAML frontmatter carries `title`, `status`,',
    '  `attempts` and `branch`; the body explains what you get, why now, the',
    '  problem, the proposed solution, effort, a validation contract and risks.',
    `- \`${posix(p.reports_path)}/<slug>.md\` -- written when a proposal ships: branch,`,
    '  pull request, validation and review output.',
    `- \`${posix(p.state_path)}\` -- the COO's running log and shipped count.`,
    '',
    '## Proposal status',
    '',
    '| status | meaning |',
    '| --- | --- |',
    '| `proposed` | waiting for a human decision in agent-os |',
    '| `approved` | cleared to build; picked up by agent-os (with a build grant) or the COO routine |',
    '| `rejected` | closed, kept for the record |',
    '| `building` | agent-os is building it right now; the COO routine leaves it alone |',
    '| `shipped` | merged or ready to merge; a report exists |',
    '',
    '## How it flows',
    '',
    `1. agent-os mirrors \`${dir}/\` into its raw layer on every sync and raises a`,
    '   decision for each `proposed` file.',
    '2. Approving a decision rewrites the file to `approved` on the base branch.',
    '3. The builder works on a `req/<slug>` (agent-os) or `coo/<slug>` (COO routine)',
    '   branch, opens a pull request, waits for CI to pass, then marks the',
    '   proposal `shipped` and writes the report.',
    '',
    'Edit proposals by hand if you like; agent-os re-reads them on the next sync.',
    '',
  ].join('\n')
}

/**
 * Files the adapter needs on base_branch, with the content to create them
 * with when missing. README is part of the contract so a reader of the
 * repo understands the folder without agent-os.
 */
function requiredFiles(
  ctx: AdapterContext,
): Array<{ rel: string; content: string }> {
  const p = paths(ctx)
  const dir = posix(path.dirname(p.state_path))
  return [
    { rel: posix(path.join(p.proposals_path, '.gitkeep')), content: '' },
    { rel: posix(path.join(p.reports_path, '.gitkeep')), content: '' },
    { rel: posix(p.state_path), content: stateTemplate(ctx.project.name) },
    { rel: `${dir}/README.md`, content: readmeTemplate(ctx.project.name, p) },
  ]
}

/**
 * "Missing" means not tracked on the checked-out base branch. The working
 * tree is not enough: an earlier feature request may have left untracked
 * placeholder files in the clone that never reached the remote.
 */
async function missingFiles(
  ctx: AdapterContext,
): Promise<Array<{ rel: string; content: string }>> {
  const git = simpleGit(ctx.project.clone)
  const out: Array<{ rel: string; content: string }> = []
  for (const f of requiredFiles(ctx)) {
    const tracked = await git
      .raw(['cat-file', '-e', `HEAD:${f.rel}`])
      .then(() => true)
      .catch(() => false)
    if (!tracked) out.push(f)
  }
  return out
}

async function writeFiles(
  ctx: AdapterContext,
  files: Array<{ rel: string; content: string }>,
): Promise<void> {
  for (const f of files) {
    const abs = path.join(ctx.project.clone, f.rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, f.content, 'utf8')
  }
}

function prBody(ctx: AdapterContext, files: string[]): string {
  return [
    'agent-os connected this repository as a project and needs the COO',
    'missions layout to sync proposals, raise decisions and build approved',
    'feature requests. This pull request adds only that layout; no',
    'application code changes.',
    '',
    '## Files',
    ...files.map((f) => `- \`${f}\``),
    '',
    `Merging activates the \`coo-missions\` adapter for \`${ctx.project.name}\` in`,
    'agent-os on its next check. See `docs/missions/coo/README.md` for the',
    'contract.',
    '',
    '🤖 Opened by agent-os',
  ].join('\n')
}

/**
 * True when base_branch already carries the state file: proposals and
 * reports folders may legitimately be empty (git does not track empty
 * dirs), so the state file is the marker that the layout exists.
 */
async function isReady(ctx: AdapterContext): Promise<boolean> {
  const p = paths(ctx)
  if (isGithub(ctx.project.repo)) {
    const content = await readRepoFile(
      repoSlug(ctx.project.repo),
      posix(p.state_path),
    )
    return content !== null
  }
  await ensureClone(ctx)
  return exists(path.join(ctx.project.clone, p.state_path))
}

/**
 * Adds the missing layout files on a setup branch and opens a pull request
 * for them. On a remote without a PR host (a local bare repo, another git
 * server) the files go straight onto base_branch instead, and the result
 * says so with `applied`.
 */
async function openSetupPr(ctx: AdapterContext): Promise<ProjectSetupResult> {
  await ensureClone(ctx)
  const git = simpleGit(ctx.project.clone)
  await git.checkout(ctx.project.base_branch)
  const missing = await missingFiles(ctx)
  if (missing.length === 0) {
    return {
      url: '',
      number: 0,
      skipped: 'the COO missions layout is already in place',
    }
  }
  const rels = missing.map((f) => f.rel)
  const subject = 'chore: set up agent-os COO missions'
  const trailer =
    '\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>'

  if (!isGithub(ctx.project.repo)) {
    await writeFiles(ctx, missing)
    await git.add(rels)
    const commit = await git.commit(`${subject}${trailer}`)
    await git.push('origin', ctx.project.base_branch)
    ctx.log.append({
      type: 'git.push',
      runId: ctx.runId,
      payload: {
        project: ctx.project.name,
        branch: ctx.project.base_branch,
        sha: commit.commit,
        reason: 'setup (no PR host)',
      },
    })
    return { url: '', number: 0, applied: true }
  }

  // Start the setup branch fresh from base each time: a stale local copy
  // from an earlier attempt would otherwise carry old content.
  const local = await git.branchLocal()
  if (local.all.includes(SETUP_BRANCH))
    await git.deleteLocalBranch(SETUP_BRANCH, true)
  await git.checkoutLocalBranch(SETUP_BRANCH)
  try {
    await writeFiles(ctx, missing)
    await git.add(rels)
    await git.commit(`${subject}${trailer}`)
    await git.push(['--force', '--set-upstream', 'origin', SETUP_BRANCH])
    ctx.log.append({
      type: 'git.push',
      runId: ctx.runId,
      payload: {
        project: ctx.project.name,
        branch: SETUP_BRANCH,
        reason: 'setup',
      },
    })

    const bodyDir = await mkdtemp(path.join(tmpdir(), 'agentos-setup-'))
    const bodyFile = path.join(bodyDir, 'body.md')
    await writeFile(bodyFile, prBody(ctx, rels), 'utf8')
    try {
      const result = await ghInvoke([
        'pr',
        'create',
        '--repo',
        repoSlug(ctx.project.repo),
        '--base',
        ctx.project.base_branch,
        '--head',
        SETUP_BRANCH,
        '--title',
        subject,
        '--body-file',
        bodyFile,
      ])
      const url = result.stdout.trim().split('\n').pop() ?? ''
      const match = /\/pull\/(\d+)/.exec(url)
      return { url, number: match ? Number(match[1]) : 0 }
    } finally {
      await rm(bodyDir, { recursive: true, force: true })
    }
  } finally {
    await git.checkout(ctx.project.base_branch)
  }
}

export const cooSetup: ProjectSetupOps = {
  defaultOptions: COO_DEFAULT_OPTIONS,
  isReady,
  openSetupPr,
}

/** Exposed for tests: the files the setup PR would create for this project. */
export async function setupFilesMissing(
  ctx: AdapterContext,
): Promise<string[]> {
  return (await missingFiles(ctx)).map((f) => f.rel)
}
