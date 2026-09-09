import { describe, expect, it } from 'vitest'
import { WorkflowStore } from '../../src/workflow/store.js'
import { FakeEventLog } from '../helpers/fakeEventLog.js'

describe('WorkflowStore', () => {
  it('creates an instance and looks up steps by name', () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
    const store = new WorkflowStore(log as any)
    const wf = store.create({ kind: 'feature-request', title: 't', input: {} })
    expect(store.getStep(wf.id, 'brief')).toBeUndefined()
    const step = store.createStep(wf.id, 'brief', 1)
    expect(store.getStep(wf.id, 'brief')?.id).toBe(step.id)
    expect(store.steps(wf.id)).toHaveLength(1)
  })

  it('resetFailedStep deletes a failed step so replay starts it fresh, but leaves a succeeded step alone', () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
    const store = new WorkflowStore(log as any)
    const wf = store.create({ kind: 'feature-request', title: 't', input: {} })
    const failed = store.createStep(wf.id, 'validate', 1)
    store.updateStep(failed.id, { status: 'failed', error: 'checks failed' })
    const succeeded = store.createStep(wf.id, 'brief', 0)
    store.updateStep(succeeded.id, {
      status: 'succeeded',
      output: { ok: true },
    })

    store.resetFailedStep(wf.id, 'validate')
    store.resetFailedStep(wf.id, 'brief') // no-op: not failed

    expect(store.getStep(wf.id, 'validate')).toBeUndefined()
    expect(store.getStep(wf.id, 'brief')?.status).toBe('succeeded')
  })
})
