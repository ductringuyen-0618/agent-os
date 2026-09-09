import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { AdapterHost } from '../adapters/adapterHost.js'
import type { KernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { Scheduler } from '../scheduler/scheduler.js'
import { WikiService } from '../wiki/wikiService.js'
import { ProjectService, deriveProjectName } from './projectService.js'

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
