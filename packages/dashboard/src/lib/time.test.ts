import { describe, expect, it } from 'vitest'
import { duration, relativeTime, usd } from './time'

const NOW = Date.parse('2026-09-09T12:00:00Z')

describe('relativeTime', () => {
  it('reads like a person would say it', () => {
    expect(relativeTime('2026-09-09T11:59:50Z', NOW)).toBe('just now')
    expect(relativeTime('2026-09-09T11:57:00Z', NOW)).toBe('3 min ago')
    expect(relativeTime('2026-09-09T09:00:00Z', NOW)).toBe('3 h ago')
    expect(relativeTime('2026-09-08T10:00:00Z', NOW)).toBe('yesterday')
    expect(relativeTime('2026-09-09T12:00:30Z', NOW)).toBe('just now')
    expect(relativeTime('2026-09-09T12:05:00Z', NOW)).toBe('in a moment')
  })
  it('handles missing or unparseable input', () => {
    expect(relativeTime(undefined, NOW)).toBe('—')
    expect(relativeTime('nope', NOW)).toBe('nope')
  })
})

describe('duration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(duration('2026-09-09T11:59:18Z', '2026-09-09T12:00:00Z')).toBe(
      '42 s',
    )
    expect(duration('2026-09-09T11:56:48Z', '2026-09-09T12:00:00Z')).toBe(
      '3 m 12 s',
    )
    expect(duration('2026-09-09T10:56:00Z', '2026-09-09T12:00:00Z')).toBe(
      '1 h 04 m',
    )
  })
  it('counts an open run up to now', () => {
    expect(duration('2026-09-09T11:59:00Z', undefined, NOW)).toBe('1 m 00 s')
    expect(duration(undefined, undefined, NOW)).toBe('—')
  })
})

describe('usd', () => {
  it('never shows a misleading $0.00 for tiny spend', () => {
    expect(usd(0)).toBe('$0.00')
    expect(usd(0.004)).toBe('<$0.01')
    expect(usd(0.34)).toBe('$0.34')
    expect(usd(12.4)).toBe('$12.40')
    expect(usd(undefined)).toBe('—')
  })
})
