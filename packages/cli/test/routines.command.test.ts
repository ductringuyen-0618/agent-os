import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { registerRoutinesCommand } from '../src/commands/routines.js'

describe('routines command', () => {
  it('routines list prints one line per routine using the ApiClient', async () => {
    const client = {
      listRoutines: vi.fn().mockResolvedValue([
        {
          routine: { name: 'lint' },
          nextRun: '2026-09-08T03:00:00.000Z',
          lastRun: { status: 'success' },
        },
      ]),
      runRoutine: vi.fn(),
      setRoutineEnabled: vi.fn(),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for ApiClient
    } as any
    const program = new Command()
    registerRoutinesCommand(program, client)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await program.parseAsync(['node', 'agentos', 'routines', 'list'])
    expect(client.listRoutines).toHaveBeenCalled()
    expect(logSpy.mock.calls[0][0]).toContain('lint')
    logSpy.mockRestore()
  })

  it('routines run/enable/disable call the matching ApiClient methods', async () => {
    const client = {
      listRoutines: vi.fn(),
      runRoutine: vi.fn().mockResolvedValue({ runId: 'run-1' }),
      setRoutineEnabled: vi.fn().mockResolvedValue({ ok: true }),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for ApiClient
    } as any
    const program = new Command()
    registerRoutinesCommand(program, client)
    await program.parseAsync(['node', 'agentos', 'routines', 'run', 'lint'])
    expect(client.runRoutine).toHaveBeenCalledWith('lint')
    await program.parseAsync(['node', 'agentos', 'routines', 'enable', 'lint'])
    expect(client.setRoutineEnabled).toHaveBeenCalledWith('lint', true)
    await program.parseAsync(['node', 'agentos', 'routines', 'disable', 'lint'])
    expect(client.setRoutineEnabled).toHaveBeenCalledWith('lint', false)
  })
})
