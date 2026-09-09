import type {
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  DeliverWorkflowEventRequest,
  ErrorResponse,
  GetWorkflowResponse,
  WorkflowStatus,
} from '@agentos/shared'
import type { FastifyInstance } from 'fastify'
import type { EventLog } from '../log/eventLog.js'
import type { WorkflowEngine } from '../workflow/engine.js'

export interface WorkflowRouteDeps {
  engine: WorkflowEngine
  log: EventLog
}

export function registerWorkflowRoutes(
  app: FastifyInstance,
  deps: WorkflowRouteDeps,
): void {
  const { engine, log } = deps

  app.get('/api/workflows', async (req) => {
    const q = req.query as {
      status?: WorkflowStatus
      project?: string
      kind?: string
    }
    return engine.list({ status: q.status, project: q.project, kind: q.kind })
  })

  app.get('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const workflow = engine.get(id)
    if (!workflow)
      return reply
        .code(404)
        .send({ error: 'workflow not found' } satisfies ErrorResponse)
    return { workflow, steps: engine.steps(id) } satisfies GetWorkflowResponse
  })

  app.post('/api/workflows', async (req, reply) => {
    const body = req.body as CreateWorkflowRequest
    if (!body?.kind)
      return reply
        .code(400)
        .send({ error: 'kind is required' } satisfies ErrorResponse)
    try {
      const workflow = await engine.create(body.kind, body.input ?? {}, {
        project: body.project,
        title: body.title,
      })
      return reply
        .code(202)
        .send({ workflowId: workflow.id } satisfies CreateWorkflowResponse)
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      } satisfies ErrorResponse)
    }
  })

  app.post('/api/workflows/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply
        .code(404)
        .send({ error: 'workflow not found' } satisfies ErrorResponse)
    return engine.pause(id)
  })

  app.post('/api/workflows/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply
        .code(404)
        .send({ error: 'workflow not found' } satisfies ErrorResponse)
    try {
      return await engine.resume(id)
    } catch (err) {
      return reply
        .code(409)
        .send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/workflows/:id/terminate', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply
        .code(404)
        .send({ error: 'workflow not found' } satisfies ErrorResponse)
    return engine.terminate(id)
  })

  app.post('/api/workflows/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply
        .code(404)
        .send({ error: 'workflow not found' } satisfies ErrorResponse)
    const body = req.body as DeliverWorkflowEventRequest
    if (!body?.type)
      return reply
        .code(400)
        .send({ error: 'type is required' } satisfies ErrorResponse)
    const event = log.append({
      // biome-ignore lint/suspicious/noExplicitAny: an operator-delivered event's type is validated as non-empty above, not against the closed EventType union -- waitForEvent matches by exact string regardless
      type: body.type as any,
      payload: body.payload ?? {},
    })
    return reply.code(202).send({ id: event.id })
  })
}
