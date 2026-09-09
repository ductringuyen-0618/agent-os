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
