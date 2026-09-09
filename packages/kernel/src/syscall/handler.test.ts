// packages/kernel/src/syscall/handler.test.ts
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from '../log/eventLog.js'
import { WikiService } from '../wiki/wikiService.js'
import { type SyscallContext, SyscallError, handleSyscall } from './handler.js'

let osRoot: string
let log: EventLog
let wiki: WikiService
let ctx: SyscallContext
const scheduled: Array<{
  skill: string
  when: Date
  payload?: Record<string, unknown>
}> = []

beforeEach(async () => {
  osRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-handler-'))
  await fs.mkdir(path.join(osRoot, 'wiki'), { recursive: true })
  await fs.writeFile(
    path.join(osRoot, 'wiki', 'business-brain.md'),
    '# Business Brain',
    'utf8',
  )
  log = new EventLog(path.join(osRoot, 'test.db'))
  wiki = new WikiService(osRoot, log)
  scheduled.length = 0
  ctx = {
    runId: 'run-1',
    agent: 'librarian',
    osRoot,
    log,
    wiki,
    scheduler: {
      scheduleOnce: (
        skill: string,
        when: Date,
        payload?: Record<string, unknown>,
      ) => {
        scheduled.push({ skill, when, payload })
        return 'sched-1'
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake satisfying the Scheduler interface
    } as any,
  }
})

afterEach(async () => {
  log.close()
  await fs.rm(osRoot, { recursive: true, force: true })
})

describe('handleSyscall', () => {
  it('get_context returns businessBrain and index', async () => {
    const res = (await handleSyscall('get_context', {}, ctx)) as {
      businessBrain: string
      index: string
    }
    expect(res.businessBrain).toContain('Business Brain')
  })

  it('remember writes a page and returns created', async () => {
    const res = (await handleSyscall(
      'remember',
      { page: 'a.md', content: 'hello', op: 'note' },
      ctx,
    )) as { result: string; path: string }
    expect(res.result).toBe('created')
    await expect(wiki.readPage('a.md')).resolves.toContain('hello')
  })

  it('remember surfaces secret detection as a SyscallError', async () => {
    await expect(
      handleSyscall(
        'remember',
        { page: 'a.md', content: 'AKIAABCDEFGHIJKLMNOP' },
        ctx,
      ),
    ).rejects.toThrow(SyscallError)
  })

  it('read_wiki reads a page written earlier', async () => {
    await handleSyscall('remember', { page: 'b.md', content: 'body text' }, ctx)
    const res = (await handleSyscall('read_wiki', { page: 'b.md' }, ctx)) as {
      content: string
    }
    expect(res.content).toContain('body text')
  })

  it('emit_event allows custom.* and raw.added, rejects other types', async () => {
    const ok1 = (await handleSyscall(
      'emit_event',
      { type: 'custom.foo', payload: { x: 1 } },
      ctx,
    )) as { id: number }
    expect(typeof ok1.id).toBe('number')
    const ok2 = await handleSyscall(
      'emit_event',
      { type: 'raw.added', payload: {} },
      ctx,
    )
    expect(ok2).toMatchObject({ id: expect.any(Number) })
    await expect(
      handleSyscall('emit_event', { type: 'run.failed' }, ctx),
    ).rejects.toThrow(SyscallError)
  })

  it('send_message then read_inbox round-trips', async () => {
    await handleSyscall(
      'send_message',
      { to: 'ops', body: 'hi' },
      { ...ctx, agent: 'librarian' },
    )
    const res = (await handleSyscall(
      'read_inbox',
      {},
      { ...ctx, agent: 'ops' },
    )) as { messages: Array<{ body: string }> }
    expect(res.messages.map((m) => m.body)).toContain('hi')
  })

  it('schedule accepts an ISO datetime', async () => {
    const res = (await handleSyscall(
      'schedule',
      { skill: 'lint', when: '2030-01-01T00:00:00.000Z' },
      ctx,
    )) as { scheduleId: string }
    expect(res.scheduleId).toBe('sched-1')
    expect(scheduled[0].when.toISOString()).toBe('2030-01-01T00:00:00.000Z')
  })

  it('schedule accepts a relative "+30m" / "+2h" offset', async () => {
    const before = Date.now()
    await handleSyscall('schedule', { skill: 'lint', when: '+30m' }, ctx)
    const deltaMinutes = (scheduled[0].when.getTime() - before) / 60_000
    expect(deltaMinutes).toBeGreaterThan(29)
    expect(deltaMinutes).toBeLessThan(31)

    await handleSyscall('schedule', { skill: 'lint', when: '+2h' }, ctx)
    const deltaHours = (scheduled[1].when.getTime() - before) / 3_600_000
    expect(deltaHours).toBeGreaterThan(1.9)
    expect(deltaHours).toBeLessThan(2.1)
  })

  it('request_approval creates a pending Decision and never resolves it', async () => {
    const res = (await handleSyscall(
      'request_approval',
      { title: 'Approve X', body: 'because Y', ref: '001-slug.md' },
      ctx,
    )) as {
      decisionId: string
    }
    const decisions = log.listDecisions({ status: 'pending' })
    expect(decisions.map((d) => d.id)).toContain(res.decisionId)
  })

  it('rejects an unknown tool', async () => {
    await expect(handleSyscall('nope', {}, ctx)).rejects.toThrow(SyscallError)
  })
})
