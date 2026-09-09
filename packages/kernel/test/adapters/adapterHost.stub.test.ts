import { describe, expect, it } from 'vitest'
import { AdapterHost } from '../../src/adapters/adapterHost.js'
import type { KernelConfig } from '../../src/config.js'
import { FakeEventLog } from '../helpers/fakeEventLog.js'

const cfg = {
  osRoot: 'C:/os',
  runtimeDir: 'C:/.agentos',
  dbPath: ':memory:',
  claudeBin: 'claude',
  host: '127.0.0.1',
  port: 4545,
  logLevel: 'info',
} as KernelConfig

describe('AdapterHost stub', () => {
  it('sync() on an unregistered project returns an empty SyncResult and logs ops.alert instead of throwing', async () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog stands in for EventLog in tests
    const host = new AdapterHost(cfg, log as any, {} as any, {})
    const result = await host.sync('techpulse-coo')
    expect(result).toEqual({ added: [], changed: [], events: [] })
    expect(
      log.events.some(
        (e) =>
          e.type === 'ops.alert' &&
          e.payload.reason === 'adapter-not-implemented',
      ),
    ).toBe(true)
  })

  it('applyDecision throws until M4 implements it', async () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog stands in for EventLog in tests
    const host = new AdapterHost(cfg, log as any, {} as any, {})
    // biome-ignore lint/suspicious/noExplicitAny: stub Decision for the throw-path test
    await expect(host.applyDecision({} as any)).rejects.toThrow(/M4/)
  })
})
