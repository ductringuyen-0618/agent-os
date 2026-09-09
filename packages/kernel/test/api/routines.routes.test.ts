import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../src/api/server.js'

describe('routines routes', () => {
  it('GET/POST /api/routines delegates to Scheduler', async () => {
    const scheduler = {
      list: vi
        .fn()
        .mockReturnValue([
          { routine: { name: 'lint' }, nextRun: '2026-09-08T03:00:00.000Z' },
        ]),
      runNow: vi.fn().mockResolvedValue('run-1'),
      setEnabled: vi.fn(),
    }
    const kernel = {
      cfg: { host: '127.0.0.1', port: 0 },
      scheduler,
      log: {
        listRuns: vi.fn().mockReturnValue([]),
        listEvents: vi.fn().mockReturnValue([]),
        subscribe: vi.fn(),
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for buildServer's Kernel param
    } as any
    const app = buildServer(kernel)

    const list = await app.inject({ method: 'GET', url: '/api/routines' })
    expect(list.json()).toEqual([
      { routine: { name: 'lint' }, nextRun: '2026-09-08T03:00:00.000Z' },
    ])

    const run = await app.inject({
      method: 'POST',
      url: '/api/routines/lint/run',
      payload: {},
    })
    expect(run.json()).toEqual({ runId: 'run-1' })

    const enable = await app.inject({
      method: 'POST',
      url: '/api/routines/lint/enable',
    })
    expect(enable.json()).toEqual({ ok: true })
    expect(scheduler.setEnabled).toHaveBeenCalledWith('lint', true)

    scheduler.runNow.mockRejectedValueOnce(new Error('unknown routine: nope'))
    const bad = await app.inject({
      method: 'POST',
      url: '/api/routines/nope/run',
      payload: {},
    })
    expect(bad.statusCode).toBe(404)
  })
})
