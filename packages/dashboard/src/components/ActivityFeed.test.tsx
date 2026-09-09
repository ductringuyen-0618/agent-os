import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActivityFeed } from './ActivityFeed'

const NOW = Date.parse('2026-09-09T12:00:00Z')

describe('ActivityFeed', () => {
  it('renders items with relative times and opens the run on click', async () => {
    const onOpenRun = vi.fn()
    render(
      <ActivityFeed
        now={NOW}
        onOpenRun={onOpenRun}
        items={[
          {
            id: 'a',
            ts: '2026-09-09T11:57:00Z',
            kind: 'run',
            text: 'heartbeat finished',
            runId: 'run_1',
          },
          {
            id: 'b',
            ts: '2026-09-09T11:00:00Z',
            kind: 'human',
            text: 'Waiting on you: Ship it',
          },
        ]}
      />,
    )
    expect(screen.getByText('3 min ago')).toBeInTheDocument()
    expect(screen.getByText('1 h ago')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'heartbeat finished' }),
    )
    expect(onOpenRun).toHaveBeenCalledWith('run_1')
  })

  it('invites action when empty', () => {
    render(<ActivityFeed items={[]} />)
    expect(screen.getByText(/nothing yet/i)).toBeInTheDocument()
  })
})
