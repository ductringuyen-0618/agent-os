import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installMockFetch } from '../../tests/mockServer'
import { CostsPanel } from './CostsPanel'

describe('CostsPanel', () => {
  it('renders an svg bar per day', async () => {
    installMockFetch({
      'GET /api/costs': () => [
        { day: '2026-09-07', agent: 'ops', costUsd: 0.1 },
        { day: '2026-09-08', agent: 'ops', costUsd: 0.4 },
      ],
    })
    render(<CostsPanel />)
    expect(await screen.findByTestId('cost-bar-2026-09-08')).toBeInTheDocument()
  })

  it('shows a Budgets row when a routine has a daily cap configured', async () => {
    installMockFetch({
      'GET /api/costs': () => [
        { day: '2026-09-08', agent: 'ops', costUsd: 0.4 },
      ],
      'GET /api/routines': () => [
        {
          routine: { name: 'heartbeat', every: '30m' },
          dailyBudgetUsd: 1,
          spentTodayUsd: 0.4,
        },
      ],
    })
    render(<CostsPanel />)
    expect(await screen.findByText('Budgets')).toBeInTheDocument()
    expect(screen.getByText('$0.40 / $1.00')).toBeInTheDocument()
  })

  it('omits the Budgets row when no routine has a daily cap', async () => {
    installMockFetch({
      'GET /api/costs': () => [
        { day: '2026-09-08', agent: 'ops', costUsd: 0.4 },
      ],
      'GET /api/routines': () => [
        { routine: { name: 'heartbeat', every: '30m' } },
      ],
    })
    render(<CostsPanel />)
    await screen.findByTestId('cost-bar-2026-09-08')
    expect(screen.queryByText('Budgets')).not.toBeInTheDocument()
  })
})
