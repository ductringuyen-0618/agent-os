import { describe, expect, it } from 'vitest'
import { EventLog } from '../../src/log/eventLog.js'

describe('EventLog workflow CRUD', () => {
  it('creates, reads, updates, and lists a workflow instance', () => {
    const log = new EventLog(':memory:')
    const wf = log.createWorkflow({
      kind: 'feature-request',
      title: 'Add dark mode',
      input: { title: 'dark mode' },
    })
    expect(wf.status).toBe('queued')
    expect(wf.state).toEqual({})
    expect(wf.input).toEqual({ title: 'dark mode' })

    expect(log.getWorkflow(wf.id)?.id).toBe(wf.id)

    const updated = log.updateWorkflow(wf.id, {
      status: 'running',
      startedAt: '2026-09-09T00:00:00.000Z',
      state: { a: 1 },
    })
    expect(updated.status).toBe('running')
    expect(updated.state).toEqual({ a: 1 })
    expect(updated.updatedAt).not.toBe(wf.updatedAt)

    expect(log.listWorkflows({ status: 'running' }).map((w) => w.id)).toContain(
      wf.id,
    )
    expect(log.listWorkflows({ status: 'succeeded' })).toEqual([])

    log.close()
  })

  it('creates, updates, and deletes workflow steps ordered by seq', () => {
    const log = new EventLog(':memory:')
    const wf = log.createWorkflow({
      kind: 'feature-request',
      title: 't',
      input: {},
    })
    const s2 = log.createWorkflowStep({
      workflowId: wf.id,
      name: 'push-proposal',
      seq: 2,
      status: 'running',
    })
    const s1 = log.createWorkflowStep({
      workflowId: wf.id,
      name: 'brief',
      seq: 1,
      status: 'succeeded',
    })

    expect(log.listWorkflowSteps(wf.id).map((s) => s.name)).toEqual([
      'brief',
      'push-proposal',
    ])

    const updated = log.updateWorkflowStep(s2.id, {
      status: 'succeeded',
      output: { sha: 'abc' },
      endedAt: '2026-09-09T00:00:01.000Z',
    })
    expect(updated.status).toBe('succeeded')
    expect(updated.output).toEqual({ sha: 'abc' })

    log.deleteWorkflowStep(s1.id)
    expect(log.listWorkflowSteps(wf.id).map((s) => s.name)).toEqual([
      'push-proposal',
    ])

    log.close()
  })

  it('throws for an unknown workflow or step id', () => {
    const log = new EventLog(':memory:')
    expect(() => log.updateWorkflow('nope', { status: 'running' })).toThrow(
      /Workflow not found/,
    )
    expect(() =>
      log.updateWorkflowStep('nope', { status: 'succeeded' }),
    ).toThrow(/Workflow step not found/)
    log.close()
  })
})
