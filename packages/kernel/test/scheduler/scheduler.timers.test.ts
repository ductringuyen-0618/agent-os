import type { RoutinesFile } from '@agentos/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('Scheduler every/cron', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires an every-routine on its interval', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    const file: RoutinesFile = {
      defaults: DEFAULTS,
      routines: [
        { name: 'heartbeat', every: '1s', skill: 'heartbeat', agent: 'ops' },
      ],
    }
    scheduler.load(file)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(exec).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(exec).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('runNow triggers exec immediately and returns a runId', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        { name: 'lint', cron: '0 3 * * *', skill: 'lint', agent: 'librarian' },
      ],
    })
    scheduler.start()
    const runId = await scheduler.runNow('lint')
    expect(typeof runId).toBe('string')
    expect(exec).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('runNow rejects an unknown routine name', async () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, vi.fn())
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    await expect(scheduler.runNow('nope')).rejects.toThrow(/unknown routine/)
    scheduler.stop()
  })
})
