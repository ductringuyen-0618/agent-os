// packages/kernel/src/syscall/handler.ts
import type { EventType } from '@agentos/shared'
import type { EventLog } from '../log/eventLog.js'
import type { Scheduler } from '../scheduler/scheduler.js'
import { SecretDetectedError } from '../wiki/redact.js'
import type { WikiService } from '../wiki/wikiService.js'
import { SyscallToolDefs, type SyscallToolName } from './tools.js'

export interface SyscallContext {
  runId: string
  agent: string
  osRoot: string
  log: EventLog
  wiki: WikiService
  scheduler: Scheduler
}

export class SyscallError extends Error {
  code: string
  constructor(message: string, code = 'syscall_error') {
    super(message)
    this.name = 'SyscallError'
    this.code = code
  }
}

function parseWhen(when: string): Date {
  const rel = /^\+(\d+)(m|h|d)$/.exec(when.trim())
  if (rel) {
    const n = Number(rel[1])
    const unitMs =
      rel[2] === 'm' ? 60_000 : rel[2] === 'h' ? 3_600_000 : 86_400_000
    return new Date(Date.now() + n * unitMs)
  }
  const d = new Date(when)
  if (Number.isNaN(d.getTime()))
    throw new SyscallError(`invalid "when": ${when}`, 'invalid_when')
  return d
}

export async function handleSyscall(
  tool: string,
  args: unknown,
  ctx: SyscallContext,
): Promise<unknown> {
  const def = (
    SyscallToolDefs as Record<string, (typeof SyscallToolDefs)[SyscallToolName]>
  )[tool]
  if (!def) throw new SyscallError(`unknown tool: ${tool}`, 'unknown_tool')
  const input = def.inputSchema.parse(args ?? {})

  switch (tool as SyscallToolName) {
    case 'get_context': {
      const businessBrain = await ctx.wiki
        .readPage('business-brain.md')
        .catch(() => '')
      const index = await ctx.wiki.readIndex().catch(() => '')
      return { businessBrain, index }
    }
    case 'remember': {
      const i = input as {
        page: string
        content: string
        links?: string[]
        op?: 'ingest' | 'query' | 'lint' | 'decision' | 'note'
      }
      try {
        return await ctx.wiki.writePage({
          path: i.page,
          content: i.content,
          links: i.links,
          op: i.op,
          runId: ctx.runId,
        })
      } catch (err) {
        if (err instanceof SecretDetectedError)
          throw new SyscallError(err.message, 'secret_detected')
        throw err
      }
    }
    case 'read_wiki': {
      const i = input as { page: string }
      return { content: await ctx.wiki.readPage(i.page) }
    }
    case 'emit_event': {
      const i = input as { type: string; payload?: Record<string, unknown> }
      if (i.type !== 'raw.added' && !i.type.startsWith('custom.')) {
        throw new SyscallError(
          `emit_event: type must be "raw.added" or start with "custom." (got "${i.type}")`,
          'forbidden_event_type',
        )
      }
      const e = ctx.log.append({
        type: i.type as EventType,
        runId: ctx.runId,
        payload: i.payload ?? {},
      })
      return { id: e.id }
    }
    case 'send_message': {
      const i = input as { to: string; body: string }
      const m = ctx.log.sendMessage({ from: ctx.agent, to: i.to, body: i.body })
      return { id: m.id }
    }
    case 'read_inbox': {
      const messages = ctx.log.readInbox(ctx.agent, true)
      return { messages }
    }
    case 'schedule': {
      const i = input as {
        skill: string
        when: string
        payload?: Record<string, unknown>
      }
      const when = parseWhen(i.when)
      const scheduleId = ctx.scheduler.scheduleOnce(i.skill, when, i.payload)
      return { scheduleId }
    }
    case 'request_approval': {
      const i = input as {
        title: string
        body: string
        adapter?: string
        ref?: string
      }
      const d = ctx.log.createDecision({
        title: i.title,
        body: i.body,
        adapter: i.adapter,
        ref: i.ref,
        createdByRun: ctx.runId,
      })
      return { decisionId: d.id }
    }
    default:
      throw new SyscallError(`unhandled tool: ${tool}`, 'unknown_tool')
  }
}
