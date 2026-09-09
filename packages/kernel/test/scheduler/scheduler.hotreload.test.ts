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

describe('Scheduler.registerRoutine / unregisterRoutine', () => {
  it('starts firing an every: routine registered after start(), with no reload', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()

    scheduler.registerRoutine({
      name: 'hot-sync',
      every: '10ms',
      adapter: 'demo',
    })

    await vi.waitFor(() =>
      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'hot-sync' }),
        undefined,
      ),
    )
    scheduler.stop()
  })

  it('re-registering the same name replaces the previous timer instead of doubling it', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    scheduler.registerRoutine({
      name: 'hot-sync',
      every: '1h',
      adapter: 'demo',
    })
    scheduler.registerRoutine({
      name: 'hot-sync',
      every: '2h',
      adapter: 'demo',
    })

    const listed = scheduler.list().filter((l) => l.routine.name === 'hot-sync')
    expect(listed).toHaveLength(1)
    expect(listed[0].routine.every).toBe('2h')
    scheduler.stop()
  })

  it('unregisterRoutine stops the timer and removes it from list()', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    scheduler.registerRoutine({
      name: 'hot-sync',
      every: '1h',
      adapter: 'demo',
    })

    scheduler.unregisterRoutine('hot-sync')

    expect(scheduler.list().some((l) => l.routine.name === 'hot-sync')).toBe(
      false,
    )
    scheduler.stop()
  })

  it('unregisterRoutine on an unknown name is a no-op', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    expect(() => scheduler.unregisterRoutine('nope')).not.toThrow()
  })

  it('registering before start() just queues it for scheduleRoutine at start()', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.registerRoutine({
      name: 'pre-start',
      every: '10ms',
      adapter: 'demo',
    })
    scheduler.start()

    return vi
      .waitFor(() =>
        expect(exec).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'pre-start' }),
          undefined,
        ),
      )
      .finally(() => scheduler.stop())
  })
})
