import type { Run } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import {
  afterSatisfied,
  matchesOn,
  parseEvery,
} from '../../src/scheduler/triggers.js'

describe('parseEvery', () => {
  it('parses seconds, minutes, hours', () => {
    expect(parseEvery('90s')).toBe(90_000)
    expect(parseEvery('30m')).toBe(1_800_000)
    expect(parseEvery('1h')).toBe(3_600_000)
  })
  it('throws on invalid input', () => {
    expect(() => parseEvery('banana')).toThrow(/invalid every duration/)
  })
})

describe('matchesOn', () => {
  it('matches exact event types', () => {
    expect(matchesOn(['raw.added'], 'raw.added')).toBe(true)
    expect(matchesOn(['raw.added'], 'raw.changed')).toBe(false)
  })
  it('matches the custom.* wildcard', () => {
    expect(matchesOn(['custom.*'], 'custom.anything')).toBe(true)
    expect(matchesOn(['custom.*'], 'raw.added')).toBe(false)
  })
  it('returns false for undefined/empty on', () => {
    expect(matchesOn(undefined, 'raw.added')).toBe(false)
    expect(matchesOn([], 'raw.added')).toBe(false)
  })
})

describe('afterSatisfied', () => {
  const today = new Date().toISOString()
  it('true when there is no after clause', () => {
    expect(afterSatisfied(undefined, new Map())).toBe(true)
  })
  it('true only if every named routine last ran successfully today', () => {
    const ok: Run = {
      id: '1',
      routine: 'lint',
      status: 'success',
      attempt: 1,
      endedAt: today,
    }
    expect(afterSatisfied(['lint'], new Map([['lint', ok]]))).toBe(true)
  })
  it('false if the last run failed', () => {
    const bad: Run = {
      id: '1',
      routine: 'lint',
      status: 'failed',
      attempt: 1,
      endedAt: today,
    }
    expect(afterSatisfied(['lint'], new Map([['lint', bad]]))).toBe(false)
  })
  it('false if no run is recorded', () => {
    expect(afterSatisfied(['lint'], new Map())).toBe(false)
  })
  it('false if the last successful run was not today', () => {
    const stale: Run = {
      id: '1',
      routine: 'lint',
      status: 'success',
      attempt: 1,
      endedAt: '2020-01-01T00:00:00.000Z',
    }
    expect(afterSatisfied(['lint'], new Map([['lint', stale]]))).toBe(false)
  })
})
