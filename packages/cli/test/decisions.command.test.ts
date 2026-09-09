import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AdapterHost,
  EventLog,
  type Kernel,
  WikiService,
  buildServer,
} from '@agentos/kernel'
import { Command } from 'commander'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../src/client.js'
import { registerApprove } from '../src/commands/approve.js'
import { registerDecisions } from '../src/commands/decisions.js'

describe('cli decisions/approve', () => {
  let app: ReturnType<typeof buildServer>
  let client: ApiClient
  let log: EventLog

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
    log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const adapters = new AdapterHost(cfg, log, wiki, {})
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for Kernel
    app = buildServer({ cfg, log, wiki, adapters } as any as Kernel)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    client = new ApiClient({ baseUrl: `http://127.0.0.1:${port}` })
  })

  afterAll(async () => {
    await app.close()
  })

  it('lists decisions and approves one', async () => {
    const decision = log.createDecision({ title: 'manual', body: 'b' })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const program = new Command()
    registerDecisions(program, client)
    registerApprove(program, client)
    await program.parseAsync(['node', 'agentos', 'decisions'])
    await program.parseAsync(['node', 'agentos', 'approve', decision.id])

    expect(
      logSpy.mock.calls.some((c) => String(c[0]).includes(decision.id)),
    ).toBe(true)
    const after = log.getDecision(decision.id)
    expect(after?.status).toBe('approved')
    logSpy.mockRestore()
  })
})
