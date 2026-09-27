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

/** A promise plus its resolver, so a test can hold a run "in flight" until it says otherwise. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function overlapAlerts(log: FakeEventLog) {
  return log.events.filter(
    (e) => e.type === 'ops.alert' && e.payload.reason === 'overlap_skipped',
  )
}

describe('Scheduler overlap guard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('skips an every:-interval fire re-triggered before the previous run settles', async () => {
    const log = new FakeEventLog()
    const gate = deferred<void>()
    const exec = vi.fn().mockReturnValue(gate.promise)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [{ name: 'sync', every: '1s', skill: 'sync', agent: 'ops' }],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1_000) // first tick starts the run
    expect(exec).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000) // second tick, still in flight
    expect(exec).toHaveBeenCalledTimes(1) // no second run spawned
    expect(log.runs).toHaveLength(1)
    expect(overlapAlerts(log)).toHaveLength(1)
    expect(overlapAlerts(log)[0]?.payload).toMatchObject({ routine: 'sync' })

    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
  })

  it('lets the routine fire normally once the in-flight run settles', async () => {
    const log = new FakeEventLog()
    const gate = deferred<void>()
    const exec = vi.fn().mockReturnValue(gate.promise)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [{ name: 'sync', every: '1s', skill: 'sync', agent: 'ops' }],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(exec).toHaveBeenCalledTimes(1)
    gate.resolve()
    await vi.advanceTimersByTimeAsync(0) // let the settled run clear its flags

    await vi.advanceTimersByTimeAsync(1_000) // next legitimate tick
    expect(exec).toHaveBeenCalledTimes(2)
    expect(overlapAlerts(log)).toHaveLength(0)
    scheduler.stop()
  })

  it('skips a second matching event while the first is still executing', async () => {
    const log = new FakeEventLog()
    const gate = deferred<void>()
    const exec = vi.fn().mockReturnValue(gate.promise)
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
      ],
    })
    scheduler.start()

    scheduler.onEvent({
      id: 1,
      ts: new Date().toISOString(),
      type: 'raw.added',
      payload: { path: 'a' },
    })
    scheduler.onEvent({
      id: 2,
      ts: new Date().toISOString(),
      type: 'raw.added',
      payload: { path: 'b' },
    })

    expect(exec).toHaveBeenCalledTimes(1)
    expect(log.runs).toHaveLength(1)
    expect(overlapAlerts(log)).toHaveLength(1)

    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
  })

  it('skips a routine whose project is busy with a different routine, naming both in the alert', async () => {
    const log = new FakeEventLog()
    const gate = deferred<void>()
    const exec = vi.fn().mockReturnValue(gate.promise)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'sync',
          on: ['raw.added'],
          skill: 'sync',
          agent: 'librarian',
          project: 'widgets',
        },
        {
          name: 'ingest',
          on: ['raw.added'],
          skill: 'ingest',
          agent: 'librarian',
          project: 'widgets',
        },
      ],
    })
    scheduler.start()

    scheduler.onEvent({
      id: 1,
      ts: new Date().toISOString(),
      type: 'raw.added',
      payload: {},
    })

    expect(exec).toHaveBeenCalledTimes(1)
    expect(log.runs).toHaveLength(1)
    const alerts = overlapAlerts(log)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.payload).toMatchObject({
      routine: 'ingest',
      project: 'widgets',
    })

    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
  })

  it('runNow rejects instead of double-spawning when the routine is already in flight', async () => {
    const log = new FakeEventLog()
    const gate = deferred<void>()
    const exec = vi.fn().mockReturnValue(gate.promise)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        { name: 'lint', cron: '0 3 * * *', skill: 'lint', agent: 'librarian' },
      ],
    })
    scheduler.start()

    const first = scheduler.runNow('lint')
    await expect(scheduler.runNow('lint')).rejects.toThrow(/in flight/i)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(overlapAlerts(log)).toHaveLength(1)

    gate.resolve()
    await first
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
  })

  it('reports overlapSkipped from list() without touching enabled state or budget bookkeeping', async () => {
    const log = new FakeEventLog()
    const gate = deferred<void>()
    const exec = vi.fn().mockReturnValue(gate.promise)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'sync',
          on: ['raw.added'],
          skill: 'sync',
          agent: 'librarian',
          daily_budget_usd: 5,
        },
      ],
    })
    scheduler.start()

    scheduler.onEvent({
      id: 1,
      ts: new Date().toISOString(),
      type: 'raw.added',
      payload: {},
    })
    scheduler.onEvent({
      id: 2,
      ts: new Date().toISOString(),
      type: 'raw.added',
      payload: {},
    })

    const item = scheduler.list().find((r) => r.routine.name === 'sync')
    expect(item).toMatchObject({
      overlapSkipped: true,
      budgetTripped: false,
    })
    expect(item?.routine.enabled).not.toBe(false)
    expect(log.runs.some((r) => r.status === 'failed')).toBe(false)

    gate.resolve()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.stop()
  })

  it('never skips a routine or project with nothing else running', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'sync',
          on: ['raw.added'],
          skill: 'sync',
          agent: 'librarian',
          project: 'widgets',
        },
      ],
    })
    scheduler.start()

    scheduler.onEvent({
      id: 1,
      ts: new Date().toISOString(),
      type: 'raw.added',
      payload: {},
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(overlapAlerts(log)).toHaveLength(0)
    scheduler.stop()
  })
})
