import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { registerSystemCommands } from '../src/commands/system.js'

describe('system command', () => {
  it('pause calls pauseSystem with the reason, --stop-running flag, and by=cli', async () => {
    const client = {
      pauseSystem: vi.fn().mockResolvedValue({
        pause: { at: '2026-09-13T00:00:00Z' },
      }),
      resumeSystem: vi.fn(),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for ApiClient
    } as any
    const program = new Command()
    registerSystemCommands(program, client)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await program.parseAsync([
      'node',
      'agentos',
      'pause',
      '--reason',
      'incident',
      '--stop-running',
    ])
    expect(client.pauseSystem).toHaveBeenCalledWith({
      reason: 'incident',
      by: 'cli',
      stopRunning: true,
    })
    expect(logSpy.mock.calls[0][0]).toContain('paused')
    logSpy.mockRestore()
  })

  it('pause reports how many runs were stopped when stopRunning killed some', async () => {
    const client = {
      pauseSystem: vi.fn().mockResolvedValue({
        pause: { at: '2026-09-13T00:00:00Z' },
        stopped: 2,
      }),
      resumeSystem: vi.fn(),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for ApiClient
    } as any
    const program = new Command()
    registerSystemCommands(program, client)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await program.parseAsync(['node', 'agentos', 'pause', '--stop-running'])
    expect(logSpy.mock.calls[0][0]).toContain('stopped 2 runs')
    logSpy.mockRestore()
  })

  it('resume calls resumeSystem', async () => {
    const client = {
      pauseSystem: vi.fn(),
      resumeSystem: vi.fn().mockResolvedValue({ ok: true }),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for ApiClient
    } as any
    const program = new Command()
    registerSystemCommands(program, client)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await program.parseAsync(['node', 'agentos', 'resume'])
    expect(client.resumeSystem).toHaveBeenCalled()
    expect(logSpy.mock.calls[0][0]).toBe('resumed')
    logSpy.mockRestore()
  })
})
