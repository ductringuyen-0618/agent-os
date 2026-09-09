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

describe('Scheduler retry/backoff', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries a failed run once after 30s * attempt, then succeeds', async () => {
    const log = new FakeEventLog()
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: { ...DEFAULTS, max_attempts: 2 },
      routines: [
        {
          name: 'ingest',
          on: ['raw.added'],
          skill: 'ingest',
          agent: 'librarian',
        },
      ],
    })
    scheduler.start()
    await scheduler.runNow('ingest')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(log.runs.find((r) => r.attempt === 1)?.status).toBe('failed')
    await vi.advanceTimersByTimeAsync(30_000) // backoff = 30s * attempt(1)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(log.runs.find((r) => r.attempt === 2)?.status).toBe('success')
    scheduler.stop()
  })

  it('emits ops.alert once max_attempts is exhausted', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockRejectedValue(new Error('always fails'))
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: { ...DEFAULTS, max_attempts: 1 },
      routines: [
        {
          name: 'ingest',
          on: ['raw.added'],
          skill: 'ingest',
          agent: 'librarian',
        },
      ],
    })
    scheduler.start()
    await scheduler.runNow('ingest')
    const alert = log.events.find((e) => e.type === 'ops.alert')
    expect(alert?.payload).toMatchObject({
      routine: 'ingest',
      reason: 'failed',
    })
    scheduler.stop()
  })

  it('emits ops.alert for an every-routine that misses its interval by more than the grace period', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn(() => new Promise<void>(() => {})) // never resolves -> looks "hung"/missed
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        { name: 'heartbeat', every: '1s', skill: 'heartbeat', agent: 'ops' },
      ],
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000) // first fire, exec hangs; nextRunAt pins at ~2s since the run never settles
    // Grace is MIN_GRACE_MS (60s), so "missed" only trips once now exceeds
    // nextRunAt(~2s) + 60s = ~62s; advance well past that to the next 15s
    // tick boundary (75s) so checkMissedRoutines actually observes it.
    await vi.advanceTimersByTimeAsync(75_000)
    const alert = log.events.find(
      (e) => e.type === 'ops.alert' && e.payload.reason === 'missed',
    )
    expect(alert?.payload).toMatchObject({ routine: 'heartbeat' })
    scheduler.stop()
  })
})
