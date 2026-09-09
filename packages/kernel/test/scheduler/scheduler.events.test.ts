import { describe, expect, it, vi } from 'vitest'
import type { KernelConfig } from '../../src/config.js'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { DEFAULTS, FakeEventLog } from '../helpers/fakeEventLog.js'

const cfg = {
  osRoot: 'C:/os',
  runtimeDir: 'C:/.agentos',
  dbPath: ':memory:',
  claudeBin: 'claude',
  host: '127.0.0.1',
  port: 4545,
  logLevel: 'info',
} as KernelConfig

describe('Scheduler.onEvent', () => {
  it('triggers a routine on a matching event, including the custom.* wildcard, but not on a mismatch', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'ingest',
          on: ['raw.added'],
          skill: 'ingest',
          agent: 'librarian',
        },
        {
          name: 'custom-handler',
          on: ['custom.*'],
          skill: 'ingest',
          agent: 'librarian',
        },
      ],
    })
    scheduler.start()
    log.append({ type: 'raw.added', payload: { path: 'raw/x.md' } })
    expect(exec).toHaveBeenCalledTimes(1)
    log.append({ type: 'custom.foo', payload: {} })
    expect(exec).toHaveBeenCalledTimes(2)
    log.append({ type: 'raw.changed', payload: {} })
    expect(exec).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('does not trigger a disabled routine on a matching event', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'ingest',
          enabled: false,
          on: ['raw.added'],
          skill: 'ingest',
          agent: 'librarian',
        },
      ],
    })
    scheduler.start()
    log.append({ type: 'raw.added', payload: {} })
    expect(exec).not.toHaveBeenCalled()
    scheduler.stop()
  })
})
