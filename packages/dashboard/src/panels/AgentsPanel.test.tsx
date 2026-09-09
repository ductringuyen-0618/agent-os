import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MockWebSocket, installMockFetch } from '../../tests/mockServer'
import { AgentsPanel } from './AgentsPanel'

describe('AgentsPanel', () => {
  it('renders agent cards with status badges', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<AgentsPanel />)
    expect(await screen.findByText('ops')).toBeInTheDocument()
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('shows empty state when no agents configured', async () => {
    installMockFetch({ 'GET /api/agents': () => [] })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<AgentsPanel />)
    expect(await screen.findByText(/no agents/i)).toBeInTheDocument()
  })
})
