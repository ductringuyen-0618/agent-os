import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { WikiService } from '../wiki/wikiService.js'
import { AdapterHost } from './adapterHost.js'

function makeCfg(osRoot: string): KernelConfig {
  return {
    osRoot,
    runtimeDir: path.join(osRoot, '..', '.agentos'),
    dbPath: ':memory:',
    claudeBin: 'true',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'info',
  }
}

describe('AdapterHost.loadProjects', () => {
  it('parses projects/*.yaml and expands variables', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: ${AGENTOS_CLONES}/techpulse\nbase_branch: main\noptions:\n  proposals_path: docs/missions/coo/proposals\n  state_path: docs/missions/coo/state.md\n  reports_path: docs/missions/coo/reports\n',
    )
    const cfg = makeCfg(osRoot)
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stubs for EventLog/WikiService, unused by loadProjects
    const host = new AdapterHost(cfg, {} as any, {} as any, {})

    const projects = await host.loadProjects()

    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('techpulse')
    expect(projects[0].clone).toBe(
      path.join(cfg.runtimeDir, 'clones', 'techpulse'),
    )
  })

  it('returns an empty array when no projects directory exists', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stubs for EventLog/WikiService, unused by loadProjects
    const host = new AdapterHost(makeCfg(osRoot), {} as any, {} as any, {})
    expect(await host.loadProjects()).toEqual([])
  })
})

describe('AdapterHost.sync / applyDecision — Run lifecycle', () => {
  it('creates a Run, calls the adapter, and marks it success', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: /tmp/does-not-matter\nbase_branch: main\noptions: {}\n',
    )
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const syncCalls: string[] = []
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => {
          syncCalls.push('sync')
          return { added: [], changed: [], events: [] }
        },
        applyDecision: async () => {},
      },
    }
    const host = new AdapterHost(cfg, log, wiki, registry)

    const result = await host.sync('techpulse')

    expect(result).toEqual({ added: [], changed: [], events: [] })
    expect(syncCalls).toEqual(['sync'])
    const runs = log.listRuns({ routine: 'adapter:techpulse' })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].adapter).toBe('techpulse-coo')
  })

  it('marks the Run failed when the adapter throws', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: x\nclone: /tmp/x\nbase_branch: main\noptions: {}\n',
    )
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => {
          throw new Error('boom')
        },
        applyDecision: async () => {},
      },
    }
    const host = new AdapterHost(cfg, log, wiki, registry)

    await expect(host.sync('techpulse')).rejects.toThrow('boom')
    const runs = log.listRuns({ routine: 'adapter:techpulse' })
    expect(runs[0].status).toBe('failed')
    expect(runs[0].error).toBe('boom')
  })

  it('applyDecision creates its own Run and forwards runId to the adapter', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: x\nclone: /tmp/x\nbase_branch: main\noptions: {}\n',
    )
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const seenRunIds: (string | undefined)[] = []
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => ({ added: [], changed: [], events: [] }),
        // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Decision/AdapterContext
        applyDecision: async (_d: any, ctx: any) => {
          seenRunIds.push(ctx.runId)
        },
      },
    }
    const host = new AdapterHost(cfg, log, wiki, registry)
    const decision = log.createDecision({
      title: 't',
      body: 'b',
      adapter: 'techpulse-coo',
      ref: '001.md',
    })

    await host.applyDecision({ ...decision, status: 'approved' })

    expect(seenRunIds).toHaveLength(1)
    expect(seenRunIds[0]).toBeTruthy()
    const runs = log.listRuns({ routine: 'adapter:apply-decision' })
    expect(runs[0].status).toBe('success')
  })
})
