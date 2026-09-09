import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from './eventLog.js'

let dbPath: string
let log: EventLog

beforeEach(async () => {
  dbPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-tok-')),
    'test.db',
  )
  log = new EventLog(dbPath)
})
afterEach(() => log.close())

describe('EventLog run tokens', () => {
  it('creates a token and looks up the owning run', () => {
    const run = log.createRun({
      routine: 'ingest',
      skill: 'ingest',
      agent: 'librarian',
    })
    log.createRunToken(run.id, 'tok-abc')
    const found = log.getRunByToken('tok-abc')
    expect(found?.id).toBe(run.id)
  })
  it('returns undefined for an unknown token', () => {
    expect(log.getRunByToken('nope')).toBeUndefined()
  })
})
