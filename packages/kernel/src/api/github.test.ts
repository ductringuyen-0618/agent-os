import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerGithubRoutes } from './github.js'

const fakeGhBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tools/fake-gh/bin.js',
)
const reposFixture = path.resolve(
  path.dirname(fakeGhBin),
  'fixtures/repos.json',
)

beforeEach(() => {
  process.env.AGENTOS_GH_BIN = fakeGhBin
  // biome-ignore lint/performance/noDelete: assigning undefined would coerce to the string 'undefined'
  delete process.env.FAKE_GH_MODE
  process.env.FAKE_GH_REPOS_FIXTURE = reposFixture
})

describe('GET /api/github/repos', () => {
  it('returns the repo list', async () => {
    const app = Fastify()
    registerGithubRoutes(app)
    const res = await app.inject({ method: 'GET', url: '/api/github/repos' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(2)
  })

  it('returns 503 with a hint when gh is unavailable', async () => {
    process.env.FAKE_GH_MODE = 'unavailable'
    const app = Fastify()
    registerGithubRoutes(app)
    const res = await app.inject({ method: 'GET', url: '/api/github/repos' })
    expect(res.statusCode).toBe(503)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('gh not available')
    expect(body.hint).toBeTruthy()
  })
})
