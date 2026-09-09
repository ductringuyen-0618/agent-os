import { beforeEach, describe, expect, it } from 'vitest'
import { fixtures, installMockFetch } from '../../tests/mockServer'
import { ApiClient } from './client'

describe('ApiClient', () => {
  beforeEach(() => installMockFetch())

  it('lists runs', async () => {
    const client = new ApiClient()
    const runs = await client.listRuns()
    expect(runs).toEqual([fixtures.run])
  })

  it('approves a decision', async () => {
    const client = new ApiClient()
    const decision = await client.approveDecision('dec_1')
    expect(decision.status).toBe('approved')
  })

  it('omits the JSON content-type on body-less POSTs (Fastify 400s otherwise)', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response('{"id":"dec_1","status":"approved"}', {
        status: 200,
      })
    }) as unknown as typeof fetch
    const client = new ApiClient()
    await client.approveDecision('dec_1')
    await client.runRoutine('heartbeat', { reason: 'test' })
    const approve = calls[0].init?.headers as Record<string, string>
    const create = calls[1].init?.headers as Record<string, string>
    expect(Object.keys(approve).map((k) => k.toLowerCase())).not.toContain(
      'content-type',
    )
    expect(create['content-type']).toBe('application/json')
  })

  it('fetches skill detail (contract addition)', async () => {
    const client = new ApiClient()
    const detail = await client.getSkill('heartbeat')
    expect(detail.skillMd).toContain('# skill')
  })
})

describe('ApiClient — projects', () => {
  beforeEach(() => installMockFetch())

  it('lists github repos', async () => {
    const client = new ApiClient()
    const repos = await client.listGithubRepos()
    expect(repos).toEqual(fixtures.githubRepos)
  })

  it('lists projects', async () => {
    const client = new ApiClient()
    const list = await client.listProjects()
    expect(list).toEqual([fixtures.projectListItem])
  })

  it('adds a project', async () => {
    const client = new ApiClient()
    const result = await client.addProject({ repo: 'octo/widgets' })
    expect(result.project.name).toBe('widgets')
  })

  it('removes a project', async () => {
    const client = new ApiClient()
    const result = await client.removeProject('widgets')
    expect(result.ok).toBe(true)
  })

  it('syncs a project', async () => {
    installMockFetch({
      'POST /api/projects/techpulse/sync': () => ({
        added: [],
        changed: ['os/wiki/index.md'],
        events: [],
      }),
    })
    const client = new ApiClient()
    const result = await client.syncProject('techpulse')
    expect(result.changed).toEqual(['os/wiki/index.md'])
  })
})
