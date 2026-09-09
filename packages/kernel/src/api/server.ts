import fs from 'node:fs/promises'
import path from 'node:path'
import {
  type CreateRunRequest,
  type CreateRunResponse,
  type ErrorResponse,
  type HealthResponse,
  type KillRunResponse,
  type RoutineConfig,
  type RoutinesFile,
  parseRoutinesFile,
} from '@agentos/shared'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kernel } from '../kernel.js'
import { assemblePrompt } from '../process/promptAssembler.js'
import { registerInternalRoutes } from './internal.js'

const VERSION = '0.1.0'

const DEFAULT_ROUTINES: RoutinesFile = {
  defaults: {
    model: 'sonnet',
    permission_mode: 'plan',
    allowed_tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    max_attempts: 2,
    timeout_ms: 300_000,
  },
  routines: [],
}

async function loadRoutines(osRoot: string): Promise<RoutinesFile> {
  try {
    const text = await fs.readFile(path.join(osRoot, 'routines.yaml'), 'utf8')
    return parseRoutinesFile(text)
  } catch {
    return DEFAULT_ROUTINES
  }
}

/**
 * M1 stand-in for M2's process/mcpConfig.ts#writeRunMcpConfig: writes an
 * mcp.json with no servers (there is no SyscallServer yet) so
 * ProcessManager still has a real --mcp-config path to pass to claude -p,
 * at the runtime layout contract §2 specifies (runs/<runId>/mcp.json).
 */
async function writeStubMcpConfig(
  runtimeDir: string,
  runId: string,
): Promise<string> {
  const dir = path.join(runtimeDir, 'runs', runId)
  await fs.mkdir(dir, { recursive: true })
  const mcpPath = path.join(dir, 'mcp.json')
  await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: {} }, null, 2))
  return mcpPath
}

function findRoutineForSkill(
  routines: RoutinesFile,
  skill: string,
): RoutineConfig | undefined {
  return routines.routines.find((r) => r.skill === skill)
}

export function buildServer(kernel: Kernel): FastifyInstance {
  const { cfg, log, pm, wiki, scheduler } = kernel
  const app = Fastify({ logger: { level: cfg.logLevel } })
  app.register(fastifyWebsocket)

  app.addHook('onRequest', async (req, reply) => {
    if (!cfg.authToken) return
    if (req.url === '/api/health') return
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

    const routines = await loadRoutines(cfg.osRoot)
    const routine = findRoutineForSkill(routines, body.skill)
    const agent = body.agent ?? routine?.agent ?? 'ops'

    const run = log.createRun({
      routine: routine?.name ?? body.skill,
      skill: body.skill,
      agent,
      payload: body.payload,
    })

    const mcpConfigPath = await writeStubMcpConfig(cfg.runtimeDir, run.id)
    const { prompt, systemPromptAppend } = await assemblePrompt({
      osRoot: cfg.osRoot,
      skill: body.skill,
      agent,
      task: body.payload ? JSON.stringify(body.payload) : undefined,
    })
    const workspace = path.join(cfg.osRoot, 'agents', agent, 'workspace')
    await fs.mkdir(workspace, { recursive: true })

    pm.start(run, {
      prompt,
      systemPromptAppend,
      cwd: workspace,
      model: routine?.model ?? routines.defaults.model,
      permissionMode:
        routine?.permission_mode ?? routines.defaults.permission_mode,
      allowedTools: routine?.allowed_tools ?? routines.defaults.allowed_tools,
      addDirs: [cfg.osRoot],
      mcpConfigPath,
      timeoutMs: routine?.timeout_ms ?? routines.defaults.timeout_ms,
    }).catch((err: unknown) => {
      // pm.start() only rejects on a bug (e.g. a synchronous throw before
      // its first await) since normal subprocess failure resolves with
      // status 'failed'/'killed'. Without this catch, that rejection would
      // be unhandled and crash the whole daemon process for one bad run.
      app.log.error({ err, runId: run.id }, 'pm.start() rejected')
      log.updateRun(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
    })

    return reply.code(202).send({ runId: run.id } satisfies CreateRunResponse)
  })

  app.post('/api/runs/:id/kill', async (req) => {
    const { id } = req.params as { id: string }
    return { ok: pm.kill(id) } satisfies KillRunResponse
  })

  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = log.subscribe((event) => {
      socket.send(JSON.stringify(event))
    })
    socket.on('close', unsubscribe)
  })

  return app
}
