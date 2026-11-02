import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { EventLog } from './eventLog.js'

describe('EventLog contextWindow column', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('round-trips contextWindow and inputTokens through createRun/getRun/updateRun', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-ctxwindow-'))
    const log = new EventLog(path.join(tmpDir, 'agentos.db'))
    const run = log.createRun({ routine: 'r', contextWindow: 200_000 })
    expect(log.getRun(run.id)?.contextWindow).toBe(200_000)
    const updated = log.updateRun(run.id, { inputTokens: 170_000 })
    expect(updated.contextWindow).toBe(200_000)
    expect(updated.inputTokens).toBe(170_000)
    log.close()
  })

  it('opens a database created before this column existed, adding it additively', () => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'agentos-ctxwindow-migrate-'),
    )
    const dbPath = path.join(tmpDir, 'agentos.db')
    const raw = new Database(dbPath)
    raw.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, routine TEXT NOT NULL, skill TEXT, adapter TEXT, agent TEXT,
      status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, payload TEXT, session_id TEXT, pid INTEGER,
      started_at TEXT, ended_at TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
    raw.close()

    const log = new EventLog(dbPath)
    const run = log.createRun({ routine: 'legacy' })
    expect(run.contextWindow).toBeUndefined()
    const updated = log.updateRun(run.id, { contextWindow: 1_000_000 })
    expect(updated.contextWindow).toBe(1_000_000)
    log.close()
  })
})
