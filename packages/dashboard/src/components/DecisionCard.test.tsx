import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fixtures, installMockFetch } from '../../tests/mockServer'
import { DecisionCard } from './DecisionCard'
import { ToastProvider } from './Toast'

describe('DecisionCard', () => {
  it('approves optimistically and calls onResolved', async () => {
    installMockFetch()
    const onResolved = vi.fn()
    render(
      <ToastProvider>
        <DecisionCard decision={fixtures.decision} onResolved={onResolved} />
      </ToastProvider>,
    )
    expect(screen.getByText('Approve proposal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    )
  })

  it('shows a toast on failed reject', async () => {
    installMockFetch({
      'POST /api/decisions/dec_1/reject': () => {
        throw new Error('boom')
      },
    })
    render(
      <ToastProvider>
        <DecisionCard decision={fixtures.decision} onResolved={() => {}} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(await screen.findByText(/failed to reject/i)).toBeInTheDocument()
  })
})
