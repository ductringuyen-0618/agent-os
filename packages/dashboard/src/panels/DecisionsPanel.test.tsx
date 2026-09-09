import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MockWebSocket,
  fixtures,
  installMockFetch,
} from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { DecisionsPanel } from './DecisionsPanel'

describe('DecisionsPanel', () => {
  it('lists pending decisions and opens the first one', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <DecisionsPanel />
      </ToastProvider>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Decisions' }),
    ).toBeInTheDocument()
    // Once in the list, once as the opened detail.
    expect(await screen.findAllByText('Approve proposal')).toHaveLength(2)
    expect(screen.getByText('Do the thing.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('selects another decision from the list', async () => {
    installMockFetch({
      'GET /api/decisions': () => [
        fixtures.decision,
        { ...fixtures.decision, id: 'dec_2', title: 'Second', body: 'Two.' },
      ],
    })
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <DecisionsPanel />
      </ToastProvider>,
    )
    await screen.findByRole('list', { name: 'Decision list' })
    await userEvent.click(screen.getByRole('button', { name: /Second/ }))
    expect(await screen.findByText('Two.')).toBeInTheDocument()
  })

  it('moves a resolved decision out of the waiting list', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(
      <ToastProvider>
        <DecisionsPanel />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm approval' }),
    )
    expect(
      await screen.findByText(/nothing waiting on you/i),
    ).toBeInTheDocument()
  })
})
