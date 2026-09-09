import type { AddProjectRequest } from '@agentos/shared'
import type { FastifyInstance } from 'fastify'
import { GhUnavailableError, InvalidRepoNameError } from '../github/gh.js'
import {
  ProjectNameCollisionError,
  ProjectNotFoundError,
  type ProjectService,
} from '../projects/projectService.js'

export function registerProjectCrudRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService },
): void {
  app.get('/api/projects', async () => deps.projects.listProjects())

  app.post('/api/projects', async (req, reply) => {
    const body = req.body as AddProjectRequest
    if (!body?.repo) return reply.code(400).send({ error: 'repo is required' })
    try {
      const result = await deps.projects.addProject({
        repo: body.repo,
        name: body.name,
        adapter: body.adapter,
        baseBranch: body.base_branch,
        build: body.build,
      })
      return reply.code(201).send(result)
    } catch (err) {
      if (err instanceof InvalidRepoNameError) {
        return reply.code(400).send({ error: err.message })
      }
      if (err instanceof ProjectNameCollisionError) {
        return reply.code(409).send({ error: err.message })
      }
      if (err instanceof GhUnavailableError) {
        return reply
          .code(503)
          .send({ error: 'gh not available', hint: err.hint })
      }
      throw err
    }
  })

  app.delete<{ Params: { name: string } }>(
    '/api/projects/:name',
    async (req, reply) => {
      try {
        await deps.projects.removeProject(req.params.name)
        return { ok: true }
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message })
        }
        throw err
      }
    },
  )
}
