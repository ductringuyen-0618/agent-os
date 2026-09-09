import type { GithubRepo } from '@agentos/shared'
import { execa } from 'execa'

export const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/

export class GhUnavailableError extends Error {
  hint: string
  constructor(hint: string) {
    super('gh not available')
    this.hint = hint
  }
}

export class InvalidRepoNameError extends Error {
  constructor(repo: string) {
    super(`invalid repo name: ${repo}`)
  }
}

export function ghBin(): string {
  return process.env.AGENTOS_GH_BIN ?? 'gh'
}

/**
 * fake-gh ships as a plain .js file with no OS-level executable bit or
 * Windows shim, so on any platform we run it via the current Node binary
 * instead of trying to exec it directly. The real `gh` (no .js suffix,
 * resolved via cross-spawn/PATH) is unaffected. Mirrors
 * packages/kernel/src/process/processManager.ts's resolveCommand for
 * fake-claude.
 */
function resolveCommand(bin: string): {
  command: string
  prefixArgs: string[]
} {
  if (bin.endsWith('.js')) {
    return { command: process.execPath, prefixArgs: [bin] }
  }
  return { command: bin, prefixArgs: [] }
}

function gh(args: string[]) {
  const { command, prefixArgs } = resolveCommand(ghBin())
  return execa(command, [...prefixArgs, ...args], { reject: false })
}

export function assertValidRepoName(repo: string): void {
  if (!REPO_NAME_RE.test(repo)) throw new InvalidRepoNameError(repo)
}

const UNAVAILABLE_HINT =
  'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.'

export async function checkGhAvailable(): Promise<{
  available: boolean
  hint?: string
}> {
  const result = await gh(['auth', 'status'])
  if (result.exitCode === 0) return { available: true }
  return { available: false, hint: UNAVAILABLE_HINT }
}

async function requireGh(): Promise<void> {
  const status = await checkGhAvailable()
  if (!status.available)
    throw new GhUnavailableError(status.hint ?? UNAVAILABLE_HINT)
}

interface RawGhRepo {
  nameWithOwner: string
  description: string | null
  defaultBranchRef: { name: string } | null
  isPrivate: boolean
  updatedAt: string
}

export async function listRepos(query?: string): Promise<GithubRepo[]> {
  await requireGh()
  const result = await gh([
    'repo',
    'list',
    '--limit',
    '100',
    '--json',
    'nameWithOwner,description,defaultBranchRef,isPrivate,updatedAt',
    ...(query ? ['--query', query] : []),
  ])
  if (result.exitCode !== 0) throw new GhUnavailableError(UNAVAILABLE_HINT)
  const raw = JSON.parse(result.stdout) as RawGhRepo[]
  return raw.map((r) => ({
    nameWithOwner: r.nameWithOwner,
    description: r.description,
    defaultBranch: r.defaultBranchRef?.name ?? 'main',
    isPrivate: r.isPrivate,
    updatedAt: r.updatedAt,
  }))
}

/**
 * The HTTPS clone URL for `owner/name`, as GitHub reports it. Stored in the
 * project yaml so every later git operation has a real remote, not a bare
 * owner/name that git would treat as a local path.
 */
export async function getCloneUrl(repo: string): Promise<string> {
  assertValidRepoName(repo)
  await requireGh()
  const result = await gh([
    'repo',
    'view',
    repo,
    '--json',
    'url',
    '--jq',
    '.url',
  ])
  if (result.exitCode !== 0) throw new GhUnavailableError(UNAVAILABLE_HINT)
  const url = result.stdout.trim()
  if (!url) throw new GhUnavailableError(UNAVAILABLE_HINT)
  return url.endsWith('.git') || url.startsWith('file:') || url.startsWith('/')
    ? url
    : `${url}.git`
}

export async function getDefaultBranch(repo: string): Promise<string> {
  assertValidRepoName(repo)
  await requireGh()
  const result = await gh(['api', `repos/${repo}`, '--jq', '.default_branch'])
  if (result.exitCode !== 0) throw new GhUnavailableError(UNAVAILABLE_HINT)
  return result.stdout.trim()
}

export async function readRepoFile(
  repo: string,
  filePath: string,
): Promise<string | null> {
  assertValidRepoName(repo)
  await requireGh()
  const result = await gh([
    'api',
    `repos/${repo}/contents/${filePath}`,
    '--jq',
    '.content',
  ])
  if (result.exitCode !== 0) return null
  return Buffer.from(result.stdout.replace(/\n/g, ''), 'base64').toString(
    'utf8',
  )
}

export interface PrChecks {
  /** Checks still queued or running. */
  pending: string[]
  /** Checks that failed, with the URL of the run or job that produced them. */
  failed: Array<{ name: string; url: string }>
  /** Checks that passed (skipped and neutral count as passed). */
  passed: string[]
}

/** `owner/name` from a clone URL or an already-bare name. */
export function repoSlug(repo: string): string {
  const m = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(repo)
  return m ? m[1] : repo
}

interface RawCheck {
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  detailsUrl?: string
  targetUrl?: string
}

/**
 * The pull request's check state as GitHub reports it. The workflow polls
 * this until nothing is pending: a request is not shipped until CI says so.
 */
export async function getPrChecks(
  repo: string,
  number: number,
): Promise<PrChecks> {
  const slug = repoSlug(repo)
  assertValidRepoName(slug)
  await requireGh()
  const result = await gh([
    'pr',
    'view',
    String(number),
    '--repo',
    slug,
    '--json',
    'statusCheckRollup',
  ])
  if (result.exitCode !== 0) throw new GhUnavailableError(UNAVAILABLE_HINT)
  const raw = JSON.parse(result.stdout) as { statusCheckRollup?: RawCheck[] }
  const out: PrChecks = { pending: [], failed: [], passed: [] }
  for (const c of raw.statusCheckRollup ?? []) {
    const name = c.name ?? c.context ?? 'check'
    const url = c.detailsUrl ?? c.targetUrl ?? ''
    const status = (c.status ?? '').toUpperCase()
    const verdict = (c.conclusion ?? c.state ?? '').toUpperCase()
    if (status && status !== 'COMPLETED') {
      out.pending.push(name)
    } else if (
      [
        'FAILURE',
        'ERROR',
        'TIMED_OUT',
        'CANCELLED',
        'ACTION_REQUIRED',
      ].includes(verdict)
    ) {
      out.failed.push({ name, url })
    } else if (verdict === 'PENDING' || verdict === 'EXPECTED') {
      out.pending.push(name)
    } else {
      out.passed.push(name)
    }
  }
  return out
}

/** Tail of the failing steps' log for a GitHub Actions run or job URL; empty when unavailable. */
export async function getFailedJobLog(
  repo: string,
  url: string,
  maxLines = 80,
): Promise<string> {
  const m = /\/actions\/runs\/(\d+)/.exec(url)
  if (!m) return ''
  const slug = repoSlug(repo)
  assertValidRepoName(slug)
  const result = await gh(['run', 'view', m[1], '--repo', slug, '--log-failed'])
  if (result.exitCode !== 0) return ''
  const lines = result.stdout.split(/\r?\n/).filter((l) => l.trim() !== '')
  return lines.slice(-maxLines).join('\n')
}
