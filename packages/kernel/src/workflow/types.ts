import type {
  Event,
  EventType,
  PermissionMode,
  RoutineDefaults,
} from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { ProcessManager, RunResult } from '../process/processManager.js'
import type { WorkflowStore } from './store.js'

export interface StepOptions {
  retries?: number
  backoffMs?: number
  timeoutMs?: number
}

export interface StepRunSpec {
  skill: string
  agent: string
  task?: Record<string, unknown>
  cwd?: string
  addDirs?: string[]
  model?: string
  permissionMode?: PermissionMode
  allowedTools?: string[]
  timeoutMs?: number
}

export interface WorkflowStepApi {
  do<T>(name: string, opts: StepOptions, fn: () => Promise<T>): Promise<T>
  sleep(name: string, ms: number): Promise<void>
  waitForEvent<T = Record<string, unknown>>(
    name: string,
    eventType: EventType,
    opts: { match?: (e: Event) => boolean; timeoutMs: number },
  ): Promise<T>
  run(name: string, spec: StepRunSpec): Promise<RunResult>
}

export interface WorkflowContext<I = Record<string, unknown>> {
  /** The workflow instance's own id (the `workflows.id` row) -- stable across every replay, so a definition can key collision-free output paths (e.g. `requests/<id>/proposal.md`) off it without threading an id through `input`. */
  readonly id: string
  input: I
  state: Record<string, unknown>
  step: WorkflowStepApi
  emit(type: EventType, payload: Record<string, unknown>): void
}

export interface WorkflowDefinition<I = Record<string, unknown>> {
  kind: string
  run(ctx: WorkflowContext<I>): Promise<void>
}

export interface WorkflowRuntimeDeps {
  cfg: KernelConfig
  log: EventLog
  store: WorkflowStore
  pm: ProcessManager
  defaults: RoutineDefaults
  daemonUrl: string
  onStepEvent: (type: EventType, extra: Record<string, unknown>) => void
  /**
   * Consulted by `step.run` before spawning whenever `spec.cwd` is set and
   * resolves outside `<osRoot>/agents/<agent>/workspace` (e.g. a project
   * clone). Absent entirely -- not just a no-op -- means "no containment
   * guard is configured", which `step.run` treats as a hard failure rather
   * than silently allowing an out-of-workspace spawn. Throwing fails the
   * step with that error.
   */
  cwdPolicy?: (cwd: string, spec: StepRunSpec, input: unknown) => void
}
