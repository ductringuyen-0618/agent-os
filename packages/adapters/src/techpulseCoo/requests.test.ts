import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AdapterContext } from '@agentos/kernel/adapters/types'
import simpleGit from 'simple-git'
import { describe, expect, it } from 'vitest'
import { bootstrapCooLayout, pushProposal } from './requests.js'
import { createTempTechpulseRepo } from './test-helpers.js'

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
