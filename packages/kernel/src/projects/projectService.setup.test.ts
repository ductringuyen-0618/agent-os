import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AdapterHost } from '../adapters/adapterHost.js'
import type { ProjectAdapter } from '../adapters/types.js'
import type { KernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { Scheduler } from '../scheduler/scheduler.js'
import { WikiService } from '../wiki/wikiService.js'
import { ProjectService } from './projectService.js'

const fakeGhBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tools/fake-gh/bin.js',
)

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

function seedRoutinesFile(osRoot: string) {
  mkdirSync(osRoot, { recursive: true })
  writeFileSync(
    path.join(osRoot, 'routines.yaml'),
    [
      'defaults:',
      '  model: sonnet',
      '  permission_mode: default',
      '  allowed_tools: [Read]',
      '  max_attempts: 1',
      '  timeout_ms: 5000',
      'routines: []',
      '',
    ].join('\n'),
  )
}

/**
 * A coo-missions stand-in whose readiness answers are scripted: each
 * isReady call pops the next value (last one repeats).
 */
function setupRegistry(opts: {
  ready: boolean[]
  open?: ProjectAdapter['setup'] extends infer S
    ? S extends { openSetupPr: infer F }
      ? F
      : never
    : never
}) {
  const syncCalls: string[] = []
  const readiness = [...opts.ready]
  const adapter: ProjectAdapter = {
    name: 'coo-missions',
    sync: async () => {
      syncCalls.push('sync')
      return { added: [], changed: [], events: [], hasCooLayout: true }
    },
    applyDecision: async () => {},
    setup: {
      defaultOptions: { proposals_path: 'docs/missions/coo/proposals' },
      isReady: async () =>
        readiness.length > 1
          ? (readiness.shift() as boolean)
          : (readiness[0] ?? true),
      openSetupPr:
        opts.open ??
        (async () => ({
          url: 'https://github.com/octo/widgets/pull/7',
          number: 7,
        })),
    },
  }
  return { registry: { 'coo-missions': adapter }, syncCalls }
}

function makeService(registry: Record<string, ProjectAdapter>): {
  service: ProjectService
  scheduler: Scheduler
  log: EventLog
  osRoot: string
} {
  const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
  seedRoutinesFile(osRoot)
  process.env.AGENTOS_GH_BIN = fakeGhBin
  const cfg = makeCfg(osRoot)
  const log = new EventLog(cfg.dbPath)
  const wiki = new WikiService(osRoot, log)
  const adapters = new AdapterHost(cfg, log, wiki, registry)
  const scheduler = new Scheduler(cfg, log, async () => {})
  return {
    service: new ProjectService(cfg, adapters, scheduler, log),
    scheduler,
    log,
    osRoot,
  }
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

describe('ProjectService setup via pull request', () => {
  it('adds a project without an adapter, opens the setup PR, registers no sync routine', async () => {
    const { registry, syncCalls } = setupRegistry({ ready: [false] })
    const { service, scheduler, osRoot } = makeService(registry)

    const result = await service.addProject({ repo: 'octo/widgets' })
    expect(result.project.adapter).toBeUndefined()
    expect(result.project.setup).toMatchObject({
      adapter: 'coo-missions',
      status: 'pending',
      pr_url: 'https://github.com/octo/widgets/pull/7',
      pr_number: 7,
    })
    expect(result.setup).toEqual({
      status: 'pending',
      prUrl: 'https://github.com/octo/widgets/pull/7',
      prNumber: 7,
    })
    expect(syncCalls).toEqual([])
    expect(
      scheduler.list().some((l) => l.routine.name === 'widgets-sync'),
    ).toBe(false)
    const yaml = readFileSync(
      path.join(osRoot, 'projects', 'widgets.yaml'),
      'utf8',
    )
    expect(yaml).not.toMatch(/^adapter:/m)
    expect(yaml).toContain('pr_number: 7')
  })

  it('activates the adapter and the sync routine once the setup PR is merged', async () => {
    // Not ready when added; ready on the next list.
    const { registry, syncCalls } = setupRegistry({ ready: [false, true] })
    const { service, log, osRoot } = makeService(registry)
    await service.addProject({ repo: 'octo/widgets' })
    expect(syncCalls).toEqual([])

    const list = await service.listProjects()
    expect(list[0].config.adapter).toBe('coo-missions')
    expect(list[0].config.setup?.status).toBe('ready')
    expect(list[0].config.setup?.pr_number).toBe(7)
    expect(list[0].routines).toEqual(['widgets-sync'])
    expect(readFileSync(path.join(osRoot, 'routines.yaml'), 'utf8')).toContain(
      'widgets-sync',
    )
    expect(
      log.listEvents({ types: ['project.ready'] }).map((e) => e.payload),
    ).toEqual([{ project: 'widgets', adapter: 'coo-missions' }])
  })

  it('activates immediately when the layout is committed directly (no PR host)', async () => {
    const { registry, syncCalls } = setupRegistry({
      ready: [false],
      open: async () => ({ url: '', number: 0, applied: true }),
    })
    const { service, scheduler } = makeService(registry)

    const result = await service.addProject({ repo: 'octo/widgets' })
    expect(result.project.adapter).toBe('coo-missions')
    expect(result.setup?.status).toBe('ready')
    expect(syncCalls).toEqual(['sync'])
    expect(
      scheduler.list().some((l) => l.routine.name === 'widgets-sync'),
    ).toBe(true)
  })

  it('keeps the project pending with a note when opening the PR fails', async () => {
    const { registry } = setupRegistry({
      ready: [false],
      open: async () => {
        throw new Error('gh: permission denied')
      },
    })
    const { service } = makeService(registry)

    const result = await service.addProject({ repo: 'octo/widgets' })
    expect(result.setup).toMatchObject({
      status: 'pending',
      error: 'gh: permission denied',
    })
    expect(result.project.setup?.note).toBe('gh: permission denied')
    const list = await service.listProjects()
    expect(list[0].config.adapter).toBeUndefined()
    // A later explicit run can succeed and clears the note.
    const again = await service.runSetup('widgets')
    expect(again.status).toBe('pending')
    expect(again.error).toBe('gh: permission denied')
  })

  it('opens a completion PR for a project that already has its adapter', async () => {
    const { registry } = setupRegistry({ ready: [true] })
    const { service } = makeService(registry)
    await service.addProject({ repo: 'octo/widgets', adapter: 'coo-missions' })

    const outcome = await service.runSetup('widgets')
    expect(outcome).toEqual({
      status: 'ready',
      prUrl: 'https://github.com/octo/widgets/pull/7',
      prNumber: 7,
    })
    const list = await service.listProjects()
    expect(list[0].config.adapter).toBe('coo-missions')
    expect(list[0].config.setup).toMatchObject({
      status: 'ready',
      pr_number: 7,
    })
  })

  it('still activates an explicitly named adapter on add, with no setup PR', async () => {
    const { registry, syncCalls } = setupRegistry({ ready: [false] })
    const { service } = makeService(registry)

    const result = await service.addProject({
      repo: 'octo/widgets',
      adapter: 'coo-missions',
    })
    expect(result.project.adapter).toBe('coo-missions')
    expect(result.setup).toBeUndefined()
    expect(syncCalls).toEqual(['sync'])
  })
})
