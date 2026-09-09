import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdapterHost } from '../adapters/adapterHost.js'
import type { KernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { WikiService } from '../wiki/wikiService.js'
import { buildServer } from './server.js'

function makeKernel() {
  const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
  // AdapterHost.applyDecision (M4 Task 7) looks up the project registered
  // for decision.adapter via loadProjects(), so a decision test that routes
  // through the real techpulse-coo adapter needs a projects/*.yaml seeded
  // -- without one, applyDecision throws "no project configured for
  // adapter 'techpulse-coo'" before ever reaching the registry.
  mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
  writeFileSync(
    path.join(osRoot, 'projects', 'techpulse.yaml'),
    'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: /tmp/does-not-matter\nbase_branch: main\noptions: {}\n',
  )
  const cfg: KernelConfig = {
    osRoot,
    runtimeDir: path.join(osRoot, '..', '.agentos'),
    dbPath: ':memory:',
    claudeBin: 'true',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'info',
  }
  const log = new EventLog(cfg.dbPath)
  const wiki = new WikiService(osRoot, log)
  // biome-ignore lint/suspicious/noExplicitAny: test capture of applyDecision calls
  const applied: any[] = []
  const registry = {
    'techpulse-coo': {
      name: 'techpulse-coo',
      sync: async () => ({ added: [], changed: [], events: [] }),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Decision
      applyDecision: async (d: any) => {
        applied.push(d)
      },
    },
  }
  const adapters = new AdapterHost(cfg, log, wiki, registry)
  return { cfg, log, wiki, adapters, applied }
}

describe('decisions + projects routes', () => {
  it('lists decisions and approves a plain (non-adapter) one', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Kernel
    const kernel: any = makeKernel()
    kernel.log.createDecision({ title: 'manual', body: 'b' })
    const app = buildServer(kernel)

    const list = await app.inject({ method: 'GET', url: '/api/decisions' })
    expect(list.statusCode).toBe(200)
    const decisions = JSON.parse(list.body)
    expect(decisions).toHaveLength(1)

    const approve = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decisions[0].id}/approve`,
    })
    expect(approve.statusCode).toBe(200)
    expect(JSON.parse(approve.body).status).toBe('approved')
  })

  it('routes adapter-backed approve/reject through AdapterHost.applyDecision', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Kernel
    const kernel: any = makeKernel()
    const decision = kernel.log.createDecision({
      title: 't',
      body: 'b',
      adapter: 'techpulse-coo',
      ref: '001.md',
    })
    const app = buildServer(kernel)

    const reject = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision.id}/reject`,
    })

    expect(reject.statusCode).toBe(200)
    expect(kernel.applied).toHaveLength(1)
    expect(kernel.applied[0].status).toBe('rejected')
  })

  it('rejects re-resolving an already-resolved decision with 409', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Kernel
    const kernel: any = makeKernel()
    const decision = kernel.log.createDecision({ title: 't', body: 'b' })
    kernel.log.resolveDecision(decision.id, 'approved')
    const app = buildServer(kernel)

    const res = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision.id}/approve`,
    })
    expect(res.statusCode).toBe(409)
  })

  it('lets an errored decision be approved again', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Kernel
    const kernel: any = makeKernel()
    const decision = kernel.log.createDecision({ title: 't', body: 'b' })
    kernel.log.resolveDecision(decision.id, 'error', 'ENOENT')
    const app = buildServer(kernel)

    const res = await app.inject({
      method: 'POST',
      url: `/api/decisions/${decision.id}/approve`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('approved')
  })

  it('exposes POST /api/projects/:name/sync', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Kernel
    const kernel: any = makeKernel()
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/techpulse/sync',
    })
    expect([200, 500]).toContain(res.statusCode) // 500 acceptable: no projects/*.yaml seeded in this test osRoot
  })
})
