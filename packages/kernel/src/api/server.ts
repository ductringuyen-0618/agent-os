import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  CreateRunRequest,
  CreateRunResponse,
  DecisionStatus,
  ErrorResponse,
  HealthResponse,
  KillRunResponse,
} from '@agentos/shared'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kernel } from '../kernel.js'
import { registerInternalRoutes } from './internal.js'

const VERSION = '0.1.0'

const dashboardDist = path.resolve(
  fileURLToPath(import.meta.url),
  '../../../../dashboard/dist',
)

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

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

  app.get('/api/decisions', async (req) => {
    const { status } = req.query as { status?: DecisionStatus }
    return kernel.log.listDecisions(status ? { status } : undefined)
  })

  async function resolveRoute(
    id: string,
    target: 'approved' | 'rejected',
  ): Promise<{ code: number; body: unknown }> {
    const decision = kernel.log.getDecision(id)
    if (!decision) return { code: 404, body: { error: 'decision not found' } }
    if (decision.status !== 'pending') {
      return {
        code: 409,
        body: { error: `decision already ${decision.status}` },
      }
    }
    if (decision.adapter) {
      await kernel.adapters.applyDecision({ ...decision, status: target })
    } else {
      kernel.log.resolveDecision(id, target)
    }
    return { code: 200, body: kernel.log.getDecision(id) }
  }

  app.post('/api/decisions/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { code, body } = await resolveRoute(id, 'approved')
    return reply.code(code).send(body)
  })

  app.post('/api/decisions/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { code, body } = await resolveRoute(id, 'rejected')
    return reply.code(code).send(body)
  })

  app.post<{ Params: { name: string } }>(
    '/api/projects/:name/sync',
    async (req, reply) => {
      const { name } = req.params as { name: string }
      try {
        return await kernel.adapters.sync(name)
      } catch (err) {
        return reply
          .code(500)
          .send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  app.get('/api/skills', async () => {
    const skillsDir = path.join(cfg.osRoot, 'skills')
    const names = await listSubdirs(skillsDir)
    return Promise.all(
      names.map(async (name) => ({
        name,
        path: `skills/${name}`,
        hasLearnings: await fileExists(
          path.join(skillsDir, name, 'learnings.md'),
        ),
      })),
    )
  })

  app.get('/api/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    const dir = path.join(cfg.osRoot, 'skills', name)
    if (!(await fileExists(dir)))
      return reply
        .code(404)
        .send({ error: 'skill not found' } satisfies ErrorResponse)
    const readOptional = async (file: string) => {
      try {
        return await fsp.readFile(path.join(dir, file), 'utf8')
      } catch {
        return ''
      }
    }
    const [skillMd, learningsMd, evalRaw, lastOutputMd] = await Promise.all([
      readOptional('skill.md'),
      readOptional('learnings.md'),
      readOptional('eval.json'),
      readOptional('last-output.md'),
    ])
    return {
      skillMd,
      learningsMd,
      eval: evalRaw ? JSON.parse(evalRaw) : { criteria: [] },
      lastOutputMd,
    }
  })

  app.get('/api/agents', async () => {
    const agentsDir = path.join(cfg.osRoot, 'agents')
    const names = await listSubdirs(agentsDir)
    const runs = log.listRuns()
    return names.map((name) => {
      const active = runs.find(
        (r) =>
          r.agent === name &&
          (r.status === 'running' ||
            r.status === 'wrapping_up' ||
            r.status === 'blocked'),
      )
      if (!active) return { name, status: 'idle' as const }
      return {
        name,
        status: (active.status === 'blocked' ? 'blocked' : 'working') as
          | 'blocked'
          | 'working',
        currentRun: active.id,
      }
    })
  })

  app.get('/api/costs', async (req) => {
    const { days } = req.query as { days?: string }
    const windowMs = (days ? Number(days) : 14) * 24 * 60 * 60 * 1000
    const since = new Date(Date.now() - windowMs).toISOString()
    return log
      .listRuns()
      .filter(
        (r) =>
          r.startedAt !== undefined &&
          r.startedAt >= since &&
          r.costUsd !== undefined,
      )
      .map((r) => ({
        // biome-ignore lint/style/noNonNullAssertion: filtered above
        day: r.startedAt!.slice(0, 10),
        agent: r.agent ?? r.routine,
        costUsd: r.costUsd ?? 0,
      }))
  })

  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = log.subscribe((event) => {
      socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
  })

  app.register(fastifyStatic, {
    root: dashboardDist,
    prefix: '/',
    wildcard: false,
  })

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/ws')) {
      reply.code(404).send({ error: 'not found' } satisfies ErrorResponse)
      return
    }
    reply.sendFile('index.html', dashboardDist)
  })

  return app
}
