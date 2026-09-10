import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { AdapterHost } from '../adapters/adapterHost.js'
import type { KernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { Scheduler } from '../scheduler/scheduler.js'
import { WikiService } from '../wiki/wikiService.js'
import {
  ProjectNameCollisionError,
  ProjectNotFoundError,
  ProjectService,
  deriveProjectName,
} from './projectService.js'

// Mirrors gh.test.ts's local fakeGhBin constant (not exported from there, so
// redefined here at the same relative depth: src/projects -> repo root).
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

function makeService(osRoot: string) {
  const cfg = makeCfg(osRoot)
  const log = new EventLog(cfg.dbPath)
  const wiki = new WikiService(osRoot, log)
  const adapters = new AdapterHost(cfg, log, wiki, {})
  const scheduler = new Scheduler(cfg, log, async () => {})
  return {
    cfg,
    log,
    service: new ProjectService(cfg, adapters, scheduler, log),
  }
}

describe('deriveProjectName', () => {
  it('lower-cases and replaces non [a-z0-9-] characters', () => {
    expect(deriveProjectName('octo/My.Repo_Name')).toBe('my-repo-name')
  })
})

describe('ProjectService.writeProjectYaml', () => {
  it('writes os/projects/<name>.yaml with an unexpanded clone path', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const { service } = makeService(osRoot)
    const project = {
      name: 'widgets',
      adapter: 'techpulse-coo',
      repo: 'octo/widgets',
      clone: '${AGENTOS_CLONES}/widgets',
      base_branch: 'main',
      options: {
        proposals_path: 'docs/missions/coo/proposals',
        state_path: 'docs/missions/coo/state.md',
        reports_path: 'docs/missions/coo/reports',
      },
    }
    await service.writeProjectYaml(project)
    const written = parseYaml(
      readFileSync(path.join(osRoot, 'projects', 'widgets.yaml'), 'utf8'),
    )
    expect(written.clone).toBe('${AGENTOS_CLONES}/widgets')
    expect(written.name).toBe('widgets')
  })
})

function seedRoutinesFile(osRoot: string) {
  writeFileSync(
    path.join(osRoot, 'routines.yaml'),
    'defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 600000\nroutines: []\n',
  )
}

describe('ProjectService.addProject', () => {
  it('registers a project: writes yaml, appends the sync routine, hot-registers it, runs the first sync', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    process.env.AGENTOS_GH_BIN = fakeGhBin
    process.env.FAKE_GH_DEFAULT_BRANCH = 'main'

    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const syncCalls: string[] = []
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => {
          syncCalls.push('sync')
          return { added: [], changed: [], events: [], hasCooLayout: false }
        },
        applyDecision: async () => {},
      },
    }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    const scheduler = new Scheduler(cfg, log, async () => {})
    const service = new ProjectService(cfg, adapters, scheduler, log)

    const result = await service.addProject({ repo: 'octo/widgets' })
    // The yaml stores a real clone URL, never the bare owner/name.
    expect(result.project.repo).toBe('https://github.com/octo/widgets.git')

    expect(result.project.name).toBe('widgets')
    expect(result.project.base_branch).toBe('main')
    expect(result.sync.hasCooLayout).toBe(false)
    expect(syncCalls).toEqual(['sync'])
    expect(existsSync(path.join(osRoot, 'projects', 'widgets.yaml'))).toBe(true)
    const routinesText = readFileSync(
      path.join(osRoot, 'routines.yaml'),
      'utf8',
    )
    expect(routinesText).toContain('widgets-sync')
    expect(
      scheduler.list().some((l) => l.routine.name === 'widgets-sync'),
    ).toBe(true)
  })

  it('rejects an invalid repo name before writing anything', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    const { service } = makeService(osRoot)
    await expect(service.addProject({ repo: 'not-a-repo' })).rejects.toThrow()
    expect(existsSync(path.join(osRoot, 'projects'))).toBe(false)
  })

  it('rejects a name collision with 409-worthy error', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    process.env.AGENTOS_GH_BIN = fakeGhBin
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => ({ added: [], changed: [], events: [] }),
        applyDecision: async () => {},
      },
    }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    const scheduler = new Scheduler(cfg, log, async () => {})
    const service = new ProjectService(cfg, adapters, scheduler, log)
    await service.addProject({ repo: 'octo/widgets' })

    await expect(service.addProject({ repo: 'other/widgets' })).rejects.toThrow(
      ProjectNameCollisionError,
    )
  })

  it('keeps the written project and returns syncError when the first sync throws', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    process.env.AGENTOS_GH_BIN = fakeGhBin
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => {
          throw new Error('clone failed')
        },
        applyDecision: async () => {},
      },
    }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    const scheduler = new Scheduler(cfg, log, async () => {})
    const service = new ProjectService(cfg, adapters, scheduler, log)

    const result = await service.addProject({ repo: 'octo/widgets' })

    expect(result.syncError).toContain('clone failed')
    expect(existsSync(path.join(osRoot, 'projects', 'widgets.yaml'))).toBe(true)
  })

  it('writes a build block with inferred checks when build: true', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    process.env.AGENTOS_GH_BIN = fakeGhBin
    process.env.FAKE_GH_FILE_FIXTURE = path.join(osRoot, 'package.json.fixture')
    writeFileSync(
      process.env.FAKE_GH_FILE_FIXTURE,
      JSON.stringify({
        scripts: { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run' },
      }),
    )
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => ({ added: [], changed: [], events: [] }),
        applyDecision: async () => {},
      },
    }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    const scheduler = new Scheduler(cfg, log, async () => {})
    const service = new ProjectService(cfg, adapters, scheduler, log)

    const result = await service.addProject({
      repo: 'octo/widgets',
      build: true,
    })

    expect(result.project.build?.enabled).toBe(true)
    expect(result.project.build?.checks).toContain(
      'pnpm -r --if-present typecheck',
    )
    expect(result.project.build?.checks).toContain('pnpm -r --if-present lint')
    expect(result.project.build?.checks).toContain('pnpm -r --if-present test')
  })
})

describe('ProjectService.listProjects', () => {
  it('reports config, registered routines, lastSync and hasCooLayout', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    process.env.AGENTOS_GH_BIN = fakeGhBin
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => ({
          added: [],
          changed: [],
          events: [],
          hasCooLayout: false,
        }),
        applyDecision: async () => {},
      },
    }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    const scheduler = new Scheduler(cfg, log, async () => {})
    const service = new ProjectService(cfg, adapters, scheduler, log)
    await service.addProject({ repo: 'octo/widgets' })

    const list = await service.listProjects()

    expect(list).toHaveLength(1)
    expect(list[0].config.name).toBe('widgets')
    expect(list[0].routines).toEqual(['widgets-sync', 'widgets-coo'])
    expect(list[0].lastSync?.status).toBe('success')
    expect(list[0].hasCooLayout).toBe(false)
  })

  it('returns an empty array with no projects registered', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const { service } = makeService(osRoot)
    expect(await service.listProjects()).toEqual([])
  })
})

describe('ProjectService.removeProject', () => {
  it('deletes the project yaml, removes the routine from routines.yaml, and unregisters it live -- keeping the clone/raw mirror untouched', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    seedRoutinesFile(osRoot)
    process.env.AGENTOS_GH_BIN = fakeGhBin
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const registry = {
      'techpulse-coo': {
        name: 'techpulse-coo',
        sync: async () => ({ added: [], changed: [], events: [] }),
        applyDecision: async () => {},
      },
    }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    const scheduler = new Scheduler(cfg, log, async () => {})
    const service = new ProjectService(cfg, adapters, scheduler, log)
    await service.addProject({ repo: 'octo/widgets' })
    mkdirSync(path.join(osRoot, 'raw', 'widgets'), { recursive: true })
    writeFileSync(path.join(osRoot, 'raw', 'widgets', 'state.md'), '# kept\n')

    await service.removeProject('widgets')

    expect(existsSync(path.join(osRoot, 'projects', 'widgets.yaml'))).toBe(
      false,
    )
    expect(
      readFileSync(path.join(osRoot, 'routines.yaml'), 'utf8'),
    ).not.toContain('widgets-sync')
    expect(
      scheduler.list().some((l) => l.routine.name === 'widgets-sync'),
    ).toBe(false)
    expect(existsSync(path.join(osRoot, 'raw', 'widgets', 'state.md'))).toBe(
      true,
    )
  })

  it('throws ProjectNotFoundError for an unknown project', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const { service } = makeService(osRoot)
    await expect(service.removeProject('nope')).rejects.toThrow(
      ProjectNotFoundError,
    )
  })
})
