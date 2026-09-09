import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AdapterHost,
  EventLog,
  type Kernel,
  ProcessManager,
  Scheduler,
  WikiService,
  WorkflowEngine,
  buildServer,
} from '@agentos/kernel'
import type { WorkflowDefinition } from '@agentos/kernel'
import { Command } from 'commander'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../src/client.js'
import { registerWorkflowsCommand } from '../src/commands/workflows.js'

describe('cli workflows', () => {
  let app: ReturnType<typeof buildServer>
  let client: ApiClient

  beforeAll(async () => {
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
    app = buildServer({
      cfg,
      log,
      pm,
      wiki,
      adapters,
      scheduler,
      workflows,
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for buildServer's Kernel param
    } as any as Kernel)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    client = new ApiClient({ baseUrl: `http://127.0.0.1:${port}` })
  })

  afterAll(async () => {
    await app.close()
  })

  it('creates via the API, lists, and shows a workflow instance', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { workflowId } = await client.createWorkflow({
      kind: 'fake',
      input: {},
    })
    await new Promise((r) => setTimeout(r, 20))

    const program = new Command()
    registerWorkflowsCommand(program, client)
    await program.parseAsync(['node', 'agentos', 'workflows', 'list'])
    await program.parseAsync([
      'node',
      'agentos',
      'workflows',
      'show',
      workflowId,
    ])

    expect(
      logSpy.mock.calls.some((c) => String(c[0]).includes(workflowId)),
    ).toBe(true)
    logSpy.mockRestore()
  })
})
