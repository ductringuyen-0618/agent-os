import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from './eventLog.js'

let dbPath: string
let log: EventLog

beforeEach(async () => {
  dbPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-dr-')),
    'test.db',
  )
  log = new EventLog(dbPath)
})
afterEach(() => log.close())

describe('EventLog.resolveDecision', () => {
  it('appends a decision.resolved event carrying the ref and project', () => {
    const decision = log.createDecision({
      title: 't',
      body: 'b',
      adapter: 'techpulse-coo',
      project: 'techpulse',
      ref: 'proposals/001-slug.md',
    })
    log.resolveDecision(decision.id, 'approved')

    const events = log.listEvents({ types: ['decision.resolved'], limit: 10 })
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({
      decisionId: decision.id,
      status: 'approved',
      ref: 'proposals/001-slug.md',
      project: 'techpulse',
    })
  })

  it('accepts an expiry like any other verdict', () => {
    const decision = log.createDecision({
      title: 't',
      body: 'b',
      project: 'techpulse',
      ref: 'proposals/002-slug.md',
    })
    expect(log.resolveDecision(decision.id, 'expired').status).toBe('expired')
    expect(log.listDecisions({ status: 'expired' })).toHaveLength(1)
    const events = log.listEvents({ types: ['decision.resolved'], limit: 10 })
    expect(events[0].payload).toMatchObject({ status: 'expired' })
  })

  it('still appends the event on an error resolution', () => {
    const decision = log.createDecision({ title: 't', body: 'b' })
    log.resolveDecision(decision.id, 'error', 'push failed')
    const events = log.listEvents({ types: ['decision.resolved'], limit: 10 })
    expect(events[0].payload).toMatchObject({
      decisionId: decision.id,
      status: 'error',
    })
  })
})
