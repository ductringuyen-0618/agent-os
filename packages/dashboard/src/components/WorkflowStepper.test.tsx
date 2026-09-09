import type { WorkflowStep } from '@agentos/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkflowStepper } from './WorkflowStepper'

const steps: WorkflowStep[] = [
  {
    id: 's2',
    workflowId: 'wf_1',
    name: 'build',
    seq: 2,
    status: 'running',
    attempt: 2,
    startedAt: '2026-09-09T10:01:00Z',
  },
  {
    id: 's1',
    workflowId: 'wf_1',
    name: 'brief',
    seq: 1,
    status: 'succeeded',
    attempt: 1,
    startedAt: '2026-09-09T10:00:00Z',
    endedAt: '2026-09-09T10:00:40Z',
    output: { costUsd: 0.15 },
  },
]

describe('WorkflowStepper', () => {
  it('orders steps by seq and shows status, retries, duration, and cost', () => {
    const now = Date.parse('2026-09-09T10:02:00Z')
    render(<WorkflowStepper steps={steps} now={now} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('brief')
    expect(rows[0]).toHaveTextContent('40 s')
    expect(rows[0]).toHaveTextContent('$0.15')
    expect(rows[1]).toHaveTextContent('build')
    expect(rows[1]).toHaveTextContent('retry 2')
  })
})
