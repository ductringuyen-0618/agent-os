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

describe('Scheduler.scheduleOnce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs a one-shot schedule once its time is due, resolving the routine by matching skill', async () => {
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
    const id = scheduler.scheduleOnce('lint', new Date(Date.now() + 5000))
    expect(typeof id).toBe('string')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0].agent).toBe('librarian')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).toHaveBeenCalledTimes(1) // does not re-fire once marked fired
    scheduler.stop()
  })

  it('falls back to an ad-hoc routine when no loaded routine matches the skill', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    scheduler.scheduleOnce('some-skill', new Date(Date.now() - 1))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toMatchObject({
      name: 'adhoc-some-skill',
      skill: 'some-skill',
      agent: 'ops',
    })
    scheduler.stop()
  })
})
