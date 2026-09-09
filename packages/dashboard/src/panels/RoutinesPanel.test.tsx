import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { ToastProvider } from '../components/Toast'
import { RoutinesPanel } from './RoutinesPanel'

describe('RoutinesPanel', () => {
  it('runs a routine now', async () => {
    const run = vi.fn(() => ({ runId: 'run_9' }))
    installMockFetch({ 'POST /api/routines/heartbeat/run': run })
    render(
      <ToastProvider>
        <RoutinesPanel />
      </ToastProvider>,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /run now/i }),
    )
    expect(run).toHaveBeenCalled()
  })

  it('shows the spend-vs-cap chip only for a routine with a budget configured', async () => {
    installMockFetch({
      'GET /api/routines': () => [
        {
          routine: { name: 'heartbeat', every: '30m' },
          dailyBudgetUsd: 1,
          spentTodayUsd: 0.42,
        },
        { routine: { name: 'ingest', on: ['raw.added'] } },
      ],
    })
    render(
      <ToastProvider>
        <RoutinesPanel />
      </ToastProvider>,
    )
    expect(await screen.findByText('$0.42 / $1.00')).toBeInTheDocument()
    expect(screen.queryByText('budget hit')).not.toBeInTheDocument()
  })

  it('shows a budget hit chip once a routine has tripped its cap', async () => {
    installMockFetch({
      'GET /api/routines': () => [
        {
          routine: { name: 'heartbeat', every: '30m' },
          dailyBudgetUsd: 1,
          spentTodayUsd: 1.2,
          budgetTripped: true,
        },
      ],
    })
    render(
      <ToastProvider>
        <RoutinesPanel />
      </ToastProvider>,
    )
    expect(await screen.findByText('budget hit')).toBeInTheDocument()
  })
})
