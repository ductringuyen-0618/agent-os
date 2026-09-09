import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MockWebSocket, installMockFetch } from '../tests/mockServer'
import App from './App'

describe('App', () => {
  it('opens on the overview and switches panels via the left nav', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<App />)
    expect(
      screen.getByRole('navigation', { name: /agent-os/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Overview' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Decisions/ }))
    expect(
      await screen.findByRole('heading', { name: 'Decisions' }),
    ).toBeInTheDocument()
  })

  it('switches panels with number keys, but not while typing', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <>
        <input aria-label="scratch" />
        <App />
      </>,
    )
    await userEvent.keyboard('2')
    expect(
      await screen.findByRole('heading', { name: 'Runs' }),
    ).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('scratch'), '7')
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeInTheDocument()
  })

  it('switches to the Projects panel', async () => {
    installMockFetch()
    render(<App />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Projects', exact: true }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Projects' }),
    ).toBeInTheDocument()
  })

  it('opens the Requests panel from the left nav', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<App />)
    // Overview's own "Requests in flight" stat button also matches
    // /Requests/, so this needs an exact match on the nav item's label.
    await userEvent.click(
      screen.getByRole('button', { name: 'Requests', exact: true }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Requests' }),
    ).toBeInTheDocument()
  })

  it('reaches the tenth panel with the 0 key', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<App />)
    await userEvent.keyboard('0')
    expect(
      await screen.findByRole('heading', { name: 'Requests' }),
    ).toBeInTheDocument()
  })
})
