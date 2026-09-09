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

  it('fetches skill detail (contract addition)', async () => {
    const client = new ApiClient()
    const detail = await client.getSkill('heartbeat')
    expect(detail.skillMd).toContain('# skill')
  })
})
