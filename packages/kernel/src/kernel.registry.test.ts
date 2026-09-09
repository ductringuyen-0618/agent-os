import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectAdapter } from './adapters/types.js'
import type { KernelConfig } from './config.js'
import { createKernel } from './kernel.js'

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

describe('createKernel adapter registry', () => {
  it('routes project syncs to the injected adapter', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: ${AGENTOS_CLONES}/techpulse\nbase_branch: main\noptions: {}\n',
    )
    const fake: ProjectAdapter = {
      name: 'techpulse-coo',
      sync: vi.fn(async () => ({ added: [], changed: [], events: [] })),
      applyDecision: vi.fn(async () => {}),
    }
    const kernel = createKernel(makeCfg(osRoot), { 'techpulse-coo': fake })

    const result = await kernel.adapters.sync('techpulse')

    expect(fake.sync).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ added: [], changed: [], events: [] })
    await kernel.stop()
  })

  it('fails clearly when no adapter is registered for a project', async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: ${AGENTOS_CLONES}/techpulse\nbase_branch: main\noptions: {}\n',
    )
    const kernel = createKernel(makeCfg(osRoot))
    await expect(kernel.adapters.sync('techpulse')).rejects.toThrow(
      /no adapter registered/,
    )
    await kernel.stop()
  })
})
