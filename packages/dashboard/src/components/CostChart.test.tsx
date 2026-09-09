import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CostChart } from './CostChart'

describe('CostChart', () => {
  it('draws the whole window ending today and stacks agents per day', () => {
    const now = Date.parse('2026-09-09T15:00:00Z')
    render(
      <CostChart
        now={now}
        window={14}
        entries={[
          { day: '2026-09-09', agent: 'ops', costUsd: 0.5 },
          { day: '2026-09-09', agent: 'librarian', costUsd: 0.25 },
        ]}
      />,
    )
    expect(screen.getByTestId('cost-bar-2026-08-27')).toBeInTheDocument()
    expect(
      screen.getByTestId('cost-bar-2026-09-09').querySelectorAll('rect'),
    ).toHaveLength(2)
    expect(screen.getByRole('img', { name: /14 days/ })).toBeInTheDocument()
    expect(screen.getByText('librarian')).toBeInTheDocument()
  })
})
