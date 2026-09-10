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

  // Re-runs setup for a pending project: activates the adapter if the setup
  // pull request is merged, opens the PR if none exists yet. Idempotent.
  app.post<{ Params: { name: string } }>(
    '/api/projects/:name/setup',
    async (req, reply) => {
      try {
        const setup = await deps.projects.runSetup(req.params.name)
        const item = (await deps.projects.listProjects()).find(
          (p) => p.config.name === req.params.name,
        )
        return { setup, project: item }
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message })
        }
        if (err instanceof GhUnavailableError) {
          return reply
            .code(503)
            .send({ error: 'gh not available', hint: err.hint })
        }
        throw err
      }
    },
  )

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
