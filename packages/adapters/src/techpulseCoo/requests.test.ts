import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  writeFileSync as writeFileSyncFs,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AdapterContext } from '@agentos/kernel/adapters/types'
import simpleGit from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapCooLayout,
  markShipped,
  openPullRequest,
  pushProposal,
  writeReport,
} from './requests.js'
import { createTempTechpulseRepo } from './test-helpers.js'

function writeFakeGh(root: string): string {
  const scriptPath = path.join(root, 'fake-gh.js')
  writeFileSyncFs(
    scriptPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'pr' && args[1] === 'create') {
  console.log('https://github.com/owner/sandbox/pull/42')
  process.exit(0)
}
process.exit(1)
`,
    'utf8',
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

function fakeCtx(clone: string) {
  // biome-ignore lint/suspicious/noExplicitAny: test event capture
  const events: any[] = []
  const ctx: AdapterContext = {
    cfg: {
      osRoot: mkdtempSync(path.join(tmpdir(), 'agentos-os-')),
      runtimeDir: 'unused',
      dbPath: ':memory:',
      claudeBin: 'true',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'info',
    },
    log: {
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
      append: (e: any) => {
        events.push(e)
        return { id: events.length, ts: new Date().toISOString(), ...e }
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: not exercised by these tests
    wiki: {} as any,
    project: {
      name: 'sandbox',
      adapter: 'techpulse-coo',
      repo: 'unused',
      clone,
      base_branch: 'main',
      options: {
        proposals_path: 'docs/missions/coo/proposals',
        state_path: 'docs/missions/coo/state.md',
        reports_path: 'docs/missions/coo/reports',
      },
    },
    runId: 'wf-1',
  }
  return { ctx, events }
}

async function createEmptyRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-empty-'))
  const bareDir = path.join(root, 'bare.git')
  const seedDir = path.join(root, 'seed')
  const cloneDir = path.join(root, 'clone')

  await simpleGit().raw(['init', '--bare', '--initial-branch=main', bareDir])
  mkdirSync(seedDir, { recursive: true })
  const seedGit = simpleGit(seedDir)
  await seedGit.raw(['init', '--initial-branch=main'])
  await seedGit.addConfig('user.name', 'Test User')
  await seedGit.addConfig('user.email', 'test@example.com')
  writeFileSync(path.join(seedDir, 'README.md'), '# empty repo\n')
  await seedGit.add('.')
  await seedGit.commit('seed')
  await seedGit.addRemote('origin', bareDir)
  await seedGit.push('origin', 'main')

  await simpleGit().clone(bareDir, cloneDir)
  const cloneGit = simpleGit(cloneDir)
  await cloneGit.addConfig('user.name', 'Test User')
  await cloneGit.addConfig('user.email', 'test@example.com')

  return { bareDir, cloneDir }
}

describe('bootstrapCooLayout', () => {
  it('reports nothing created when the layout already exists', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    const result = await bootstrapCooLayout(ctx)
    expect(result.created).toEqual([])
  })

  it('creates proposals/reports/.gitkeep and state.md when the repo has no coo layout', async () => {
    const { cloneDir } = await createEmptyRepo()
    const { ctx } = fakeCtx(cloneDir)
    const result = await bootstrapCooLayout(ctx)
    expect(result.created.sort()).toEqual(
      [
        'docs/missions/coo/proposals/.gitkeep',
        'docs/missions/coo/reports/.gitkeep',
        'docs/missions/coo/state.md',
      ].sort(),
    )
    expect(existsSync(path.join(cloneDir, 'docs/missions/coo/state.md'))).toBe(
      true,
    )
  })
})

describe('pushProposal', () => {
  it('numbers the new proposal after the highest existing one, commits, and pushes', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx, events } = fakeCtx(cloneDir)

    const result = await pushProposal(ctx, {
      slug: 'faster-search',
      title: 'Make search faster',
      proposalBody: '## What you get\nFaster search.\n',
      status: 'approved',
    })

    expect(result.file).toBe('docs/missions/coo/proposals/002-faster-search.md')
    expect(result.bootstrapped).toBe(false)
    expect(events.some((e) => e.type === 'git.commit')).toBe(true)
    expect(events.some((e) => e.type === 'git.push')).toBe(true)

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const pushed = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/002-faster-search.md'),
      'utf8',
    )
    expect(pushed).toContain('status: approved')
    expect(pushed).toContain('# Make search faster')
    expect(pushed).toContain('Faster search.')
  })

  it('bootstraps the coo layout in the same commit as the first proposal', async () => {
    const { bareDir, cloneDir } = await createEmptyRepo()
    const { ctx } = fakeCtx(cloneDir)

    const result = await pushProposal(ctx, {
      slug: 'first-feature',
      title: 'First feature',
      proposalBody: '## What you get\nSomething new.\n',
      status: 'proposed',
    })

    expect(result.file).toBe('docs/missions/coo/proposals/001-first-feature.md')
    expect(result.bootstrapped).toBe(true)

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    expect(existsSync(path.join(verifyDir, 'docs/missions/coo/state.md'))).toBe(
      true,
    )
    expect(
      existsSync(path.join(verifyDir, 'docs/missions/coo/reports/.gitkeep')),
    ).toBe(true)
    const pushed = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/001-first-feature.md'),
      'utf8',
    )
    expect(pushed).toContain('status: proposed')
  })
})

describe('openPullRequest on a non-GitHub remote', () => {
  it('pushes the branch and reports the skipped PR instead of failing', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    const git = simpleGit(cloneDir)
    await git.checkoutLocalBranch('req/no-github')
    writeFileSync(path.join(cloneDir, 'CHANGED.md'), 'change\n')
    await git.add('CHANGED.md')
    await git.commit('feat: no github')

    const result = await openPullRequest(ctx, {
      branch: 'req/no-github',
      slug: 'no-github',
      title: 'No GitHub here',
      proposalFile: 'docs/missions/coo/proposals/001-dark-mode.md',
      proposalWhatWhy: '## What you get\nSomething.',
      validationOutput: 'PASS',
      reviewOutput: 'PASS',
    })

    expect(result.url).toBe('')
    expect(result.skipped).toMatch(/not on GitHub/)
    const branches = await simpleGit(bareDir).branch()
    expect(branches.all).toContain('req/no-github')
  })
})

describe('openPullRequest', () => {
  const originalGhBin = process.env.AGENTOS_GH_BIN
  afterEach(() => {
    if (originalGhBin === undefined) {
      // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
      delete process.env.AGENTOS_GH_BIN
    } else {
      process.env.AGENTOS_GH_BIN = originalGhBin
    }
  })

  it('pushes the branch and returns the PR url/number from gh', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    // The push goes to the clone's own origin; only the PR needs GitHub.
    ctx.project.repo = 'https://github.com/owner/sandbox.git'
    process.env.AGENTOS_GH_BIN = writeFakeGh(
      mkdtempSync(path.join(tmpdir(), 'agentos-gh-')),
    )

    const git = simpleGit(cloneDir)
    await git.checkoutLocalBranch('req/faster-search')
    writeFileSync(path.join(cloneDir, 'CHANGED.md'), 'change\n')
    await git.add('CHANGED.md')
    await git.commit('feat: faster search')

    const result = await openPullRequest(ctx, {
      branch: 'req/faster-search',
      slug: 'faster-search',
      title: 'Make search faster',
      proposalFile: 'docs/missions/coo/proposals/001-dark-mode.md',
      proposalWhatWhy: '## What you get\nFaster search.',
      validationOutput: 'PASS\nall checks green',
      reviewOutput: 'PASS\nlooks good',
    })

    expect(result).toEqual({
      url: 'https://github.com/owner/sandbox/pull/42',
      number: 42,
    })

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const branches = await simpleGit(verifyDir).branch(['-r'])
    expect(branches.all).toContain('origin/req/faster-search')
  })

  it('refuses to open a PR when the body contains a secret', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    process.env.AGENTOS_GH_BIN = writeFakeGh(
      mkdtempSync(path.join(tmpdir(), 'agentos-gh-')),
    )
    const git = simpleGit(cloneDir)
    await git.checkoutLocalBranch('req/leaky')
    writeFileSync(path.join(cloneDir, 'CHANGED.md'), 'change\n')
    await git.add('CHANGED.md')
    await git.commit('feat: leaky')

    await expect(
      openPullRequest(ctx, {
        branch: 'req/leaky',
        slug: 'leaky',
        title: 'Leaky',
        proposalFile: 'docs/missions/coo/proposals/001-dark-mode.md',
        proposalWhatWhy: 'fine',
        validationOutput: 'key = AKIAABCDEFGHIJKLMNOP',
        reviewOutput: 'PASS',
      }),
    ).rejects.toThrow(/Secret/)
  })
})

describe('markShipped / writeReport', () => {
  it('flips status to shipped and writes a report, each its own commit on base_branch', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)

    const shipResult = await markShipped(
      ctx,
      'dark-mode',
      'docs/missions/coo/proposals/001-dark-mode.md',
    )
    expect(shipResult.sha).toBeTruthy()

    const reportResult = await writeReport(ctx, {
      slug: 'dark-mode',
      branch: 'req/dark-mode',
      prUrl: 'https://github.com/owner/sandbox/pull/42',
      validationOutput: 'PASS\nall green',
      reviewOutput: 'PASS\nlooks good',
    })
    expect(reportResult.file).toBe('docs/missions/coo/reports/dark-mode.md')

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const proposal = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/001-dark-mode.md'),
      'utf8',
    )
    expect(proposal).toContain('status: shipped')
    const report = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/reports/dark-mode.md'),
      'utf8',
    )
    expect(report).toContain('https://github.com/owner/sandbox/pull/42')
    expect(report).toContain('all green')
  })
})
