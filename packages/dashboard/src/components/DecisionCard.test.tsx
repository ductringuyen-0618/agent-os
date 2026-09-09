import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fixtures, installMockFetch } from '../../tests/mockServer'
import { DecisionCard } from './DecisionCard'
import { ToastProvider } from './Toast'

describe('DecisionCard', () => {
  it('asks for confirmation, then approves optimistically', async () => {
    installMockFetch()
    const onResolved = vi.fn()
    render(
      <ToastProvider>
        <DecisionCard decision={fixtures.decision} onResolved={onResolved} />
      </ToastProvider>,
    )
    expect(screen.getByText('Approve proposal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    // Nothing happens until the person confirms.
    expect(onResolved).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/marks this decision approved/i)
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm approval' }),
    )
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    )
    expect(
      await screen.findByText(/Approved: Approve proposal/),
    ).toBeInTheDocument()
  })

  it('explains the git side effects for adapter-backed decisions', async () => {
    installMockFetch()
    render(
      <ToastProvider>
        <DecisionCard
          decision={{
            ...fixtures.decision,
            adapter: 'techpulse-coo',
            ref: 'proposals/001.md',
          }}
          onResolved={() => {}}
        />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      /proposals\/001\.md as rejected .* commits .* pushes/i,
    )
  })

  it('cancelling leaves the decision untouched', async () => {
    installMockFetch()
    const onResolved = vi.fn()
    render(
      <ToastProvider>
        <DecisionCard decision={fixtures.decision} onResolved={onResolved} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onResolved).not.toHaveBeenCalled()
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
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm rejection' }),
    )
    expect(await screen.findByText(/failed to reject/i)).toBeInTheDocument()
  })

  it('compact variant shows a one-line summary', () => {
    installMockFetch()
    render(
      <ToastProvider>
        <DecisionCard
          decision={fixtures.decision}
          onResolved={() => {}}
          variant="compact"
        />
      </ToastProvider>,
    )
    expect(screen.getByText('Do the thing.')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

describe('DecisionCard compact brief', () => {
  it('shows what and why-now lines from the proposal sections', () => {
    installMockFetch()
    render(
      <ToastProvider>
        <DecisionCard
          decision={{
            ...fixtures.decision,
            body: [
              '## What you get',
              'A cap.',
              '',
              '## Why start this now',
              'Spend is invisible.',
              '',
              '## Effort estimate',
              'S — tiny.',
            ].join('\n'),
          }}
          onResolved={() => {}}
          variant="compact"
        />
      </ToastProvider>,
    )
    expect(screen.getByText('A cap.')).toBeInTheDocument()
    expect(screen.getByText('Spend is invisible.')).toBeInTheDocument()
    expect(screen.getByTitle('Effort estimate')).toHaveTextContent('S')
  })

  it('labels the card with the project, falling back to the adapter', () => {
    installMockFetch()
    const { rerender } = render(
      <ToastProvider>
        <DecisionCard
          decision={{
            ...fixtures.decision,
            adapter: 'techpulse-coo',
            project: 'agent-os',
          }}
          onResolved={() => {}}
          variant="compact"
        />
      </ToastProvider>,
    )
    expect(screen.getByText(/agent-os,/)).toBeInTheDocument()
    expect(screen.queryByText(/techpulse-coo/)).not.toBeInTheDocument()
    rerender(
      <ToastProvider>
        <DecisionCard
          decision={{ ...fixtures.decision, adapter: 'techpulse-coo' }}
          onResolved={() => {}}
          variant="compact"
        />
      </ToastProvider>,
    )
    expect(screen.getByText(/techpulse-coo,/)).toBeInTheDocument()
  })

  it('strips list markers from the first body line', () => {
    installMockFetch()
    render(
      <ToastProvider>
        <DecisionCard
          decision={{
            ...fixtures.decision,
            body: '# T\n\n- **Session**: longer',
          }}
          onResolved={() => {}}
          variant="compact"
        />
      </ToastProvider>,
    )
    expect(screen.getByText('Session: longer')).toBeInTheDocument()
  })
})
