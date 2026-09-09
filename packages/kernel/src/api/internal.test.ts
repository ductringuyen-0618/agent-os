import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from '../log/eventLog.js'
import { WikiService } from '../wiki/wikiService.js'
import { registerInternalRoutes } from './internal.js'

let osRoot: string
let log: EventLog
let wiki: WikiService
let app: ReturnType<typeof Fastify>
let runId: string
// biome-ignore lint/suspicious/noExplicitAny: minimal fake satisfying the Scheduler interface
const scheduler = { scheduleOnce: () => 'sched-1' } as any

beforeEach(async () => {
  osRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-internal-'))
  await fs.mkdir(path.join(osRoot, 'wiki'), { recursive: true })
  log = new EventLog(path.join(osRoot, 'test.db'))
  wiki = new WikiService(osRoot, log)
  const run = log.createRun({
    routine: 'ingest',
    skill: 'ingest',
    agent: 'librarian',
  })
  runId = run.id
  log.createRunToken(runId, 'tok-good')
  app = Fastify()
  registerInternalRoutes(app, { log, wiki, scheduler, osRoot })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  log.close()
  await fs.rm(osRoot, { recursive: true, force: true })
})

describe('POST /internal/syscall', () => {
  it('401s with no token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/syscall',
      payload: { tool: 'get_context', args: {} },
    })
    expect(res.statusCode).toBe(401)
  })
  it('401s with an invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/syscall',
      headers: { 'x-run-token': 'wrong' },
      payload: { tool: 'get_context', args: {} },
    })
    expect(res.statusCode).toBe(401)
  })
  it('executes a syscall for a valid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/syscall',
      headers: { 'x-run-token': 'tok-good' },
      payload: { tool: 'remember', args: { page: 'a.md', content: 'hi' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ result: 'created', path: 'a.md' })
  })
  it('returns 400 with an error body when the syscall throws', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/syscall',
      headers: { 'x-run-token': 'tok-good' },
      payload: { tool: 'nope', args: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/unknown tool/)
  })
})
