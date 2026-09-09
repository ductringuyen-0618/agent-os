import type {
  CreateRunRequest,
  CreateRunResponse,
  ErrorResponse,
  HealthResponse,
  KillRunResponse,
} from '@agentos/shared'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kernel } from '../kernel.js'
import { registerInternalRoutes } from './internal.js'

const VERSION = '0.1.0'

export function buildServer(kernel: Kernel): FastifyInstance {
  const { cfg, log, pm, wiki, scheduler } = kernel
  const app = Fastify({ logger: { level: cfg.logLevel } })
  app.register(fastifyWebsocket)

  app.addHook('onRequest', async (req, reply) => {
    if (!cfg.authToken) return
    if (req.url === '/api/health') return
    // /internal/syscall authenticates with its own X-Run-Token (per-run,
    // handed only to the sandboxed agent subprocess) rather than the
    // daemon's admin bearer token — by design, since distributing the
    // admin secret into every run's syscall MCP config would defeat the
    // point of per-run tokens. Without this exemption, the bearer check
    // below 401s every syscall in any deployment with authToken set,
    // before internal.ts's own token check ever runs.
    if (req.url === '/internal/syscall') return
    const header = req.headers.authorization
    if (header !== `Bearer ${cfg.authToken}`) {
      reply.code(401).send({ error: 'unauthorized' } satisfies ErrorResponse)
    }
  })

  app.get(
    '/api/health',
    async (): Promise<HealthResponse> => ({ ok: true, version: VERSION }),
  )

  registerInternalRoutes(app, { log, wiki, scheduler, osRoot: cfg.osRoot })

  app.get('/api/runs', async (req) => {
    const q = req.query as { status?: string; routine?: string; limit?: string }
    return log.listRuns({
      // biome-ignore lint/suspicious/noExplicitAny: validated by SQL WHERE, not user-trusted parsing
      status: q.status as any,
      routine: q.routine,
      limit: q.limit ? Number(q.limit) : undefined,
    })
  })

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const run = log.getRun(id)
    if (!run)
      return reply
        .code(404)
        .send({ error: 'run not found' } satisfies ErrorResponse)
    return run
  })

  app.get('/api/runs/:id/events', async (req) => {
    const { id } = req.params as { id: string }
    const q = req.query as { sinceId?: string }
    return log.listEvents({
      runId: id,
      sinceId: q.sinceId ? Number(q.sinceId) : undefined,
    })
  })

  app.post('/api/runs', async (req, reply) => {
    const body = req.body as CreateRunRequest
    if (!body?.skill)
      return reply
        .code(400)
        .send({ error: 'skill is required' } satisfies ErrorResponse)

    const runId = await scheduler.runSkill(body.skill, body.payload, body.agent)
    return reply.code(202).send({ runId } satisfies CreateRunResponse)
  })

  app.post('/api/runs/:id/kill', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: pm.kill(id) } satisfies KillRunResponse
  })

  app.get('/api/routines', async () => scheduler.list())

  app.post<{
    Params: { name: string }
    Body: { payload?: Record<string, unknown> }
  }>('/api/routines/:name/run', async (req, reply) => {
    try {
      const runId = await scheduler.runNow(req.params.name, req.body?.payload)
      return { runId }
    } catch (err) {
      reply.code(404)
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  app.post<{ Params: { name: string } }>(
    '/api/routines/:name/enable',
    async (req, reply) => {
      try {
        scheduler.setEnabled(req.params.name, true)
        return { ok: true }
      } catch (err) {
        reply.code(404)
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  app.post<{ Params: { name: string } }>(
    '/api/routines/:name/disable',
    async (req, reply) => {
      try {
        scheduler.setEnabled(req.params.name, false)
        return { ok: true }
      } catch (err) {
        reply.code(404)
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = log.subscribe((event) => {
      socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
  })

  return app
}
