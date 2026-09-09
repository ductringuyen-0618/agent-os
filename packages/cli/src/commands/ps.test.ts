import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client.js'
import { ps } from './ps.js'

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listRuns: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ApiClient
}

describe('ps', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prints "no runs yet" when there are none', async () => {
    await ps(fakeClient({ listRuns: vi.fn().mockResolvedValue([]) }))
    expect(logSpy).toHaveBeenCalledWith('no runs yet')
  })

  it('prints one line per run', async () => {
    const client = fakeClient({
      listRuns: vi.fn().mockResolvedValue([
        {
          id: 'r1',
          routine: 'heartbeat',
          status: 'success',
          attempt: 1,
          agent: 'ops',
          skill: 'heartbeat',
        },
      ]),
    })
    await ps(client)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('r1'))
  })
})
