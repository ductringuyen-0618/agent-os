import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KernelConfig } from '../../src/config.js'
import { createWorkflowContext } from '../../src/workflow/context.js'
import { WorkflowStore } from '../../src/workflow/store.js'
import { FakeEventLog } from '../helpers/fakeEventLog.js'

const cfg = {
  osRoot: 'C:/os',
  runtimeDir: 'C:/.agentos',
  dbPath: ':memory:',
  claudeBin: 'claude',
  host: '127.0.0.1',
  port: 4545,
  logLevel: 'info',
} as KernelConfig
const defaults = {
  model: 'sonnet',
  permission_mode: 'plan' as const,
  allowed_tools: [],
  max_attempts: 2,
  timeout_ms: 60_000,
}

function makeDeps(log: FakeEventLog) {
  // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
  const store = new WorkflowStore(log as any)
  const onStepEvent = vi.fn()
  return {
    deps: {
      cfg,
      // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
      log: log as any,
      store,
      // biome-ignore lint/suspicious/noExplicitAny: not exercised by step.do
      pm: {} as any,
      defaults,
      daemonUrl: 'http://127.0.0.1:4545',
      onStepEvent,
    },
    store,
    onStepEvent,
  }
}

describe('createWorkflowContext: step.do', () => {
  it('executes a step once and persists its output', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    expect(ctx.id).toBe(instance.id)
    const fn = vi.fn().mockResolvedValue({ ok: true })

    const result = await ctx.step.do('brief', {}, fn)

    expect(result).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.getStep(instance.id, 'brief')?.status).toBe('succeeded')
    expect(ctx.state.brief).toEqual({ ok: true })
  })

  it('replay: a second context for the same instance returns the persisted output without re-running fn', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const fn = vi.fn().mockResolvedValue('first')
    await createWorkflowContext(deps, instance).step.do('brief', {}, fn)

    // biome-ignore lint/style/noNonNullAssertion: just created above
    const replayCtx = createWorkflowContext(deps, store.get(instance.id)!)
    const replayFn = vi.fn().mockResolvedValue('second')
    const result = await replayCtx.step.do('brief', {}, replayFn)

    expect(result).toBe('first')
    expect(replayFn).not.toHaveBeenCalled()
  })

  it('retries with exponential backoff from backoffMs, then succeeds', async () => {
    vi.useFakeTimers()
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')

    const promise = ctx.step.do('brief', { retries: 2, backoffMs: 1000 }, fn)
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.getStep(instance.id, 'brief')?.attempt).toBe(2)
    vi.useRealTimers()
  })

  it('fails the step and throws once retries are exhausted', async () => {
    vi.useFakeTimers()
    const log = new FakeEventLog()
    const { deps, store, onStepEvent } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))

    const promise = ctx.step.do('brief', { retries: 1, backoffMs: 500 }, fn)
    const assertion = expect(promise).rejects.toThrow('always fails')
    await vi.advanceTimersByTimeAsync(500)
    await assertion

    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.getStep(instance.id, 'brief')?.status).toBe('failed')
    expect(onStepEvent).toHaveBeenCalledWith(
      'workflow.step.failed',
      expect.objectContaining({ step: 'brief', error: 'always fails' }),
    )
    vi.useRealTimers()
  })

  it('applies opts.timeoutMs to fn', async () => {
    const log = new FakeEventLog()
    const { deps } = makeDeps(log)
    const instance = deps.store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    const neverResolves = () => new Promise<never>(() => {})

    await expect(
      ctx.step.do('brief', { retries: 0, timeoutMs: 20 }, neverResolves),
    ).rejects.toThrow(/timed out/)
  })
})
