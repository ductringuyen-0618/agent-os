import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockWebSocket, installMockFetch } from '../../tests/mockServer'
import { SystemPauseBar } from './SystemPauseBar'
import { ToastProvider } from './Toast'

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
})

describe('SystemPauseBar', () => {
  it('shows a slim "Pause all" control when the daemon is running', async () => {
    installMockFetch()
    render(
      <ToastProvider>
        <SystemPauseBar />
      </ToastProvider>,
    )
    expect(
      await screen.findByRole('button', { name: /pause all/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^paused$/i)).not.toBeInTheDocument()
  })

  it('shows the red banner on load when already paused', async () => {
    installMockFetch({
      'GET /api/system/pause': () => ({
        at: '2026-09-13T00:00:00Z',
        reason: 'bad deploy',
        by: 'cli',
      }),
    })
    render(
      <ToastProvider>
        <SystemPauseBar />
      </ToastProvider>,
    )
    expect(await screen.findByText(/bad deploy/)).toBeInTheDocument()
    expect(screen.getByText(/by cli/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
  })

  it('shows "no reason given" when a pause carries no reason', async () => {
    installMockFetch({
      'GET /api/system/pause': () => ({ at: '2026-09-13T00:00:00Z' }),
    })
    render(
      <ToastProvider>
        <SystemPauseBar />
      </ToastProvider>,
    )
    expect(await screen.findByText(/no reason given/)).toBeInTheDocument()
  })

  it('pauses via the confirm dialog and switches to the banner', async () => {
    const pause = vi.fn(() => ({
      pause: { at: '2026-09-13T01:00:00Z', reason: 'testing', by: 'dashboard' },
    }))
    installMockFetch({ 'POST /api/system/pause': pause })
    render(
      <ToastProvider>
        <SystemPauseBar />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /pause all/i }),
    )
    await userEvent.type(await screen.findByLabelText(/reason/i), 'testing')
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(pause).toHaveBeenCalled()
    expect(await screen.findByText(/testing/)).toBeInTheDocument()
  })

  it('resumes and drops back to the slim control', async () => {
    const resume = vi.fn(() => ({ ok: true }))
    installMockFetch({
      'GET /api/system/pause': () => ({ at: '2026-09-13T00:00:00Z' }),
      'POST /api/system/resume': resume,
    })
    render(
      <ToastProvider>
        <SystemPauseBar />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /resume/i }),
    )
    expect(resume).toHaveBeenCalled()
    expect(
      await screen.findByRole('button', { name: /pause all/i }),
    ).toBeInTheDocument()
  })

  it('refreshes from a live daemon_paused ops.alert event', async () => {
    let paused = false
    installMockFetch({
      'GET /api/system/pause': () =>
        paused ? { at: '2026-09-13T02:00:00Z', reason: 'live' } : null,
    })
    render(
      <ToastProvider>
        <SystemPauseBar />
      </ToastProvider>,
    )
    await screen.findByRole('button', { name: /pause all/i })
    paused = true
    const socket = MockWebSocket.instances[0]
    socket.emit({
      id: 1,
      ts: '2026-09-13T02:00:00Z',
      type: 'ops.alert',
      payload: { reason: 'daemon_paused' },
    })
    expect(await screen.findByText(/live/)).toBeInTheDocument()
  })
})
