import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DecisionBrief } from './DecisionBrief'

describe('DecisionBrief', () => {
  it('shows what and why first, folds the rest', () => {
    render(
      <DecisionBrief
        body={`## What you get
A daily cap per routine.

## Why start this now
Runaway spend is invisible until tomorrow.

## Effort estimate
S — one guard clause.

## Validation contract
- Functional: cap trips`}
      />,
    )
    expect(screen.getByText('What you get')).toBeInTheDocument()
    expect(screen.getByText('A daily cap per routine.')).toBeInTheDocument()
    expect(screen.getByText('Why start this now')).toBeInTheDocument()
    expect(screen.getByText(/Effort S\./)).toBeInTheDocument()
    const details = screen.getByText('Validation contract').closest('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
  })

  it('falls back to plain markdown when there are no sections', () => {
    render(<DecisionBrief body={'# Proposal\nDo the thing.'} />)
    expect(screen.getByText('Do the thing.')).toBeInTheDocument()
    expect(screen.queryByText('What you get')).not.toBeInTheDocument()
  })
})
