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
import { describe, expect, it } from 'vitest'
import { techpulseCooAdapter } from './adapter.js'
import { createTempTechpulseRepo } from './test-helpers.js'

function fakeCtx(clone: string, osRoot: string): AdapterContext {
  const events: unknown[] = []
  const decisions: Array<{ id: string; adapter?: string; ref?: string }> = []
  return {
    cfg: {
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
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
      createDecision: (d: any) => {
        const dec = {
          id: `d${decisions.length + 1}`,
          status: 'pending',
          createdAt: new Date().toISOString(),
          ...d,
        }
        decisions.push(dec)
        return dec
      },
      listDecisions: () => decisions,
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for WikiService
    wiki: {} as any,
    project: {
      name: 'techpulse',
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
    runId: 'run-1',
  }
}

describe('techpulseCooAdapter.sync', () => {
  it('mirrors proposals, reports dir and state.md into raw/ and emits raw.added', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const ctx = fakeCtx(cloneDir, osRoot)

    const result = await techpulseCooAdapter.sync(ctx)

    expect(result.added).toContain('proposals/001-dark-mode.md')
    expect(result.added).toContain('state.md')
    expect(result.events).toContain('raw.added')
    const mirrored = readFileSync(
      path.join(osRoot, 'raw', 'techpulse', 'proposals', '001-dark-mode.md'),
      'utf8',
    )
    expect(mirrored).toContain('status: proposed')
    expect(existsSync(path.join(osRoot, 'raw', 'techpulse', 'state.md'))).toBe(
      true,
    )
  })

  it('is a no-op on the second run when nothing changed', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const ctx = fakeCtx(cloneDir, osRoot)
    await techpulseCooAdapter.sync(ctx)
    const second = await techpulseCooAdapter.sync(ctx)
    expect(second.added).toEqual([])
    expect(second.changed).toEqual([])
  })
})

describe('techpulseCooAdapter.sync — decisions', () => {
  it('creates a pending decision for a newly-proposed proposal', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const ctx = fakeCtx(cloneDir, osRoot)

    await techpulseCooAdapter.sync(ctx)

    // biome-ignore lint/suspicious/noExplicitAny: fakeCtx's log stub exposes listDecisions beyond the AdapterContext type
    const decisions = (ctx.log as any).listDecisions()
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      adapter: 'techpulse-coo',
      ref: 'proposals/001-dark-mode.md',
      status: 'pending',
      title: 'Add dark mode toggle',
    })
    expect(decisions[0].body).toContain('Why this increases engagement')
    expect(decisions[0].body).toContain('Effort estimate')
  })

  it('raises the decision for a proposal an earlier crashed sync had already mirrored', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const ctx = fakeCtx(cloneDir, osRoot)
    // Simulate a previous sync that mirrored the file but died before ensureDecision.
    const rawDir = path.join(osRoot, 'raw', 'techpulse', 'proposals')
    mkdirSync(rawDir, { recursive: true })
    writeFileSync(
      path.join(rawDir, '001-dark-mode.md'),
      readFileSync(
        path.join(cloneDir, 'docs/missions/coo/proposals/001-dark-mode.md'),
        'utf8',
      ),
    )

    const result = await techpulseCooAdapter.sync(ctx)

    expect(result.added).not.toContain('proposals/001-dark-mode.md')
    // biome-ignore lint/suspicious/noExplicitAny: fakeCtx's log stub exposes listDecisions beyond the AdapterContext type
    expect((ctx.log as any).listDecisions()).toHaveLength(1)
  })

  it('does not duplicate a decision on a second sync', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const ctx = fakeCtx(cloneDir, osRoot)
    await techpulseCooAdapter.sync(ctx)
    await techpulseCooAdapter.sync(ctx)
    // biome-ignore lint/suspicious/noExplicitAny: fakeCtx's log stub exposes listDecisions beyond the AdapterContext type
    expect((ctx.log as any).listDecisions()).toHaveLength(1)
  })

  it('emits proposal.changed when a mirrored status transitions', async () => {
    const { cloneDir, seedDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const ctx = fakeCtx(cloneDir, osRoot)
    await techpulseCooAdapter.sync(ctx)

    const seedGit = (await import('simple-git')).default(seedDir)
    const proposalPath = path.join(
      seedDir,
      'docs/missions/coo/proposals/001-dark-mode.md',
    )
    writeFileSync(
      proposalPath,
      readFileSync(proposalPath, 'utf8').replace(
        'status: proposed',
        'status: approved',
      ),
    )
    await seedGit.add('.')
    await seedGit.commit('approve')
    await seedGit.push('origin', 'main')

    const result = await techpulseCooAdapter.sync(ctx)
    expect(result.events).toContain('proposal.changed')
  })
})
