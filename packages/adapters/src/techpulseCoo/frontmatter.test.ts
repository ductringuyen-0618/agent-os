import { describe, expect, it } from 'vitest'
import { readStatus, setStatus } from './frontmatter.js'

const sample = `---
title: Add dark mode toggle
status: proposed
attempts: 0
branch: null
---

# Add dark mode toggle

## Why this increases engagement
Users have asked for this repeatedly.

## Effort estimate
Small, about 2 hours.
`

describe('frontmatter', () => {
  it('reads the status field', () => {
    expect(readStatus(sample)).toBe('proposed')
  })

  it('flips status while preserving body and other keys byte-for-byte', () => {
    const updated = setStatus(sample, 'approved')
    expect(readStatus(updated)).toBe('approved')
    expect(updated).toContain('attempts: 0')
    expect(updated).toContain('branch: null')
    const [, , sampleBody] = sample.split('---')
    const [, , updatedBody] = updated.split('---')
    expect(updatedBody).toBe(sampleBody)
  })

  it('throws when there is no frontmatter block', () => {
    expect(() => readStatus('# no frontmatter here')).toThrow()
  })

  it('throws when there is no status line', () => {
    const noStatus = '---\ntitle: x\n---\nbody'
    expect(() => setStatus(noStatus, 'approved')).toThrow()
  })
})
