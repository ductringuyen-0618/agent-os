import type { FastifyInstance } from 'fastify'
import type { EventLog } from '../log/eventLog.js'
import type { Scheduler } from '../scheduler/scheduler.js'
import { type SyscallContext, handleSyscall } from '../syscall/handler.js'
import type { WikiService } from '../wiki/wikiService.js'

export interface InternalRouteDeps {
  log: EventLog
  wiki: WikiService
  scheduler: Scheduler
  osRoot: string
  workflows?: SyscallContext['workflows']
  loadProjects?: SyscallContext['loadProjects']
}

export function registerInternalRoutes(
  app: FastifyInstance,
  deps: InternalRouteDeps,
): void {
  app.post('/internal/syscall', async (req, reply) => {
    const token = req.headers['x-run-token']
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(401).send({ error: 'missing X-Run-Token' })
    }
    const run = deps.log.getRunByToken(token)
    if (!run) {
      return reply.code(401).send({ error: 'invalid run token' })
    }
    const body = req.body as { tool?: string; args?: unknown } | undefined
    if (!body?.tool) {
      return reply.code(400).send({ error: 'missing "tool"' })
    }
    const ctx: SyscallContext = {
      runId: run.id,
      agent: run.agent ?? 'unknown',
      osRoot: deps.osRoot,
      log: deps.log,
      wiki: deps.wiki,
      scheduler: deps.scheduler,
      workflows: deps.workflows,
      loadProjects: deps.loadProjects,
    }
    try {
      const result = await handleSyscall(body.tool, body.args, ctx)
      return reply.send(result)
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}
