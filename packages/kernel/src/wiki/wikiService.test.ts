import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from '../log/eventLog.js'
import { SecretDetectedError } from './redact.js'
import { WikiService } from './wikiService.js'

let osRoot: string
let log: EventLog
let wiki: WikiService

beforeEach(async () => {
  osRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-wiki-'))
  await fs.mkdir(path.join(osRoot, 'wiki'), { recursive: true })
  await fs.mkdir(path.join(osRoot, 'raw', 'techpulse', 'proposals'), {
    recursive: true,
  })
  await fs.writeFile(
    path.join(osRoot, 'raw', 'techpulse', 'proposals', '001-slug.md'),
    '# proposal',
    'utf8',
  )
  log = new EventLog(path.join(osRoot, 'test.db'))
  wiki = new WikiService(osRoot, log)
})

afterEach(async () => {
  log.close()
  await fs.rm(osRoot, { recursive: true, force: true })
})

describe('WikiService.writePage', () => {
  it('creates a page with frontmatter, upserts index.md, appends log.md, emits wiki.written', async () => {
    const result = await wiki.writePage({
      path: 'projects/techpulse/proposals/001-slug.md',
      content: '# Proposal 001\n\nSummary.',
      links: ['raw/techpulse/proposals/001-slug.md'],
      op: 'ingest',
      runId: 'run-1',
    })
    expect(result.result).toBe('created')

    const page = await wiki.readPage('projects/techpulse/proposals/001-slug.md')
    expect(page).toContain('title: 001-slug')
    expect(page).toContain('type: ingest')
    expect(page).toContain('sources:')
    expect(page).toContain('# Proposal 001')

    const index = await wiki.readIndex()
    expect(index).toContain('](projects/techpulse/proposals/001-slug.md)')

    const logMd = await wiki.readLog()
    expect(logMd).toMatch(/## \[\d{4}-\d{2}-\d{2}\] ingest \| 001-slug/)

    const events = log.listEvents({ types: ['wiki.written'], limit: 10 })
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({
      path: 'projects/techpulse/proposals/001-slug.md',
      result: 'created',
    })
  })

  it('reports updated on a second write to the same page', async () => {
    await wiki.writePage({ path: 'projects/a.md', content: 'v1', op: 'note' })
    const second = await wiki.writePage({
      path: 'projects/a.md',
      content: 'v2',
      op: 'note',
    })
    expect(second.result).toBe('updated')
  })

  it('refuses to write under raw/', async () => {
    await expect(
      wiki.writePage({ path: 'raw/hack.md', content: 'x' }),
    ).rejects.toThrow(/raw\//)
  })

  it('refuses a path that traverses out of wiki/ into raw/', async () => {
    await expect(
      wiki.writePage({
        path: '../raw/techpulse/proposals/001-slug.md',
        content: 'PWNED',
      }),
    ).rejects.toThrow(/escapes the wiki directory/)
    const original = await fs.readFile(
      path.join(osRoot, 'raw', 'techpulse', 'proposals', '001-slug.md'),
      'utf8',
    )
    expect(original).toBe('# proposal')
  })

  it('refuses a path that traverses entirely outside osRoot', async () => {
    await expect(
      wiki.writePage({ path: '../../../../etc/escape.md', content: 'ESCAPED' }),
    ).rejects.toThrow(/escapes the wiki directory/)
  })

  it('refuses to read a path that traverses out of wiki/', async () => {
    await expect(
      wiki.readPage('../raw/techpulse/proposals/001-slug.md'),
    ).rejects.toThrow(/escapes the wiki directory/)
  })

  it('scans links for secrets, not just content', async () => {
    await expect(
      wiki.writePage({
        path: 'projects/leak2.md',
        content: 'clean content',
        links: ['AKIAABCDEFGHIJKLMNOP'],
      }),
    ).rejects.toThrow(SecretDetectedError)
    expect(log.listEvents({ types: ['security.redacted'] })).toHaveLength(1)
  })

  it('refuses secrets and emits security.redacted instead of wiki.written', async () => {
    await expect(
      wiki.writePage({
        path: 'projects/leak.md',
        content: 'AKIAABCDEFGHIJKLMNOP',
        runId: 'run-2',
      }),
    ).rejects.toThrow(SecretDetectedError)
    expect(log.listEvents({ types: ['security.redacted'] })).toHaveLength(1)
    expect(log.listEvents({ types: ['wiki.written'] })).toHaveLength(0)
  })
})

describe('WikiService.listUnindexedRaw', () => {
  it('lists raw/ files not yet referenced from any indexed page', async () => {
    const unindexed = await wiki.listUnindexedRaw()
    expect(unindexed).toContain('techpulse/proposals/001-slug.md')

    await wiki.writePage({
      path: 'projects/techpulse/proposals/001-slug.md',
      content: 'summary',
      links: ['raw/techpulse/proposals/001-slug.md'],
      op: 'ingest',
    })
    const after = await wiki.listUnindexedRaw()
    expect(after).not.toContain('techpulse/proposals/001-slug.md')
  })
})

describe('WikiService.appendLog', () => {
  it('appends a log line without requiring writePage', async () => {
    await wiki.appendLog('lint', 'Nightly lint pass')
    const logMd = await wiki.readLog()
    expect(logMd).toContain('lint | Nightly lint pass')
  })
})
