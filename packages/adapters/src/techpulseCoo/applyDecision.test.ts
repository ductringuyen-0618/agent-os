import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AdapterContext } from '@agentos/kernel/adapters/types'
import simpleGit from 'simple-git'
import { describe, expect, it } from 'vitest'
import { techpulseCooAdapter } from './adapter.js'
import { createTempTechpulseRepo } from './test-helpers.js'

function fakeCtx(
  clone: string,
  osRoot: string,
  // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for WikiService.writePage
  wiki: { writePage: (i: any) => Promise<any> },
) {
  const resolved: Array<{ id: string; status: string; error?: string }> = []
  // biome-ignore lint/suspicious/noExplicitAny: test event capture
  const events: any[] = []
  return {
    ctx: {
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
        resolveDecision: (id: string, status: string, error?: string) => {
          const d = { id, status, error }
          resolved.push(d)
          return d
        },
        // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
      } as any,
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for WikiService
      wiki: wiki as any,
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
    } as AdapterContext,
    resolved,
    events,
  }
}

describe('techpulseCooAdapter.applyDecision', () => {
  it('flips status, commits, pushes, writes approval output and wiki page', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    // biome-ignore lint/suspicious/noExplicitAny: test capture of writePage calls
    const wikiWrites: any[] = []
    const { ctx, resolved, events } = fakeCtx(cloneDir, osRoot, {
      writePage: async (i) => {
        wikiWrites.push(i)
        return { result: 'created', path: i.path }
      },
    })
    const decision = {
      id: 'd1',
      title: 'Add dark mode toggle',
      body: '',
      adapter: 'techpulse-coo',
      ref: path.join('proposals', '001-dark-mode.md'),
      status: 'approved',
      createdAt: new Date().toISOString(),
    }

    // biome-ignore lint/suspicious/noExplicitAny: decision is missing optional fields not exercised by this test
    await techpulseCooAdapter.applyDecision(decision as any, ctx)

    expect(resolved).toEqual([
      { id: 'd1', status: 'approved', error: undefined },
    ])
    expect(events.some((e) => e.type === 'git.commit')).toBe(true)
    expect(events.some((e) => e.type === 'git.push')).toBe(true)
    expect(wikiWrites).toHaveLength(1)
    expect(wikiWrites[0].path).toBe(
      'projects/techpulse/proposals/001-dark-mode.md',
    )

    // A fixed path.join(osRoot, '..', 'verify') always resolves to the same
    // os.tmpdir()-relative location regardless of osRoot's unique mkdtemp
    // suffix, so a leftover dir from a prior run collides with `git clone`
    // ("destination path already exists") -- give verify its own unique
    // temp dir instead (git clones fine into an existing empty directory).
    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const pushed = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/001-dark-mode.md'),
      'utf8',
    )
    expect(pushed).toContain('status: approved')
    expect(pushed).toContain('attempts: 0')

    const approvalsDir = path.join(osRoot, 'output', 'approvals')
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(approvalsDir)
    expect(files.some((f) => f.endsWith('-001-dark-mode.md'))).toBe(true)
  })

  it('resolves the decision as error and alerts on push failure', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const { ctx, resolved, events } = fakeCtx(cloneDir, osRoot, {
      writePage: async (i) => ({ result: 'created', path: i.path }),
    })
    // break the remote so push fails
    await simpleGit(cloneDir).removeRemote('origin')
    await simpleGit(cloneDir).addRemote(
      'origin',
      path.join(osRoot, 'does-not-exist.git'),
    )
    const decision = {
      id: 'd1',
      title: 'x',
      body: '',
      adapter: 'techpulse-coo',
      ref: path.join('proposals', '001-dark-mode.md'),
      status: 'rejected',
      createdAt: new Date().toISOString(),
    }

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: decision is missing optional fields not exercised by this test
      techpulseCooAdapter.applyDecision(decision as any, ctx),
    ).rejects.toThrow()

    expect(resolved[0].status).toBe('error')
    expect(events.some((e) => e.type === 'ops.alert')).toBe(true)
  })
})
