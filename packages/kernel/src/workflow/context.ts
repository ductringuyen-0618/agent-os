import type { Event, EventType } from '@agentos/shared'
import type { WorkflowInstance } from '@agentos/shared'
import type { RunResult } from '../process/processManager.js'
import type {
  StepOptions,
  StepRunSpec,
  WorkflowContext,
  WorkflowRuntimeDeps,
} from './types.js'

export class WorkflowSuspended extends Error {
  constructor() {
    super('workflow suspended')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(
      () => reject(new Error(`step timed out after ${ms}ms`)),
      ms,
    )
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    // biome-ignore lint/style/noNonNullAssertion: assigned synchronously above
    clearTimeout(handle!)
  }
}

export function createWorkflowContext<I = Record<string, unknown>>(
  deps: WorkflowRuntimeDeps,
  instance: WorkflowInstance,
): WorkflowContext<I> {
  let seq = 0
  const state: Record<string, unknown> = { ...instance.state }

  async function stepDo<T>(
    name: string,
    opts: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    seq += 1
    const mySeq = seq
    let row = deps.store.getStep(instance.id, name)
    if (row?.status === 'succeeded') return row.output as T
    if (!row) {
      row = deps.store.createStep(instance.id, name, mySeq)
      deps.store.update(instance.id, { currentStep: name })
      deps.onStepEvent('workflow.step.started', { step: name, seq: mySeq })
    }
    const maxAttempts = 1 + (opts.retries ?? 2)
    const backoffMs = opts.backoffMs ?? 10_000
    let lastErr: unknown
    for (let attempt = row.attempt; attempt <= maxAttempts; attempt++) {
      try {
        const result = opts.timeoutMs
          ? await withTimeout(fn(), opts.timeoutMs)
          : await fn()
        deps.store.updateStep(row.id, {
          status: 'succeeded',
          output: result,
          endedAt: new Date().toISOString(),
        })
        state[name] = result
        deps.store.update(instance.id, { state })
        deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
        return result
      } catch (err) {
        lastErr = err
        if (attempt < maxAttempts) {
          deps.store.updateStep(row.id, { attempt: attempt + 1 })
          await sleep(backoffMs * 2 ** (attempt - 1))
        }
      }
    }
    const errorMsg =
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    deps.store.updateStep(row.id, {
      status: 'failed',
      error: errorMsg,
      endedAt: new Date().toISOString(),
    })
    deps.onStepEvent('workflow.step.failed', {
      step: name,
      seq: mySeq,
      error: errorMsg,
    })
    throw lastErr instanceof Error ? lastErr : new Error(errorMsg)
  }

  async function stepSleep(name: string, ms: number): Promise<void> {
    seq += 1
    const mySeq = seq
    const row = deps.store.getStep(instance.id, name)
    if (row?.status === 'succeeded') return
    if (!row) {
      const wakeAt = new Date(Date.now() + ms).toISOString()
      deps.store.createStep(instance.id, name, mySeq, 'sleeping')
      deps.store.update(instance.id, {
        status: 'sleeping',
        currentStep: name,
        wakeAt,
        waitEvent: undefined,
      })
      deps.onStepEvent('workflow.waiting', {
        step: name,
        seq: mySeq,
        mode: 'sleep',
        wakeAt,
      })
      throw new WorkflowSuspended()
    }
    const current = deps.store.get(instance.id)
    if (current?.wakeAt && Date.now() < new Date(current.wakeAt).getTime()) {
      throw new WorkflowSuspended()
    }
    deps.store.updateStep(row.id, {
      status: 'succeeded',
      endedAt: new Date().toISOString(),
    })
    deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
  }

  async function stepWaitForEvent<T>(
    name: string,
    eventType: EventType,
    opts: { match?: (e: Event) => boolean; timeoutMs: number },
  ): Promise<T> {
    seq += 1
    const mySeq = seq
    let row = deps.store.getStep(instance.id, name)
    if (row?.status === 'succeeded') return row.output as T
    if (!row) {
      const wakeAt = new Date(Date.now() + opts.timeoutMs).toISOString()
      row = deps.store.createStep(instance.id, name, mySeq, 'waiting')
      deps.store.update(instance.id, {
        status: 'waiting',
        currentStep: name,
        wakeAt,
        waitEvent: eventType,
      })
      deps.onStepEvent('workflow.waiting', {
        step: name,
        seq: mySeq,
        mode: 'event',
        eventType,
        wakeAt,
      })
    }
    const since = row.startedAt
    const matches = deps.log
      .listEvents({ types: [eventType] })
      .filter((e) => e.ts >= since && (!opts.match || opts.match(e)))
    const match = matches[0]
    if (match) {
      deps.store.updateStep(row.id, {
        status: 'succeeded',
        output: match.payload,
        endedAt: new Date().toISOString(),
      })
      state[name] = match.payload
      deps.store.update(instance.id, { state })
      deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
      return match.payload as T
    }
    const current = deps.store.get(instance.id)
    if (current?.wakeAt && Date.now() >= new Date(current.wakeAt).getTime()) {
      deps.store.updateStep(row.id, {
        status: 'failed',
        error: 'timeout',
        endedAt: new Date().toISOString(),
      })
      deps.onStepEvent('workflow.step.failed', {
        step: name,
        seq: mySeq,
        error: 'timeout',
      })
      throw new Error(
        `workflow step '${name}' timed out waiting for ${eventType}`,
      )
    }
    throw new WorkflowSuspended()
  }

  async function stepRun(
    _name: string,
    _spec: StepRunSpec,
  ): Promise<RunResult> {
    throw new Error('not implemented until Task 7')
  }

  return {
    id: instance.id,
    input: instance.input as I,
    state,
    step: {
      do: stepDo,
      sleep: stepSleep,
      waitForEvent: stepWaitForEvent,
      run: stepRun,
    },
    emit: (type, payload) => deps.onStepEvent(type, payload),
  }
}
