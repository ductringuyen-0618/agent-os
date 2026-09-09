import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MockWebSocket,
  fixtures,
  installMockFetch,
} from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { OverviewPanel } from './OverviewPanel'

function setup(overrides = {}) {
  installMockFetch(overrides)
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
}

describe('OverviewPanel', () => {
  it('shows what needs you, who is working, and the pulse', async () => {
    setup({
      'GET /api/agents': () => [
        { name: 'ops', status: 'working', currentRun: 'run_1' },
        { name: 'librarian', status: 'idle' },
      ],
    })
    render(
      <ToastProvider>
        <OverviewPanel />
      </ToastProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Overview' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('1 working now')).toBeInTheDocument()
    expect(screen.getByText('needs a decision')).toBeInTheDocument()
    expect(screen.getByText(fixtures.decision.title)).toBeInTheDocument()
    expect(screen.getByText('ops')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /timeline/i })).toBeInTheDocument()
  })

  it('folds live events into the activity feed', async () => {
    setup()
    render(
      <ToastProvider>
        <OverviewPanel />
      </ToastProvider>,
    )
    await screen.findByText(fixtures.decision.title)
    const socket = MockWebSocket.instances[0]
    act(() => {
      socket.emit({
        id: 99,
        ts: new Date().toISOString(),
        type: 'git.push',
        payload: { branch: 'main' },
      })
    })
    expect(await screen.findByText('Pushed to main')).toBeInTheDocument()
  })

  it('jumps to Decisions from the stat card', async () => {
    setup()
    const onNavigate = vi.fn()
    render(
      <ToastProvider>
        <OverviewPanel onNavigate={onNavigate} />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /Waiting on you/ }),
    )
    expect(onNavigate).toHaveBeenCalledWith('decisions')
  })
})
