import type { Event, WorkflowInstance, WorkflowStep } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import {
  currentStepIndex,
  elapsedMs,
  isInFlight,
  isTerminal,
  isWorkflowEvent,
  stepCostUsd,
  totalStepCostUsd,
  workflowCostUsd,
  workflowIdOf,
} from './workflow'

function wf(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: 'wf_1',
    kind: 'feature-request',
    status: 'running',
    title: 'Add dark mode',
    input: {},
    state: {},
    createdAt: '2026-09-09T10:00:00Z',
    updatedAt: '2026-09-09T10:00:00Z',
    ...overrides,
  }
}

describe('elapsedMs', () => {
  it('counts from startedAt to endedAt', () => {
    const w = wf({
      startedAt: '2026-09-09T10:00:00Z',
      endedAt: '2026-09-09T10:00:30Z',
    })
    expect(elapsedMs(w, Date.now())).toBe(30_000)
  })
  it('counts up to now while still open', () => {
    const now = Date.parse('2026-09-09T10:01:00Z')
    expect(elapsedMs(wf({ startedAt: '2026-09-09T10:00:00Z' }), now)).toBe(
      60_000,
    )
  })
  it('is zero before the instance starts', () => {
    expect(elapsedMs(wf(), Date.now())).toBe(0)
  })
})

describe('workflowCostUsd', () => {
  it('sums costUsd across every value stored in state', () => {
    const w = wf({
      state: {
        brief: { costUsd: 0.12 },
        build: { costUsd: 0.5, branch: 'req/x' },
      },
    })
    expect(workflowCostUsd(w)).toBeCloseTo(0.62)
  })
  it('ignores state entries with no cost', () => {
    expect(workflowCostUsd(wf({ state: { note: 'hi' } }))).toBe(0)
  })
})

describe('step cost helpers', () => {
  const steps: WorkflowStep[] = [
    {
      id: 's1',
      workflowId: 'wf_1',
      name: 'brief',
      seq: 1,
      status: 'succeeded',
      attempt: 1,
      output: { costUsd: 0.1 },
      startedAt: '2026-09-09T10:00:00Z',
    },
    {
      id: 's2',
      workflowId: 'wf_1',
      name: 'build',
      seq: 2,
      status: 'running',
      attempt: 1,
      startedAt: '2026-09-09T10:01:00Z',
    },
  ]
  it('reads cost from a single step output', () => {
    expect(stepCostUsd(steps[0])).toBe(0.1)
    expect(stepCostUsd(steps[1])).toBe(0)
  })
  it('sums cost across steps', () => {
    expect(totalStepCostUsd(steps)).toBe(0.1)
  })
})

describe('currentStepIndex', () => {
  const steps: WorkflowStep[] = [
    {
      id: 's1',
      workflowId: 'wf_1',
      name: 'brief',
      seq: 1,
      status: 'succeeded',
      attempt: 1,
      startedAt: '2026-09-09T10:00:00Z',
    },
    {
      id: 's2',
      workflowId: 'wf_1',
      name: 'build',
      seq: 2,
      status: 'running',
      attempt: 1,
      startedAt: '2026-09-09T10:01:00Z',
    },
  ]
  it('finds the step named by workflow.currentStep', () => {
    expect(currentStepIndex(wf({ currentStep: 'build' }), steps)).toBe(1)
  })
  it('returns -1 when nothing is current', () => {
    expect(currentStepIndex(wf(), steps)).toBe(-1)
  })
})

describe('isInFlight / isTerminal', () => {
  it('classifies every status exactly once', () => {
    expect(isInFlight('running')).toBe(true)
    expect(isInFlight('waiting')).toBe(true)
    expect(isInFlight('succeeded')).toBe(false)
    expect(isTerminal('succeeded')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('terminated')).toBe(true)
    expect(isTerminal('running')).toBe(false)
  })
})

describe('workflow event helpers', () => {
  it('reads workflowId from the event payload', () => {
    const e: Event = {
      id: 1,
      ts: 't',
      type: 'workflow.step.started',
      payload: {
        workflowId: 'wf_1',
        kind: 'feature-request',
        step: 'build',
        seq: 4,
      },
    }
    expect(workflowIdOf(e)).toBe('wf_1')
    expect(isWorkflowEvent(e)).toBe(true)
    expect(isWorkflowEvent({ ...e, type: 'run.started' })).toBe(false)
  })
})
