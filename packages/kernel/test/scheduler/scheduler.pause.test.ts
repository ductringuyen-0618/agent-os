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

function everyFile(): RoutinesFile {
  return {
    defaults: DEFAULTS,
    routines: [
      { name: 'heartbeat', every: '1s', skill: 'heartbeat', agent: 'ops' },
    ],
  }
}

function onEventFile(): RoutinesFile {
  return {
    defaults: DEFAULTS,
    routines: [
      {
        name: 'ingest',
        on: ['raw.added'],
        skill: 'ingest',
        agent: 'librarian',
      },
    ],
  }
}

describe('Scheduler pause/resume', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('blocks an every-routine timer from firing while paused', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load(everyFile())
    scheduler.pause('incident', 'cli')
    scheduler.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(exec).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('blocks an on: event trigger while paused', () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load(onEventFile())
    scheduler.start()
    scheduler.pause()
    log.append({ type: 'raw.added', payload: {} })
    expect(exec).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('blocks a due one-shot schedule while paused', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    scheduler.pause()
    scheduler.scheduleOnce('some-skill', new Date(Date.now() - 1))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('rejects runNow and runSkill while paused, without starting a run', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({
      defaults: DEFAULTS,
      routines: [{ name: 'lint', skill: 'lint', agent: 'librarian' }],
    })
    scheduler.start()
    scheduler.pause()
    await expect(scheduler.runNow('lint')).rejects.toThrow(/paused/)
    await expect(scheduler.runSkill('lint')).rejects.toThrow(/paused/)
    expect(exec).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('a pause row set before construction still blocks triggers, simulating a daemon restart', async () => {
    const log = new FakeEventLog()
    log.setPause({ at: '2026-09-13T00:00:00Z', reason: 'pre-restart' })
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load(everyFile())
    scheduler.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(exec).not.toHaveBeenCalled()
    expect(scheduler.getPause()).toEqual({
      at: '2026-09-13T00:00:00Z',
      reason: 'pre-restart',
    })
    scheduler.stop()
  })

  it('resume clears the pause and restores normal triggering', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load(everyFile())
    scheduler.pause()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(exec).not.toHaveBeenCalled()
    scheduler.resume()
    expect(scheduler.getPause()).toBeNull()
    expect(log.getPause()).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(exec).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('pausing emits exactly one ops.alert carrying reason/by; resuming emits one daemon_resumed alert', () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, vi.fn())
    scheduler.pause('investigating', 'dashboard')
    const pauseAlerts = log.events.filter(
      (e) => e.type === 'ops.alert' && e.payload.reason === 'daemon_paused',
    )
    expect(pauseAlerts).toHaveLength(1)
    expect(pauseAlerts[0].payload).toMatchObject({
      pauseReason: 'investigating',
      by: 'dashboard',
    })
    scheduler.resume()
    const resumeAlerts = log.events.filter(
      (e) => e.type === 'ops.alert' && e.payload.reason === 'daemon_resumed',
    )
    expect(resumeAlerts).toHaveLength(1)
  })

  it('does not mutate any routine enabled flag across a pause/resume cycle', () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural test double for EventLog
    const scheduler = new Scheduler(cfg, log as any, vi.fn())
    scheduler.load({
      defaults: DEFAULTS,
      routines: [
        { name: 'a', skill: 'a', agent: 'ops' },
        { name: 'b', skill: 'b', agent: 'ops', enabled: false },
      ],
    })
    scheduler.pause()
    scheduler.resume()
    const byName = Object.fromEntries(
      scheduler.list().map((i) => [i.routine.name, i.routine.enabled]),
    )
    expect(byName.a).toBe(true)
    expect(byName.b).toBe(false)
  })
})
