import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MockWebSocket,
  fixtures,
  installMockFetch,
} from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { RunsPanel } from './RunsPanel'

describe('RunsPanel', () => {
  it('lists runs and opens the stream on click', async () => {
    installMockFetch({ 'GET /api/runs/run_1/events': () => [] })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <RunsPanel />
      </ToastProvider>,
    )
    const row = await screen.findByText(fixtures.run.id)
    await userEvent.click(row)
    expect(
      await screen.findByRole('button', { name: /kill/i }),
    ).toBeInTheDocument()
  })

  it('renders a context-fullness chip once a run crosses its warn threshold', async () => {
    installMockFetch({
      'GET /api/runs': () => [
        { ...fixtures.run, inputTokens: 180_000, contextWindow: 200_000 },
      ],
      'GET /api/runs/run_1/events': () => [],
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <RunsPanel />
      </ToastProvider>,
    )
    expect(await screen.findByText('90% ctx')).toBeInTheDocument()
  })

  it('renders no fullness chip when a run has no inputTokens', async () => {
    installMockFetch({
      'GET /api/runs': () => [fixtures.run],
      'GET /api/runs/run_1/events': () => [],
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <RunsPanel />
      </ToastProvider>,
    )
    await screen.findByText(fixtures.run.id)
    expect(screen.queryByText(/% ctx/)).not.toBeInTheDocument()
  })
})
