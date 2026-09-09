import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from '../config.js'
import type { Kernel } from '../kernel.js'
import { EventLog } from '../log/eventLog.js'
import { ProcessManager } from '../process/processManager.js'
import { buildServer } from './server.js'

describe('GET /ws', () => {
  let tmpDir: string
  let log: EventLog
  let app: ReturnType<typeof buildServer>

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-ws-'))
    const osRoot = path.join(tmpDir, 'os')
    fs.mkdirSync(osRoot, { recursive: true })
    const cfg = loadKernelConfig(osRoot, {
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: ':memory:',
      port: 0,
    })
    log = new EventLog(cfg.dbPath)
    const pm = new ProcessManager(cfg, log)
    app = buildServer({ cfg, log, pm } as unknown as Kernel)
    await app.listen({ host: '127.0.0.1', port: 0 })
  })

  afterEach(async () => {
    await app.close()
    log.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('upgrades to a WebSocket and streams appended events', async () => {
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('no port')
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
    const received = new Promise<string>((resolve, reject) => {
      ws.addEventListener('message', (m) => resolve(String(m.data)))
      ws.addEventListener('error', () => reject(new Error('ws error')))
    })
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', () => reject(new Error('ws open error')))
    })

    log.append({ type: 'custom.ping', payload: { hello: 'world' } })

    const event = JSON.parse(await received)
    expect(event.type).toBe('custom.ping')
    expect(event.payload).toEqual({ hello: 'world' })
    ws.close()
  })

  it('does not break the event log when a plain HTTP GET hits /ws', async () => {
    const res = await app.inject({ method: 'GET', url: '/ws' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(() =>
      log.append({ type: 'custom.after-bad-get', payload: {} }),
    ).not.toThrow()
  })
})
