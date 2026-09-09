import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MockWebSocket, installMockFetch } from '../../tests/mockServer'
import { RequestView } from './RequestView'
import { ToastProvider } from './Toast'

function setup(overrides = {}) {
  installMockFetch(overrides)
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
}

describe('RequestView', () => {
  it('shows the stepper, cost, and streams the active run inline', async () => {
    setup({
      'GET /api/workflows/wf_1': () => ({
        workflow: {
          id: 'wf_1',
          kind: 'feature-request',
          status: 'running',
          project: 'techpulse',
          title: 'Add a personalized company digest',
          input: {},
          currentStep: 'build',
          state: { brief: { costUsd: 0.1 } },
          startedAt: '2026-09-09T10:00:00Z',
          createdAt: '2026-09-09T10:00:00Z',
          updatedAt: '2026-09-09T10:01:00Z',
        },
        steps: [
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
            runId: 'run_1',
            startedAt: '2026-09-09T10:01:00Z',
          },
        ],
      }),
      'GET /api/runs/run_1/events': () => [],
    })
    render(
      <ToastProvider>
        <RequestView workflowId="wf_1" />
      </ToastProvider>,
    )
    expect(
      await screen.findByText('Add a personalized company digest'),
    ).toBeInTheDocument()
    // Both the workflow header and the active "build" step badge read
    // "running" here, so scope to "at least one" rather than a single match.
    expect(screen.getAllByText('running').length).toBeGreaterThan(0)
    // The header's total cost and the "brief" step's own cost are both
    // $0.10 here (one step's output vs. the workflow-level state sum).
    expect(screen.getAllByText('$0.10').length).toBeGreaterThan(0)
    // "build" labels both the stepper row and the inline RunStream card's
    // heading for the active step.
    expect(screen.getAllByText('build').length).toBeGreaterThan(0)
    expect(await screen.findByText(/no output recorded/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument()
  })

  it('offers Retry from this step on a failed request', async () => {
    setup({
      'GET /api/workflows/wf_1': () => ({
        workflow: {
          id: 'wf_1',
          kind: 'feature-request',
          status: 'failed',
          title: 'Add a widget',
          input: {},
          state: {},
          error: 'validate check failed',
          createdAt: '2026-09-09T10:00:00Z',
          updatedAt: '2026-09-09T10:01:00Z',
        },
        steps: [
          {
            id: 's1',
            workflowId: 'wf_1',
            name: 'validate',
            seq: 1,
            status: 'failed',
            attempt: 1,
            error: 'lint failed',
            startedAt: '2026-09-09T10:00:00Z',
          },
        ],
      }),
      'POST /api/workflows/wf_1/resume': () => ({
        id: 'wf_1',
        kind: 'feature-request',
        status: 'running',
        title: 'Add a widget',
        input: {},
        state: {},
        createdAt: '2026-09-09T10:00:00Z',
        updatedAt: '2026-09-09T10:02:00Z',
      }),
    })
    render(
      <ToastProvider>
        <RequestView workflowId="wf_1" />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Retry from this step' }),
    )
    expect(
      await screen.findByText('Retrying from the failed step'),
    ).toBeInTheDocument()
  })

  it('asks for confirmation, then terminates', async () => {
    setup({
      'GET /api/workflows/wf_1': () => ({
        workflow: {
          id: 'wf_1',
          kind: 'feature-request',
          status: 'running',
          title: 'Add a widget',
          input: {},
          state: {},
          createdAt: '2026-09-09T10:00:00Z',
          updatedAt: '2026-09-09T10:01:00Z',
        },
        steps: [],
      }),
      'POST /api/workflows/wf_1/terminate': () => ({
        id: 'wf_1',
        kind: 'feature-request',
        status: 'terminated',
        title: 'Add a widget',
        input: {},
        state: {},
        createdAt: '2026-09-09T10:00:00Z',
        updatedAt: '2026-09-09T10:02:00Z',
      }),
    })
    render(
      <ToastProvider>
        <RequestView workflowId="wf_1" />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Terminate' }),
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Terminate request?')
    await userEvent.click(
      screen.getByRole('button', { name: 'Terminate request' }),
    )
    await waitFor(() =>
      expect(screen.getByText('Terminated')).toBeInTheDocument(),
    )
  })
})

describe('RequestView explains what happens next', () => {
  function workflowWith(status: string, stepNames: string[]) {
    return {
      workflow: {
        id: 'wf_1',
        kind: 'feature-request',
        status,
        project: 'techpulse',
        title: 'Add a personalized company digest',
        input: {},
        state: {},
        startedAt: '2026-09-09T10:00:00Z',
        createdAt: '2026-09-09T10:00:00Z',
        updatedAt: '2026-09-09T10:01:00Z',
      },
      steps: stepNames.map((name, i) => ({
        id: `s${i}`,
        workflowId: 'wf_1',
        name,
        seq: i + 1,
        status: 'succeeded',
        attempt: 1,
        startedAt: '2026-09-09T10:00:00Z',
        endedAt: '2026-09-09T10:00:30Z',
      })),
    }
  }

  it('tells the operator to approve under Decisions while waiting', async () => {
    setup({
      'GET /api/workflows/wf_1': () =>
        workflowWith('waiting', ['brief', 'push-proposal', 'await-approval']),
    })
    render(
      <ToastProvider>
        <RequestView workflowId="wf_1" />
      </ToastProvider>,
    )
    expect(
      await screen.findByText(/waiting for your call/i),
    ).toBeInTheDocument()
  })

  it('explains a request that ended after approval without a build grant', async () => {
    setup({
      'GET /api/workflows/wf_1': () =>
        workflowWith('succeeded', ['brief', 'push-proposal', 'await-approval']),
    })
    render(
      <ToastProvider>
        <RequestView workflowId="wf_1" />
      </ToastProvider>,
    )
    expect(
      await screen.findByText(/techpulse has no build grant/i),
    ).toBeInTheDocument()
  })

  it('says nothing extra when the request was built', async () => {
    setup({
      'GET /api/workflows/wf_1': () =>
        workflowWith('succeeded', ['brief', 'build', 'validate', 'done']),
    })
    render(
      <ToastProvider>
        <RequestView workflowId="wf_1" />
      </ToastProvider>,
    )
    await screen.findByText('Add a personalized company digest')
    expect(screen.queryByText(/no build grant/i)).not.toBeInTheDocument()
  })
})
