import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MockWebSocket, installMockFetch } from '../../tests/mockServer'
import { RunStream } from './RunStream'
import { ToastProvider } from './Toast'

describe('RunStream', () => {
  it('replays events then appends live assistant text', async () => {
    installMockFetch({
      'GET /api/runs/run_1/events': () => [
        {
          id: 1,
          ts: 't',
          type: 'run.stream',
          runId: 'run_1',
          payload: {
            message: {
              type: 'assistant',
              session_id: 's',
              message: {
                content: [{ type: 'text', text: 'hello from replay' }],
              },
            },
          },
        },
      ],
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <RunStream runId="run_1" onClose={() => {}} />
      </ToastProvider>,
    )
    expect(await screen.findByText('hello from replay')).toBeInTheDocument()
  })

  it('reads the kernel shape (message as the payload itself)', async () => {
    installMockFetch({
      'GET /api/runs/run_1/events': () => [
        {
          id: 1,
          ts: 't',
          type: 'run.stream',
          runId: 'run_1',
          payload: {
            type: 'assistant',
            session_id: 's',
            message: { content: [{ type: 'text', text: 'direct payload' }] },
          },
        },
        {
          id: 2,
          ts: 't',
          type: 'run.stream',
          runId: 'run_1',
          payload: {
            type: 'system',
            subtype: 'permission_denied',
            tool_name: 'Edit',
            message: 'Cannot write learnings.md',
          },
        },
        { id: 3, ts: 't', type: 'run.started', runId: 'run_1', payload: {} },
      ],
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <RunStream runId="run_1" onClose={() => {}} />
      </ToastProvider>,
    )
    expect(await screen.findByText('direct payload')).toBeInTheDocument()
    expect(
      screen.getByText(/Permission denied for Edit: Cannot write/),
    ).toBeInTheDocument()
  })

  it('says so when a run produced no output', async () => {
    installMockFetch({
      'GET /api/runs/run_1/events': () => [
        { id: 3, ts: 't', type: 'run.started', runId: 'run_1', payload: {} },
      ],
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <RunStream runId="run_1" onClose={() => {}} />
      </ToastProvider>,
    )
    expect(await screen.findByText(/no output recorded/i)).toBeInTheDocument()
  })

  it('kills the run', async () => {
    const kill = vi.fn(() => ({ ok: true }))
    installMockFetch({
      'GET /api/runs/run_1/events': () => [],
      'POST /api/runs/run_1/kill': kill,
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    const { default: userEvent } = await import('@testing-library/user-event')
    render(
      <ToastProvider>
        <RunStream runId="run_1" onClose={() => {}} />
      </ToastProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /kill/i }))
    await waitFor(() => expect(kill).toHaveBeenCalled())
  })
})
