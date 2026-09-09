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
})
