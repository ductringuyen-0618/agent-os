import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  MockWebSocket,
  fixtures,
  installMockFetch,
} from '../../tests/mockServer'
import { MessagesPanel } from './MessagesPanel'

describe('MessagesPanel', () => {
  it('lists a sent message with its sender and recipient', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<MessagesPanel />)
    expect(await screen.findByText(fixtures.message.from)).toBeInTheDocument()
    expect(screen.getByText(fixtures.message.to)).toBeInTheDocument()
    expect(screen.getByText(fixtures.message.body)).toBeInTheDocument()
  })

  it('shows an empty state when no messages have been sent', async () => {
    installMockFetch({ 'GET /api/messages': () => [] })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<MessagesPanel />)
    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument()
  })
})
