import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client.js'
import { run } from './run.js'

describe('run', () => {
  it('creates a run and returns the runId', async () => {
    const client = {
      createRun: vi.fn().mockResolvedValue({ runId: 'run-123' }),
    } as unknown as ApiClient
    const runId = await run(client, { skill: 'heartbeat', agent: 'ops' })
    expect(runId).toBe('run-123')
    expect(client.createRun).toHaveBeenCalledWith({
      skill: 'heartbeat',
      agent: 'ops',
      payload: undefined,
    })
  })

  it('parses a JSON payload string', async () => {
    const client = {
      createRun: vi.fn().mockResolvedValue({ runId: 'run-456' }),
    } as unknown as ApiClient
    await run(client, { skill: 'heartbeat', payload: '{"force":true}' })
    expect(client.createRun).toHaveBeenCalledWith({
      skill: 'heartbeat',
      agent: undefined,
      payload: { force: true },
    })
  })
})
