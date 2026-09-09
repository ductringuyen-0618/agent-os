import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client.js'
import { logs } from './logs.js'

describe('logs', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prints each event', async () => {
    const client = {
      getRunEvents: vi.fn().mockResolvedValue([
        {
          id: 1,
          ts: '2026-09-08T00:00:00.000Z',
          type: 'run.started',
          runId: 'r1',
          payload: {},
        },
      ]),
    } as unknown as ApiClient
    await logs(client, 'r1')
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('run.started'))
    expect(client.getRunEvents).toHaveBeenCalledWith('r1')
  })
})
