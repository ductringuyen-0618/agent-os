import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { KernelConfig } from '../config.js'
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

describe('AdapterHost.getCachedProjects', () => {
  it('is empty before loadProjects has ever been called', () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stubs for EventLog/WikiService, unused here
    const host = new AdapterHost(makeCfg(osRoot), {} as any, {} as any, {})
    expect(host.getCachedProjects()).toEqual([])
  })

  it('reflects the result of the most recent loadProjects call', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: ${AGENTOS_CLONES}/techpulse\nbase_branch: main\noptions:\n  proposals_path: docs/missions/coo/proposals\n  state_path: docs/missions/coo/state.md\n  reports_path: docs/missions/coo/reports\n',
    )
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stubs for EventLog/WikiService, unused here
    const host = new AdapterHost(makeCfg(osRoot), {} as any, {} as any, {})

    expect(host.getCachedProjects()).toEqual([])
    const loaded = await host.loadProjects()
    expect(host.getCachedProjects()).toEqual(loaded)
    expect(host.getCachedProjects()[0].name).toBe('techpulse')
  })
})
