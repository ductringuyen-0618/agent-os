import type { Run } from '@agentos/shared'
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

describe('Scheduler restart recovery / setEnabled / list', () => {
  it('marks a running run as failed with "daemon restarted" and re-queues it if attempts remain', () => {
    const log = new FakeEventLog()
    log.runs.push({
      id: 'r1',
      routine: 'ingest',
      status: 'running',
      attempt: 1,
      payload: { path: 'x' },
    } as Run)
    const exec = vi.fn().mockResolvedValue(undefined)
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
    expect(log.getRun('r1')?.status).toBe('failed')
    expect(log.getRun('r1')?.error).toBe('daemon restarted')
    expect(
      log.runs.some((r) => r.routine === 'ingest' && r.attempt === 2),
    ).toBe(true)
    scheduler.stop()
  })

  it('executes a queued run left over from before restart', () => {
    const log = new FakeEventLog()
    log.runs.push({
      id: 'r2',
      routine: 'lint',
      status: 'queued',
      attempt: 1,
    } as Run)
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
    expect(exec).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('setEnabled toggles whether a routine fires, and list() reports nextRun/lastRun', async () => {
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
    scheduler.setEnabled('lint', false)
    await scheduler.runNow('lint') // runNow bypasses enabled (manual/CLI trigger); enabled only gates automatic triggers
    const before = scheduler.list()
    expect(before[0].routine.name).toBe('lint')
    expect(before[0].lastRun?.status).toBe('success')
    expect(typeof before[0].nextRun).toBe('string')
    expect(() => scheduler.setEnabled('missing', true)).toThrow(
      /unknown routine/,
    )
    scheduler.stop()
  })
})
