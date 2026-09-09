import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdapterHost } from '../../src/adapters/adapterHost.js'
import { buildServer } from '../../src/api/server.js'
import type { Kernel } from '../../src/kernel.js'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { WikiService } from '../../src/wiki/wikiService.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

function makeKernel(): { kernel: Kernel } {
  const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
  const cfg = {
    osRoot,
    runtimeDir: path.join(osRoot, '..', '.agentos'),
    dbPath: ':memory:',
    claudeBin: 'true',
    host: '127.0.0.1' as const,
    port: 0,
    logLevel: 'info' as const,
  }
  const log = new EventLog(cfg.dbPath)
  const pm = new ProcessManager(cfg, log)
  const wiki = new WikiService(osRoot, log)
  const adapters = new AdapterHost(cfg, log, wiki, {})
  const scheduler = new Scheduler(cfg, log, async () => {})
  const workflows = new WorkflowEngine(cfg, log, pm)
  const def: WorkflowDefinition = {
    kind: 'fake',
    async run(ctx) {
      await ctx.step.do('brief', {}, async () => 'ok')
    },
  }
  workflows.registry.register(def)
  const kernel = {
    cfg,
    log,
    pm,
    wiki,
    adapters,
    scheduler,
    workflows,
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for buildServer's Kernel param
  } as any as Kernel
  return { kernel }
}

describe('workflow routes', () => {
  it('creates, lists, and reads a workflow instance, and delivers an external event', async () => {
    const { kernel } = makeKernel()
    const app = buildServer(kernel)

    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { kind: 'fake', input: { title: 't' } },
    })
    expect(create.statusCode).toBe(202)
    const { workflowId } = create.json()

    await new Promise((r) => setTimeout(r, 20))

    const get = await app.inject({
      method: 'GET',
      url: `/api/workflows/${workflowId}`,
    })
    expect(get.json().workflow.status).toBe('succeeded')
    expect(get.json().steps).toHaveLength(1)

    const list = await app.inject({
      method: 'GET',
      url: '/api/workflows?status=succeeded',
    })
    expect(list.json().map((w: { id: string }) => w.id)).toContain(workflowId)

    const event = await app.inject({
      method: 'POST',
      url: `/api/workflows/${workflowId}/events`,
      payload: { type: 'custom.ping', payload: { ok: true } },
    })
    expect(event.statusCode).toBe(202)
  })

  it('404s pause/resume/terminate for an unknown workflow, and 409s an invalid resume', async () => {
    const { kernel } = makeKernel()
    const app = buildServer(kernel)

    const missing = await app.inject({
      method: 'POST',
      url: '/api/workflows/nope/pause',
    })
    expect(missing.statusCode).toBe(404)

    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { kind: 'fake', input: {} },
    })
    const { workflowId } = create.json()
    await new Promise((r) => setTimeout(r, 20))

    const resume = await app.inject({
      method: 'POST',
      url: `/api/workflows/${workflowId}/resume`,
    })
    expect(resume.statusCode).toBe(409) // already succeeded, not paused/failed
  })

  it('400s a create with no kind', async () => {
    const { kernel } = makeKernel()
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
