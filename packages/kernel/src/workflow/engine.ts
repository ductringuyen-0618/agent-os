import type {
  Event,
  EventType,
  RoutineDefaults,
  WorkflowInstance,
  WorkflowStatus,
} from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { ProcessManager } from '../process/processManager.js'
import { WorkflowSuspended, createWorkflowContext } from './context.js'
import { WorkflowRegistry } from './registry.js'
import { WorkflowStore } from './store.js'
import type { WorkflowRuntimeDeps } from './types.js'

const DEFAULT_MAX_CONCURRENT = 2

export class WorkflowEngine {
  readonly registry = new WorkflowRegistry()
  private store: WorkflowStore
  private inFlight = new Set<string>()
  private queue: string[] = []
  private defaults: RoutineDefaults = {
    model: 'sonnet',
    permission_mode: 'plan',
    allowed_tools: [],
    max_attempts: 2,
    timeout_ms: 600_000,
  }
  private maxConcurrent = DEFAULT_MAX_CONCURRENT

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private pm: ProcessManager,
    private cwdPolicy?: WorkflowRuntimeDeps['cwdPolicy'],
  ) {
    this.store = new WorkflowStore(log)
  }

  load(defaults: RoutineDefaults, maxConcurrent?: number): void {
    this.defaults = defaults
    this.maxConcurrent = maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  }

  private alarmHandle?: NodeJS.Timeout
  private unsubscribe?: () => void

  start(): void {
    this.unsubscribe = this.log.subscribe((e) => this.onEvent(e))
    this.alarmHandle = setInterval(() => this.tick(), 5_000)
    for (const inst of [
      ...this.store.list({ status: 'running' }),
      ...this.store.list({ status: 'waiting' }),
      ...this.store.list({ status: 'sleeping' }),
    ]) {
      this.schedule(inst.id)
    }
  }

  stop(): void {
    this.unsubscribe?.()
    if (this.alarmHandle) clearInterval(this.alarmHandle)
  }

  private onEvent(e: Event): void {
    for (const inst of this.store.list({ status: 'waiting' })) {
      if (inst.waitEvent === e.type) this.schedule(inst.id)
    }
  }

  private tick(): void {
    const now = Date.now()
    for (const inst of [
      ...this.store.list({ status: 'sleeping' }),
      ...this.store.list({ status: 'waiting' }),
    ]) {
      if (inst.wakeAt && now >= new Date(inst.wakeAt).getTime())
        this.schedule(inst.id)
    }
  }

  async create(
    kind: string,
    input: Record<string, unknown>,
    opts: { project?: string; title?: string } = {},
  ): Promise<WorkflowInstance> {
    if (!this.registry.get(kind)) {
      throw new Error(`unknown workflow kind: ${kind}`)
    }
    const instance = this.store.create({
      kind,
      project: opts.project,
      title: opts.title ?? kind,
      input,
    })
    this.emitEvent(instance, 'workflow.created', {})
    this.schedule(instance.id)
    return instance
  }

  get(id: string): WorkflowInstance | undefined {
    return this.store.get(id)
  }

  list(opts?: {
    status?: WorkflowStatus
    kind?: string
    project?: string
  }): WorkflowInstance[] {
    return this.store.list(opts)
  }

  steps(id: string) {
    return this.store.steps(id)
  }

  async pause(id: string): Promise<WorkflowInstance> {
    this.requireInstance(id)
    const updated = this.store.update(id, { status: 'paused' })
    this.emitEvent(updated, 'workflow.paused', {})
    return updated
  }

  async resume(id: string): Promise<WorkflowInstance> {
    const instance = this.requireInstance(id)
    if (instance.status !== 'paused' && instance.status !== 'failed') {
      throw new Error(
        `cannot resume workflow ${id} from status ${instance.status}`,
      )
    }
    if (instance.status === 'failed' && instance.currentStep) {
      this.store.resetFailedStep(id, instance.currentStep)
    }
    const updated = this.store.update(id, {
      status: 'running',
      error: undefined,
    })
    this.emitEvent(updated, 'workflow.resumed', {})
    this.schedule(id)
    return updated
  }

  async terminate(id: string): Promise<WorkflowInstance> {
    const instance = this.requireInstance(id)
    const current = instance.currentStep
      ? this.store.getStep(id, instance.currentStep)
      : undefined
    if (current?.runId) this.pm.kill(current.runId)
    if (
      current &&
      current.status !== 'succeeded' &&
      current.status !== 'failed'
    ) {
      this.store.updateStep(current.id, {
        status: 'skipped',
        endedAt: new Date().toISOString(),
      })
    }
    const updated = this.store.update(id, {
      status: 'terminated',
      endedAt: new Date().toISOString(),
    })
    this.emitEvent(updated, 'workflow.terminated', {})
    return updated
  }

  private requireInstance(id: string): WorkflowInstance {
    const instance = this.store.get(id)
    if (!instance) throw new Error(`unknown workflow: ${id}`)
    return instance
  }

  private emitEvent(
    instance: WorkflowInstance,
    type: EventType,
    extra: Record<string, unknown>,
  ): void {
    this.log.append({
      type,
      payload: {
        workflowId: instance.id,
        kind: instance.kind,
        project: instance.project ?? null,
        ...extra,
      },
    })
  }

  private schedule(id: string): void {
    if (this.inFlight.has(id)) return
    if (this.inFlight.size >= this.maxConcurrent) {
      if (!this.queue.includes(id)) this.queue.push(id)
      return
    }
    this.launch(id)
  }

  private launch(id: string): void {
    this.inFlight.add(id)
    this.executeInstance(id).finally(() => {
      this.inFlight.delete(id)
      const next = this.queue.shift()
      if (next) this.launch(next)
    })
  }

  private async executeInstance(id: string): Promise<void> {
    const instance = this.store.get(id)
    if (!instance || instance.status === 'paused') return
    const definition = this.registry.get(instance.kind)
    if (!definition) {
      this.store.update(id, {
        status: 'failed',
        error: `no workflow definition registered for kind '${instance.kind}'`,
        endedAt: new Date().toISOString(),
      })
      return
    }
    if (instance.status === 'queued') {
      this.store.update(id, {
        status: 'running',
        startedAt: new Date().toISOString(),
      })
    }
    const ctx = createWorkflowContext(
      {
        cfg: this.cfg,
        log: this.log,
        store: this.store,
        pm: this.pm,
        defaults: this.defaults,
        daemonUrl: `http://${this.cfg.host}:${this.cfg.port}`,
        cwdPolicy: this.cwdPolicy,
        onStepEvent: (type, extra) => {
          const current = this.store.get(id)
          if (current) this.emitEvent(current, type, extra)
        },
      },
      // biome-ignore lint/style/noNonNullAssertion: fetched at the top of this method
      this.store.get(id)!,
    )
    try {
      await definition.run(ctx)
      // definition.run() can resolve fully (every step already replayed to
      // 'succeeded', no further step boundary left to hit checkPause) after
      // a concurrent pause() has already landed -- e.g. a single-step
      // workflow whose one step was already in flight when pause() was
      // called. Don't let this completion stomp that 'paused' status back
      // to 'succeeded'; resume() replays it and finishes on its own.
      if (this.store.get(id)?.status === 'paused') return
      this.store.update(id, {
        status: 'succeeded',
        state: ctx.state,
        endedAt: new Date().toISOString(),
      })
      // biome-ignore lint/style/noNonNullAssertion: just updated
      this.emitEvent(this.store.get(id)!, 'workflow.succeeded', {})
    } catch (err) {
      if (err instanceof WorkflowSuspended) return
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.store.update(id, {
        status: 'failed',
        error: errorMsg,
        endedAt: new Date().toISOString(),
      })
      // biome-ignore lint/style/noNonNullAssertion: just updated
      this.emitEvent(this.store.get(id)!, 'workflow.failed', {
        error: errorMsg,
      })
    }
  }
}
