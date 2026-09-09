import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders blocked with danger styling', () => {
    render(<StatusBadge status="blocked" />)
    const badge = screen.getByText('blocked')
    expect(badge).toHaveClass('text-danger')
  })

  it('marks a request waiting on a human as signal amber', () => {
    render(<StatusBadge status="waiting" />)
    expect(screen.getByText('waiting')).toHaveClass('text-signal')
  })
  it('marks a finished request success-green and a terminated one danger-red', () => {
    const { rerender } = render(<StatusBadge status="succeeded" />)
    expect(screen.getByText('succeeded')).toHaveClass('text-success')
    rerender(<StatusBadge status="terminated" />)
    expect(screen.getByText('terminated')).toHaveClass('text-danger')
  })
  it('marks a paused or sleeping request muted, not urgent', () => {
    const { rerender } = render(<StatusBadge status="paused" />)
    expect(screen.getByText('paused')).toHaveClass('text-muted')
    rerender(<StatusBadge status="sleeping" />)
    expect(screen.getByText('sleeping')).toHaveClass('text-muted')
  })
})
