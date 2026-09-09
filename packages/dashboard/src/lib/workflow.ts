import type {
  Event,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
} from '@agentos/shared'

/** Every status the engine has not yet finished with — still "in flight". */
export const IN_FLIGHT_STATUSES: WorkflowStatus[] = [
  'queued',
  'running',
  'waiting',
  'sleeping',
  'paused',
]

export function isInFlight(status: WorkflowStatus): boolean {
  return IN_FLIGHT_STATUSES.includes(status)
}

/** True once the instance has ended, one way or another. */
export function isTerminal(status: WorkflowStatus): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'terminated'
  )
}

/** Wall-clock time the instance has run, counting up to `now` while open. */
export function elapsedMs(workflow: WorkflowInstance, now: number): number {
  if (!workflow.startedAt) return 0
  const start = Date.parse(workflow.startedAt)
  const end = workflow.endedAt ? Date.parse(workflow.endedAt) : now
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, end - start)
}

function costFromValue(value: unknown): number {
  if (value && typeof value === 'object' && 'costUsd' in value) {
    const c = (value as { costUsd?: unknown }).costUsd
    if (typeof c === 'number' && !Number.isNaN(c)) return c
  }
  return 0
}

/**
 * Sum of every step's recorded cost, read from the instance's own working
 * memory (`workflow.state`, which the engine keys by step name per spec
 * §3.1). Works from the list endpoint alone — no per-instance steps fetch.
 */
export function workflowCostUsd(workflow: WorkflowInstance): number {
  return Object.values(workflow.state ?? {}).reduce(
    (sum, v) => sum + costFromValue(v),
    0,
  )
}

/** A single step's own cost, from its persisted `step.run` output. */
export function stepCostUsd(step: WorkflowStep): number {
  return costFromValue(step.output)
}

export function totalStepCostUsd(steps: WorkflowStep[]): number {
  return steps.reduce((sum, s) => sum + stepCostUsd(s), 0)
}

/** Index into `steps` of the step named by `workflow.currentStep`, or -1. */
export function currentStepIndex(
  workflow: WorkflowInstance,
  steps: WorkflowStep[],
): number {
  if (!workflow.currentStep) return -1
  return steps.findIndex((s) => s.name === workflow.currentStep)
}

/** `payload.workflowId` for any `workflow.*` event, per spec §3.3. */
export function workflowIdOf(e: Event): string | undefined {
  const id = (e.payload as { workflowId?: unknown }).workflowId
  return typeof id === 'string' ? id : undefined
}

export function isWorkflowEvent(e: Event): boolean {
  return e.type.startsWith('workflow.')
}
