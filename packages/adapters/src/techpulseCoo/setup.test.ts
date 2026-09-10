import {
  chmodSync,
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
import { afterEach, describe, expect, it } from 'vitest'
import { SETUP_BRANCH, cooSetup, setupFilesMissing } from './setup.js'

/** A bare "remote" whose seed commit has no COO layout at all. */
async function createBareRepoWithoutLayout() {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-setup-'))
  const bareDir = path.join(root, 'bare.git')
  const seedDir = path.join(root, 'seed')
  await simpleGit().raw(['init', '--bare', '--initial-branch=main', bareDir])
  mkdirSync(seedDir, { recursive: true })
  const git = simpleGit(seedDir)
  await git.raw(['init', '--initial-branch=main'])
  await git.addConfig('user.name', 'Test User')
  await git.addConfig('user.email', 'test@example.com')
  writeFileSync(path.join(seedDir, 'README.md'), '# app\n')
  await git.add('.')
  await git.commit('seed')
  await git.addRemote('origin', bareDir)
  await git.push('origin', 'main')
  return { root, bareDir }
}

function makeCtx(repo: string, clone: string) {
  const events: unknown[] = []
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
      repo,
      clone,
      base_branch: 'main',
      options: {},
      setup: {
        adapter: 'coo-missions',
        branch: SETUP_BRANCH,
        status: 'pending',
      },
    },
  }
  return { ctx, events }
}

function writeFakeGh(root: string): string {
  const scriptPath = path.join(root, 'fake-gh.js')
  writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2)',
      "if (args[0] === 'pr' && args[1] === 'create') {",
      "  console.log('https://github.com/owner/sandbox/pull/12')",
      '  process.exit(0)',
      '}',
      'process.exit(1)',
      '',
    ].join('\n'),
    'utf8',
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

const originalGhBin = process.env.AGENTOS_GH_BIN
afterEach(() => {
  if (originalGhBin === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
    delete process.env.AGENTOS_GH_BIN
  } else {
    process.env.AGENTOS_GH_BIN = originalGhBin
  }
})

async function configureClone(clone: string) {
  const git = simpleGit(clone)
  await git.addConfig('user.name', 'Test User')
  await git.addConfig('user.email', 'test@example.com')
}

describe('cooSetup on a remote without a pull request host', () => {
  it('commits the whole layout straight to the base branch and reports applied', async () => {
    const { root, bareDir } = await createBareRepoWithoutLayout()
    const clone = path.join(root, 'clone')
    const { ctx, events } = makeCtx(bareDir, clone)
    expect(await cooSetup.isReady(ctx)).toBe(false)
    await configureClone(clone)

    expect(await setupFilesMissing(ctx)).toEqual([
      'docs/missions/coo/proposals/.gitkeep',
      'docs/missions/coo/reports/.gitkeep',
      'docs/missions/coo/state.md',
      'docs/missions/coo/README.md',
    ])
    const result = await cooSetup.openSetupPr(ctx)
    expect(result).toEqual({ url: '', number: 0, applied: true })

    const verify = path.join(root, 'verify')
    await simpleGit().clone(bareDir, verify)
    expect(existsSync(path.join(verify, 'docs/missions/coo/state.md'))).toBe(
      true,
    )
    const readme = readFileSync(
      path.join(verify, 'docs/missions/coo/README.md'),
      'utf8',
    )
    expect(readme).toContain('# COO missions')
    expect(readme).toContain('`building`')
    expect(
      events.some((e) => (e as { type: string }).type === 'git.push'),
    ).toBe(true)
    expect(await cooSetup.isReady(ctx)).toBe(true)
    // Second run: nothing left to add.
    expect(await cooSetup.openSetupPr(ctx)).toMatchObject({
      skipped: expect.stringContaining('already in place'),
    })
  })
})

describe('cooSetup on a GitHub remote', () => {
  it('pushes a setup branch, opens a PR through gh, and leaves the base branch untouched', async () => {
    const { root, bareDir } = await createBareRepoWithoutLayout()
    const clone = path.join(root, 'clone')
    // Clone from the local bare repo first, then pretend it lives on GitHub:
    // pushes go to origin (the bare repo), `gh pr create` goes to the fake.
    await simpleGit().clone(bareDir, clone)
    await configureClone(clone)
    process.env.AGENTOS_GH_BIN = writeFakeGh(root)
    const { ctx } = makeCtx('https://github.com/owner/sandbox.git', clone)

    const result = await cooSetup.openSetupPr(ctx)
    expect(result).toEqual({
      url: 'https://github.com/owner/sandbox/pull/12',
      number: 12,
    })

    const verify = path.join(root, 'verify')
    await simpleGit().clone(bareDir, verify)
    const branches = await simpleGit(verify).branch(['-r'])
    expect(branches.all).toContain(`origin/${SETUP_BRANCH}`)
    // main still has no layout: that is what the PR is for.
    expect(existsSync(path.join(verify, 'docs/missions/coo/state.md'))).toBe(
      false,
    )
    await simpleGit(verify).checkout(SETUP_BRANCH)
    expect(existsSync(path.join(verify, 'docs/missions/coo/state.md'))).toBe(
      true,
    )
    expect(existsSync(path.join(verify, 'docs/missions/coo/README.md'))).toBe(
      true,
    )
    // The working clone is back on base afterwards.
    expect((await simpleGit(clone).branch()).current).toBe('main')
  })

  it('only adds what is missing when part of the layout exists', async () => {
    const { root, bareDir } = await createBareRepoWithoutLayout()
    const clone = path.join(root, 'clone')
    await simpleGit().clone(bareDir, clone)
    await configureClone(clone)
    mkdirSync(path.join(clone, 'docs/missions/coo/proposals'), {
      recursive: true,
    })
    writeFileSync(path.join(clone, 'docs/missions/coo/proposals/.gitkeep'), '')
    writeFileSync(path.join(clone, 'docs/missions/coo/state.md'), '# state\n')
    const git = simpleGit(clone)
    await git.add('.')
    await git.commit('partial layout')
    await git.push('origin', 'main')
    process.env.AGENTOS_GH_BIN = writeFakeGh(root)
    const { ctx } = makeCtx('https://github.com/owner/sandbox.git', clone)

    expect(await setupFilesMissing(ctx)).toEqual([
      'docs/missions/coo/reports/.gitkeep',
      'docs/missions/coo/README.md',
    ])
    expect(await cooSetup.openSetupPr(ctx)).toMatchObject({ number: 12 })
  })
})
