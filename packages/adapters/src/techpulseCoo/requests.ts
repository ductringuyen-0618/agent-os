import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AdapterContext,
  FeatureRequestPushProposalInput,
  FeatureRequestPushProposalResult,
} from '@agentos/kernel/adapters/types'
import matter from 'gray-matter'
import simpleGit from 'simple-git'
import { ensureClone } from './adapter.js'

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
