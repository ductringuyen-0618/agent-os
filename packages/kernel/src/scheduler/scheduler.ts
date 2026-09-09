import type {
  Event,
  RoutineConfig,
  RoutineDefaults,
  RoutinesFile,
  Run,
} from '@agentos/shared'
import { Cron } from 'croner'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import { afterSatisfied, matchesOn, parseEvery } from './triggers.js'

interface LoadedRoutine {
  config: RoutineConfig
  enabled: boolean
  cronJob?: Cron
  intervalHandle?: NodeJS.Timeout
  everyMs?: number
  nextRunAt?: Date
  missedAlerted?: boolean
}

const TICK_MS = 15_000

export class Scheduler {
  private routines = new Map<string, LoadedRoutine>()
  private defaults: RoutineDefaults = {
    model: 'sonnet',
    permission_mode: 'plan',
    allowed_tools: [],
    max_attempts: 2,
    timeout_ms: 600_000,
  }
  private tickHandle?: NodeJS.Timeout
  private unsubscribe?: () => void
  private started = false

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private exec: (
      routine: RoutineConfig,
      payload?: Record<string, unknown>,
    ) => Promise<void>,
  ) {}

  load(file: RoutinesFile): void {
    this.defaults = file.defaults
    this.routines.clear()
    for (const r of file.routines) {
      this.routines.set(r.name, { config: r, enabled: r.enabled !== false })
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.recoverFromRestart()
    for (const lr of this.routines.values()) this.scheduleRoutine(lr)
    this.unsubscribe = this.log.subscribe((e) => this.onEvent(e))
    this.tickHandle = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    this.started = false
    for (const lr of this.routines.values()) {
      lr.cronJob?.stop()
      if (lr.intervalHandle) clearInterval(lr.intervalHandle)
    }
    this.unsubscribe?.()
    if (this.tickHandle) clearInterval(this.tickHandle)
  }

  private scheduleRoutine(lr: LoadedRoutine): void {
    const { config } = lr
    if (config.cron) {
      lr.cronJob = new Cron(config.cron, { catch: true }, () =>
        this.trigger(lr),
      )
    } else if (config.every) {
      lr.everyMs = parseEvery(config.every)
      lr.nextRunAt = new Date(Date.now() + lr.everyMs)
      lr.intervalHandle = setInterval(() => {
        lr.nextRunAt = new Date(Date.now() + (lr.everyMs as number))
        lr.missedAlerted = false
        this.trigger(lr)
      }, lr.everyMs)
    }
  }

  private trigger(lr: LoadedRoutine): void {
    if (!lr.enabled) return
    if (lr.config.after && !this.afterOk(lr.config.after)) return
    this.runRoutine(lr.config).catch(() => {})
  }

  private afterOk(after: string[]): boolean {
    const lastRuns = new Map(
      after.map((name) => [
        name,
        this.log.listRuns({ routine: name, limit: 1 })[0],
      ]),
    )
    return afterSatisfied(after, lastRuns)
  }

  async runNow(
    name: string,
    payload?: Record<string, unknown>,
  ): Promise<string> {
    const lr = this.routines.get(name)
    if (!lr) throw new Error(`unknown routine: ${name}`)
    return this.runRoutine(lr.config, payload)
  }

  private async runRoutine(
    config: RoutineConfig,
    payload?: Record<string, unknown>,
  ): Promise<string> {
    const run = this.log.createRun({
      routine: config.name,
      skill: config.skill,
      adapter: config.adapter,
      agent: config.agent,
      payload,
    })
    this.executeRoutine(run, config, payload).catch(() => {})
    return run.id
  }

  private async executeRoutine(
    run: Run,
    config: RoutineConfig,
    payload: Record<string, unknown> | undefined,
  ): Promise<void> {
    this.log.updateRun(run.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })
    try {
      await this.exec(config, payload)
      this.log.updateRun(run.id, {
        status: 'success',
        endedAt: new Date().toISOString(),
      })
    } catch (err) {
      await this.handleFailure(run, config, err)
    }
  }

  private effectiveMaxAttempts(config: RoutineConfig): number {
    return config.max_attempts ?? this.defaults.max_attempts
  }

  private async handleFailure(
    run: Run,
    config: RoutineConfig,
    err: unknown,
  ): Promise<void> {
    const maxAttempts = this.effectiveMaxAttempts(config)
    const errorMsg = err instanceof Error ? err.message : String(err)
    this.log.updateRun(run.id, {
      status: 'failed',
      error: errorMsg,
      endedAt: new Date().toISOString(),
    })
    if (run.attempt < maxAttempts) {
      const backoffMs = 30_000 * run.attempt
      setTimeout(() => {
        const retryRun = this.log.createRun({
          routine: config.name,
          skill: config.skill,
          adapter: config.adapter,
          agent: config.agent,
          payload: run.payload,
          attempt: run.attempt + 1,
        })
        this.executeRoutine(retryRun, config, run.payload).catch(() => {})
      }, backoffMs)
    } else {
      this.log.append({
        type: 'ops.alert',
        payload: {
          routine: config.name,
          runId: run.id,
          reason: 'failed',
          error: errorMsg,
        },
      })
    }
  }

  onEvent(e: Event): void {
    for (const lr of this.routines.values()) {
      if (!lr.enabled) continue
      if (matchesOn(lr.config.on, e.type)) this.trigger(lr)
    }
  }

  // -- filled in by later tasks --
  private tick(): void {}
  private recoverFromRestart(): void {}
  scheduleOnce(
    _skill: string,
    _when: Date,
    _payload?: Record<string, unknown>,
  ): string {
    throw new Error('not implemented until Task 4')
  }
  setEnabled(_name: string, _enabled: boolean): void {
    throw new Error('not implemented until Task 6')
  }
  list(): Array<{ routine: RoutineConfig; nextRun?: string; lastRun?: Run }> {
    throw new Error('not implemented until Task 6')
  }
}
