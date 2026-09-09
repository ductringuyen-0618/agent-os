import type { Event, RoutineConfig, RoutinesFile, Run } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'

/**
 * M1 stub: no cron/heartbeat/event-trigger logic yet. load() just stores
 * the parsed routines file so createKernel() type-checks and `agentos up`
 * can start. M3 (docs/superpowers/plans/2026-09-08-agent-os-m3-scheduler-heartbeat.md)
 * replaces this file with real every/cron/on/after/scheduleOnce support.
 */
export class Scheduler {
  private routinesFile: RoutinesFile | undefined

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private exec: (
      routine: RoutineConfig,
      payload?: Record<string, unknown>,
    ) => Promise<void>,
  ) {}

  load(routines: RoutinesFile): void {
    this.routinesFile = routines
  }

  start(): void {
    // no-op until M3
  }

  stop(): void {
    // no-op until M3
  }

  async runNow(
    name: string,
    _payload?: Record<string, unknown>,
  ): Promise<string> {
    throw new Error(`Scheduler.runNow('${name}') is not implemented until M3`)
  }

  onEvent(_e: Event): void {
    // no-op until M3
  }

  scheduleOnce(
    _skill: string,
    _when: Date,
    _payload?: Record<string, unknown>,
  ): string {
    throw new Error('Scheduler.scheduleOnce is not implemented until M3')
  }

  setEnabled(_name: string, _enabled: boolean): void {
    // no-op until M3
  }

  list(): Array<{ routine: RoutineConfig; nextRun?: string; lastRun?: Run }> {
    return (this.routinesFile?.routines ?? []).map((routine) => ({ routine }))
  }
}
