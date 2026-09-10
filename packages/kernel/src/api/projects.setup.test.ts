import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { ProjectNotFoundError } from '../projects/projectService.js'
import { registerProjectCrudRoutes } from './projects.js'

function makeApp(runSetup: unknown, listProjects?: unknown) {
  const app = Fastify()
  const projects = {
    listProjects:
      listProjects ?? vi.fn(async () => [{ config: { name: 'widgets' } }]),
    addProject: vi.fn(),
    removeProject: vi.fn(),
    runSetup,
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural ProjectService stub
  } as any
  registerProjectCrudRoutes(app, { projects })
  return { app, projects }
}

describe('POST /api/projects/:name/setup', () => {
  it('re-runs setup and returns the outcome with the project row', async () => {
    const runSetup = vi.fn(async () => ({ status: 'pending', prNumber: 7 }))
    const { app } = makeApp(runSetup)
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/widgets/setup',
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      setup: { status: 'pending', prNumber: 7 },
      project: { config: { name: 'widgets' } },
    })
    expect(runSetup).toHaveBeenCalledWith('widgets')
  })

  it('maps ProjectNotFoundError to 404', async () => {
    const { app } = makeApp(
      vi.fn(async () => {
        throw new ProjectNotFoundError('nope')
      }),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/nope/setup',
    })
    expect(res.statusCode).toBe(404)
  })
})
