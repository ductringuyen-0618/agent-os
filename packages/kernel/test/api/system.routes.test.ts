import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../src/api/server.js'

function buildKernel(overrides: {
  scheduler?: Record<string, unknown>
  pm?: Record<string, unknown>
}) {
  const scheduler = {
    getPause: vi.fn().mockReturnValue(null),
    pause: vi.fn().mockReturnValue({ at: '2026-09-13T00:00:00.000Z' }),
    resume: vi.fn(),
    ...overrides.scheduler,
  }
  const pm = {
    killAll: vi.fn().mockReturnValue(0),
    ...overrides.pm,
  }
  const kernel = {
    cfg: { host: '127.0.0.1', port: 0 },
    scheduler,
    pm,
    log: {
      listRuns: vi.fn().mockReturnValue([]),
      listEvents: vi.fn().mockReturnValue([]),
      subscribe: vi.fn(),
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for buildServer's Kernel param
  } as any
  return { kernel, scheduler, pm }
}

describe('system pause/resume routes', () => {
  it('GET /api/system/pause reports the current state', async () => {
    const { kernel, scheduler } = buildKernel({})
    const app = buildServer(kernel)
    const res = await app.inject({ method: 'GET', url: '/api/system/pause' })
    expect(res.json()).toBeNull()
    expect(scheduler.getPause).toHaveBeenCalled()
    await app.close()
  })

  it('POST /api/system/pause pauses without killing running work by default', async () => {
    const { kernel, scheduler, pm } = buildKernel({})
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/pause',
      payload: { reason: 'investigating', by: 'dashboard' },
    })
    expect(res.json()).toEqual({
      pause: { at: '2026-09-13T00:00:00.000Z' },
    })
    expect(scheduler.pause).toHaveBeenCalledWith('investigating', 'dashboard')
    expect(pm.killAll).not.toHaveBeenCalled()
    await app.close()
  })

  it('POST /api/system/pause with stopRunning also kills every in-flight run', async () => {
    const { kernel, pm } = buildKernel({
      pm: { killAll: vi.fn().mockReturnValue(3) },
    })
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/pause',
      payload: { stopRunning: true },
    })
    expect(res.json()).toMatchObject({ stopped: 3 })
    expect(pm.killAll).toHaveBeenCalled()
    await app.close()
  })

  it('POST /api/system/resume clears the pause', async () => {
    const { kernel, scheduler } = buildKernel({})
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/resume',
    })
    expect(res.json()).toEqual({ ok: true })
    expect(scheduler.resume).toHaveBeenCalled()
    await app.close()
  })
})
