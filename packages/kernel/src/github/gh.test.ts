import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

const fakeGhBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tools/fake-gh/bin.js',
)
const reposFixture = path.resolve(
  path.dirname(fakeGhBin),
  'fixtures/repos.json',
)

beforeEach(() => {
  process.env.AGENTOS_GH_BIN = fakeGhBin
  // Must actually remove the key: assigning undefined coerces to the string
  // 'undefined' since process.env values are always strings, which would break
  // the "unset" semantics these tests rely on.
  // biome-ignore lint/performance/noDelete: see comment above
  delete process.env.FAKE_GH_MODE
  // biome-ignore lint/performance/noDelete: see comment above
  delete process.env.FAKE_GH_REPOS_FIXTURE
  // biome-ignore lint/performance/noDelete: see comment above
  delete process.env.FAKE_GH_DEFAULT_BRANCH
  // biome-ignore lint/performance/noDelete: see comment above
  delete process.env.FAKE_GH_FILE_FIXTURE
})

describe('assertValidRepoName', () => {
  it('accepts owner/name', async () => {
    const { assertValidRepoName } = await import('./gh.js')
    expect(() => assertValidRepoName('octo/widgets')).not.toThrow()
  })
  it('rejects anything without exactly one slash-separated owner/name', async () => {
    const { assertValidRepoName, InvalidRepoNameError } = await import(
      './gh.js'
    )
    expect(() => assertValidRepoName('not-a-repo')).toThrow(
      InvalidRepoNameError,
    )
    expect(() => assertValidRepoName('a/b/c')).toThrow(InvalidRepoNameError)
    expect(() => assertValidRepoName('a/$(rm -rf ~)')).toThrow(
      InvalidRepoNameError,
    )
  })
})

describe('checkGhAvailable', () => {
  it('is available when gh auth status exits 0', async () => {
    const { checkGhAvailable } = await import('./gh.js')
    expect(await checkGhAvailable()).toEqual({ available: true })
  })
  it('is unavailable with a hint when gh auth status fails', async () => {
    process.env.FAKE_GH_MODE = 'unavailable'
    const { checkGhAvailable } = await import('./gh.js')
    const result = await checkGhAvailable()
    expect(result.available).toBe(false)
    expect(result.hint).toMatch(/gh auth login|install/i)
  })
})

describe('listRepos', () => {
  it('parses gh repo list --json output into GithubRepo[]', async () => {
    process.env.FAKE_GH_REPOS_FIXTURE = reposFixture
    const { listRepos } = await import('./gh.js')
    const repos = await listRepos()
    expect(repos).toEqual([
      {
        nameWithOwner: 'octo/widgets',
        description: 'Widget factory',
        defaultBranch: 'main',
        isPrivate: false,
        updatedAt: '2026-09-01T00:00:00Z',
      },
      {
        nameWithOwner: 'octo/gadgets',
        description: null,
        defaultBranch: 'trunk',
        isPrivate: true,
        updatedAt: '2026-08-15T00:00:00Z',
      },
    ])
  })
  it('throws GhUnavailableError when gh is not usable', async () => {
    process.env.FAKE_GH_MODE = 'unavailable'
    const { listRepos, GhUnavailableError } = await import('./gh.js')
    await expect(listRepos()).rejects.toThrow(GhUnavailableError)
  })
})

describe('getDefaultBranch', () => {
  it('reads default_branch via gh api', async () => {
    process.env.FAKE_GH_DEFAULT_BRANCH = 'develop'
    const { getDefaultBranch } = await import('./gh.js')
    expect(await getDefaultBranch('octo/widgets')).toBe('develop')
  })
  it('rejects an invalid repo name before ever spawning gh', async () => {
    const { getDefaultBranch, InvalidRepoNameError } = await import('./gh.js')
    await expect(getDefaultBranch('nope')).rejects.toThrow(InvalidRepoNameError)
  })
})

describe('readRepoFile', () => {
  it('returns decoded content when the file exists', async () => {
    const fixtureDir = path.dirname(reposFixture)
    const fixture = path.join(fixtureDir, 'package.json.fixture')
    await import('node:fs').then((fs) =>
      fs.writeFileSync(fixture, '{"scripts":{"test":"vitest"}}'),
    )
    process.env.FAKE_GH_FILE_FIXTURE = fixture
    const { readRepoFile } = await import('./gh.js')
    expect(await readRepoFile('octo/widgets', 'package.json')).toContain(
      '"test":"vitest"',
    )
  })
  it('returns null when the file is absent (404), without throwing', async () => {
    const { readRepoFile } = await import('./gh.js')
    expect(await readRepoFile('octo/widgets', 'package.json')).toBeNull()
  })
})
