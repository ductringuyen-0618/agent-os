import { describe, expect, it } from 'vitest'
import {
  appendLogLine,
  formatIndexLine,
  formatLogLine,
  upsertIndexEntry,
} from './index.js'

describe('formatIndexLine', () => {
  it('renders title, type, updated', () => {
    const line = formatIndexLine({
      path: 'projects/a.md',
      title: 'a',
      type: 'ingest',
      updated: '2026-09-08T00:00:00.000Z',
    })
    expect(line).toBe(
      '- [a](projects/a.md) — type: ingest — updated: 2026-09-08T00:00:00.000Z',
    )
  })
  it('appends sources and tags when present', () => {
    const line = formatIndexLine({
      path: 'projects/a.md',
      title: 'a',
      type: 'ingest',
      updated: '2026-09-08T00:00:00.000Z',
      sources: ['raw/a.md'],
      tags: ['techpulse'],
    })
    expect(line).toContain('sources: raw/a.md')
    expect(line).toContain('tags: techpulse')
  })
})

describe('upsertIndexEntry', () => {
  const entry = {
    path: 'projects/a.md',
    title: 'a',
    type: 'ingest',
    updated: '2026-09-08T00:00:00.000Z',
  }
  it('appends to an empty index', () => {
    const out = upsertIndexEntry('', entry)
    expect(out).toContain('](projects/a.md)')
  })
  it('replaces the existing line for the same path instead of duplicating', () => {
    const first = upsertIndexEntry('', entry)
    const updated = { ...entry, updated: '2026-09-09T00:00:00.000Z' }
    const out = upsertIndexEntry(first, updated)
    const matches = out
      .split('\n')
      .filter((l) => l.includes('](projects/a.md)'))
    expect(matches).toHaveLength(1)
    expect(matches[0]).toContain('2026-09-09')
  })
})

describe('log helpers', () => {
  it('formats a log line per the contract §10 format', () => {
    expect(formatLogLine('ingest', 'Proposal 001', '2026-09-08')).toBe(
      '## [2026-09-08] ingest | Proposal 001',
    )
  })
  it('appends to existing log content', () => {
    const out = appendLogLine(
      '# Wiki Log',
      '## [2026-09-08] ingest | Proposal 001',
    )
    expect(out).toContain('# Wiki Log')
    expect(out).toContain('## [2026-09-08] ingest | Proposal 001')
  })
})

describe('upsertIndexEntry placeholder', () => {
  it('drops the template "(none yet ...)" bullet once a real page is indexed', () => {
    const template = [
      '# Wiki Index',
      '',
      '## Pages',
      '- (none yet — this is a fresh instance; the `heartbeat`, `ingest`,',
      '  and `daily-digest` routines populate it as they run)',
      '',
      '## Directory guide',
      '- `wiki/agents/` — one page per agent',
      '',
    ].join('\n')
    const out = upsertIndexEntry(template, {
      path: 'projects/x/overview.md',
      title: 'overview',
      type: 'ingest',
      updated: '2026-09-09T00:00:00.000Z',
    })
    expect(out).not.toContain('none yet')
    expect(out).not.toContain('daily-digest` routines populate')
    expect(out).toContain('- `wiki/agents/` — one page per agent')
    expect(out).toContain('[overview](projects/x/overview.md)')
  })
})
