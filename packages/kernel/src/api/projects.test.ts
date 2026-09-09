import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { GhUnavailableError, InvalidRepoNameError } from '../github/gh.js'
import {
  ProjectNameCollisionError,
  ProjectNotFoundError,
} from '../projects/projectService.js'
import { registerProjectCrudRoutes } from './projects.js'

function makeApp(
  overrides: Partial<
    Record<'listProjects' | 'addProject' | 'removeProject', unknown>
  > = {},
) {
  const app = Fastify()
  const projects = {
    listProjects: vi.fn(async () => []),
    addProject: vi.fn(async () => ({
      project: { name: 'widgets' },
      sync: { added: [], changed: [], events: [] },
    })),
    removeProject: vi.fn(async () => {}),
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural ProjectService stub
  } as any
  registerProjectCrudRoutes(app, { projects })
  return { app, projects }
}

describe('GET /api/projects', () => {
  it('returns the project list', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /api/projects', () => {
  it('adds a project and returns 201', async () => {
    const { app } = makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { repo: 'octo/widgets' },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).project.name).toBe('widgets')
  })

  it('maps InvalidRepoNameError to 400', async () => {
    const { app } = makeApp({
      addProject: vi.fn(async () => {
        throw new InvalidRepoNameError('bad')
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { repo: 'bad' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('maps ProjectNameCollisionError to 409', async () => {
    const { app } = makeApp({
      addProject: vi.fn(async () => {
        throw new ProjectNameCollisionError('widgets')
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { repo: 'octo/widgets' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('maps GhUnavailableError to 503 with a hint', async () => {
    const { app } = makeApp({
      addProject: vi.fn(async () => {
        throw new GhUnavailableError('install gh')
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { repo: 'octo/widgets' },
    })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).hint).toBe('install gh')
  })
})

describe('DELETE /api/projects/:name', () => {
  it('removes a project and returns 200', async () => {
    const { app, projects } = makeApp()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/projects/widgets',
    })
    expect(res.statusCode).toBe(200)
    expect(projects.removeProject).toHaveBeenCalledWith('widgets')
  })

  it('maps ProjectNotFoundError to 404', async () => {
    const { app } = makeApp({
      removeProject: vi.fn(async () => {
        throw new ProjectNotFoundError('widgets')
      }),
    })
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/projects/widgets',
    })
    expect(res.statusCode).toBe(404)
  })
})
