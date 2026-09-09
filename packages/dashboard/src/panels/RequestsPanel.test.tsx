import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MockWebSocket,
  fixtures,
  installMockFetch,
} from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { RequestsPanel } from './RequestsPanel'

function setup(overrides = {}) {
  installMockFetch(overrides)
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
}

describe('RequestsPanel', () => {
  it('lists requests and opens the selected one', async () => {
    setup({ 'GET /api/runs/run_1/events': () => [] })
    render(
      <ToastProvider>
        <RequestsPanel />
      </ToastProvider>,
    )
    const row = await screen.findByText(fixtures.workflow.title)
    await userEvent.click(row)
    // "build" labels both the stepper row and the inline RunStream card's
    // heading for the active step (see RequestView.test.tsx).
    const matches = await screen.findAllByText('build')
    expect(matches.length).toBeGreaterThan(0)
  })

  it('shows an empty state with a New request action when there are none', async () => {
    setup({ 'GET /api/workflows': () => [] })
    render(
      <ToastProvider>
        <RequestsPanel />
      </ToastProvider>,
    )
    expect(await screen.findByText('No requests yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New request' })).toHaveLength(
      2,
    )
  })

  it('opens and closes the new request form', async () => {
    setup()
    render(
      <ToastProvider>
        <RequestsPanel />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'New request' }))
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  })
})
