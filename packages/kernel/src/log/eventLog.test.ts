import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from './eventLog.js'

describe('EventLog', () => {
  let tmpDir: string
  let log: EventLog

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-eventlog-'))
    log = new EventLog(path.join(tmpDir, 'agentos.db'))
  })

  afterEach(() => {
    log.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates and retrieves a run', () => {
    const run = log.createRun({
      routine: 'heartbeat',
      skill: 'heartbeat',
      agent: 'ops',
    })
    expect(run.status).toBe('queued')
    expect(run.attempt).toBe(1)
    expect(log.getRun(run.id)).toEqual(run)
  })

  it('updates a run', () => {
    const run = log.createRun({ routine: 'heartbeat' })
    const updated = log.updateRun(run.id, { status: 'success', costUsd: 0.01 })
    expect(updated.status).toBe('success')
    expect(updated.costUsd).toBe(0.01)
  })

  it('lists runs filtered by status', () => {
    log.createRun({ routine: 'a' })
    const r2 = log.createRun({ routine: 'b' })
    log.updateRun(r2.id, { status: 'success' })
    const stillQueued = log.listRuns({ status: 'queued' })
    expect(stillQueued.map((r) => r.routine)).toEqual(['a'])
  })

  it('appends and lists events, notifying subscribers', () => {
    const seen: string[] = []
    const unsubscribe = log.subscribe((e) => seen.push(e.type))
    const run = log.createRun({ routine: 'heartbeat' })
    log.append({ type: 'run.started', runId: run.id, payload: { foo: 'bar' } })
    log.append({ type: 'run.finished', runId: run.id, payload: {} })
    unsubscribe()
    log.append({ type: 'run.failed', runId: run.id, payload: {} })

    const events = log.listEvents({ runId: run.id })
    expect(events.map((e) => e.type)).toEqual([
      'run.started',
      'run.finished',
      'run.failed',
    ])
    expect(seen).toEqual(['run.started', 'run.finished'])
  })

  it('creates and resolves decisions', () => {
    const decision = log.createDecision({
      title: 'Approve X',
      body: 'body text',
    })
    expect(decision.status).toBe('pending')
    const resolved = log.resolveDecision(decision.id, 'approved')
    expect(resolved.status).toBe('approved')
    expect(log.listDecisions({ status: 'approved' })).toHaveLength(1)
  })

  it('updates a decision title and body in place', () => {
    const decision = log.createDecision({ title: 'Old', body: 'old body' })
    const updated = log.updateDecision(decision.id, { body: 'new body' })
    expect(updated.title).toBe('Old')
    expect(updated.body).toBe('new body')
    expect(updated.status).toBe('pending')
    expect(() => log.updateDecision('nope', { body: 'x' })).toThrow(/not found/)
  })

  it('sends and reads inbox messages', () => {
    log.sendMessage({ from: 'ops', to: 'librarian', body: 'hello' })
    const inbox = log.readInbox('librarian')
    expect(inbox).toHaveLength(1)
    expect(inbox[0].body).toBe('hello')
  })
})
