import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PulseStrip } from './PulseStrip'

const NOW = Date.parse('2026-09-09T12:00:00Z')

describe('PulseStrip', () => {
  it('draws one tick per event inside the window and drops older ones', () => {
    render(
      <PulseStrip
        now={NOW}
        ticks={[
          { ts: '2026-09-09T11:59:00Z', kind: 'run' },
          { ts: '2026-09-09T11:30:00Z', kind: 'human' },
          { ts: '2026-09-09T10:00:00Z', kind: 'run' },
        ]}
      />,
    )
    const ticks = screen.getAllByTestId('pulse-tick')
    expect(ticks).toHaveLength(2)
    expect(ticks.map((t) => t.getAttribute('data-kind'))).toEqual([
      'run',
      'human',
    ])
    expect(
      screen.getByText('2 events in the last 60 minutes'),
    ).toBeInTheDocument()
  })

  it('says so when nothing happened', () => {
    render(<PulseStrip now={NOW} ticks={[]} live={false} />)
    expect(
      screen.getByText('Quiet for the last 60 minutes'),
    ).toBeInTheDocument()
    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
  })
})
