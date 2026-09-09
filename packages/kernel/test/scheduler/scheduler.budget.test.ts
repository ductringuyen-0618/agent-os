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

function seedSpend(log: FakeEventLog, routine: string, costUsd: number) {
  log.runs.push({
    id: `prior-${log.runs.length}`,
    routine,
    status: 'success',
    attempt: 1,
    startedAt: new Date().toISOString(),
    costUsd,
  })
}

describe('Scheduler daily budgets', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not spawn a run once a routine has met its daily cap', async () => {
    const log = new FakeEventLog()
    seedSpend(log, 'lint', 1.0)
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'lint',
          cron: '0 3 * * *',
          skill: 'lint',
          agent: 'librarian',
          daily_budget_usd: 1.0,
        },
      ],
    })
    scheduler.start()

    await expect(scheduler.runNow('lint')).rejects.toThrow(/budget/i)
    expect(exec).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('behaves identically to today when no daily_budget_usd is configured', async () => {
    const log = new FakeEventLog()
    seedSpend(log, 'lint', 1000) // an enormous prior spend, but no cap set
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

    await scheduler.runNow('lint')
    expect(exec).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('emits exactly one ops.alert per routine per day, not once per tick', async () => {
    const log = new FakeEventLog()
    seedSpend(log, 'heartbeat', 2.0)
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: { ...DEFAULTS, daily_budget_usd: 1.0 },
      routines: [
        { name: 'heartbeat', every: '1s', skill: 'heartbeat', agent: 'ops' },
      ],
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(5_000) // several every:-interval fires
    expect(exec).not.toHaveBeenCalled()
    const alerts = log.events.filter(
      (e) => e.type === 'ops.alert' && e.payload.reason === 'budget_exceeded',
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.payload).toMatchObject({
      routine: 'heartbeat',
      capUsd: 1.0,
      spentUsd: 2.0,
    })
    scheduler.stop()
  })

  it('reports dailyBudgetUsd/spentTodayUsd/budgetTripped from list()', async () => {
    const log = new FakeEventLog()
    seedSpend(log, 'lint', 0.5)
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        {
          name: 'lint',
          cron: '0 3 * * *',
          skill: 'lint',
          agent: 'librarian',
          daily_budget_usd: 1.0,
        },
        {
          name: 'ingest',
          on: ['raw.added'],
          skill: 'ingest',
          agent: 'librarian',
        },
      ],
    })
    scheduler.start()

    const beforeTrip = scheduler.list()
    const lintBefore = beforeTrip.find((r) => r.routine.name === 'lint')
    expect(lintBefore).toMatchObject({
      dailyBudgetUsd: 1.0,
      spentTodayUsd: 0.5,
      budgetTripped: false,
    })
    const ingestItem = beforeTrip.find((r) => r.routine.name === 'ingest')
    expect(ingestItem?.dailyBudgetUsd).toBeUndefined()
    expect(ingestItem?.spentTodayUsd).toBeUndefined()

    seedSpend(log, 'lint', 0.6) // pushes lint's spend over its cap
    await expect(scheduler.runNow('lint')).rejects.toThrow(/budget/i)
    const afterTrip = scheduler.list().find((r) => r.routine.name === 'lint')
    expect(afterTrip).toMatchObject({ budgetTripped: true })
    scheduler.stop()
  })
})
