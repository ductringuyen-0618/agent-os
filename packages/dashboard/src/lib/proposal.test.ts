import { describe, expect, it } from 'vitest'
import { brief, firstLine, parseEffort, parseSections } from './proposal'

const FULL = `---
status: proposed
attempts: 0
---
# Cost budgets

## What you get
A per-routine daily cap. When it trips, the run is skipped and you see an alert.

## Why start this now
Nothing stops a runaway routine today. You find out from the chart tomorrow.

## Problem / opportunity
Long problem text.

## Proposed solution
- change scheduler.ts

## Effort estimate
S — one guard clause and one query.

## Validation contract
- Functional: ...

## Risks / open questions
- none
`

const LEGACY = `# Permalinks

## Problem / opportunity
Reports have no URL.

## Why this increases engagement
- Sharing: a report becomes a link.

## Proposed solution
Add a route.

## Effort estimate
**S/M.** The backend is already done.
`

describe('parseSections', () => {
  it('drops frontmatter and the H1, splits on H2', () => {
    const { intro, sections } = parseSections(FULL)
    expect(intro).toBe('')
    expect(sections.map((s) => s.title)).toEqual([
      'What you get',
      'Why start this now',
      'Problem / opportunity',
      'Proposed solution',
      'Effort estimate',
      'Validation contract',
      'Risks / open questions',
    ])
  })
})

describe('parseEffort', () => {
  it('reads the size letter and keeps the reason', () => {
    expect(parseEffort('S — one guard clause.')).toEqual({
      effort: 'S',
      note: 'one guard clause.',
    })
    expect(parseEffort('**S/M.** The backend is done.')).toEqual({
      effort: 'S/M',
      note: 'The backend is done.',
    })
    expect(parseEffort('M. No backend work.').effort).toBe('M')
    expect(parseEffort('Unknown shape').effort).toBeNull()
  })
})

describe('brief', () => {
  it('prefers the explicit what/why sections and leaves the rest as details', () => {
    const b = brief(FULL)
    expect(b.what).toMatch(/per-routine daily cap/)
    expect(b.why).toMatch(/runaway routine/)
    expect(b.effort).toBe('S')
    expect(b.effortNote).toBe('one guard clause and one query.')
    expect(b.details.map((d) => d.title)).toEqual([
      'Problem / opportunity',
      'Proposed solution',
      'Validation contract',
      'Risks / open questions',
    ])
  })

  it('falls back to problem + engagement sections for older proposals', () => {
    const b = brief(LEGACY)
    expect(b.what).toBe('Add a route.')
    expect(b.why).toContain('**Problem / opportunity**')
    expect(b.why).toContain('Reports have no URL.')
    expect(b.why).toContain('a report becomes a link')
    expect(b.effort).toBe('S/M')
    expect(b.details).toEqual([])
  })
})

describe('firstLine', () => {
  it('strips list markers, links and emphasis, and truncates', () => {
    expect(firstLine('- **Sharing**: a [report](x) becomes a link.')).toBe(
      'Sharing: a report becomes a link.',
    )
    expect(firstLine('A `daily_budget_usd` key, _really_.')).toBe(
      'A daily_budget_usd key, really.',
    )
    expect(firstLine('x'.repeat(300), 20)).toHaveLength(20)
    expect(firstLine(null)).toBe('')
  })
})
