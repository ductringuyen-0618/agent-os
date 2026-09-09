import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KernelConfig } from '../../src/config.js'
import {
  WorkflowSuspended,
  createWorkflowContext,
} from '../../src/workflow/context.js'
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

describe('createWorkflowContext: step.sleep', () => {
  it('suspends on first call and sets the instance to sleeping with a wakeAt', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)

    await expect(ctx.step.sleep('cooldown', 5000)).rejects.toBeInstanceOf(
      WorkflowSuspended,
    )

    const updated = store.get(instance.id)
    expect(updated?.status).toBe('sleeping')
    expect(updated?.currentStep).toBe('cooldown')
    expect(updated?.wakeAt).toBeDefined()
    expect(store.getStep(instance.id, 'cooldown')?.status).toBe('sleeping')
  })

  it('re-suspends on replay before wakeAt, and resolves once wakeAt has passed', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    await createWorkflowContext(deps, instance)
      .step.sleep('cooldown', 50)
      .catch(() => {})

    // biome-ignore lint/style/noNonNullAssertion: created above
    const tooSoon = createWorkflowContext(deps, store.get(instance.id)!)
    await expect(tooSoon.step.sleep('cooldown', 50)).rejects.toBeInstanceOf(
      WorkflowSuspended,
    )

    await new Promise((r) => setTimeout(r, 60))
    // biome-ignore lint/style/noNonNullAssertion: created above
    const dueCtx = createWorkflowContext(deps, store.get(instance.id)!)
    await expect(dueCtx.step.sleep('cooldown', 50)).resolves.toBeUndefined()
    expect(store.getStep(instance.id, 'cooldown')?.status).toBe('succeeded')
  })
})

describe('createWorkflowContext: step.waitForEvent', () => {
  it('suspends and records wait_event on the instance', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)

    await expect(
      ctx.step.waitForEvent('await-approval', 'decision.resolved', {
        timeoutMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(WorkflowSuspended)

    const updated = store.get(instance.id)
    expect(updated?.status).toBe('waiting')
    expect(updated?.waitEvent).toBe('decision.resolved')
  })

  it('resolves with the matching event payload once one arrives, applying opts.match', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    await createWorkflowContext(deps, instance)
      .step.waitForEvent('await-approval', 'decision.resolved', {
        timeoutMs: 60_000,
      })
      .catch(() => {})

    log.append({ type: 'decision.resolved', payload: { id: 'other-decision' } })
    log.append({
      type: 'decision.resolved',
      payload: { id: 'd1', ref: '001-slug.md' },
    })

    // biome-ignore lint/style/noNonNullAssertion: created above
    const replay = createWorkflowContext(deps, store.get(instance.id)!)
    const result = await replay.step.waitForEvent(
      'await-approval',
      'decision.resolved',
      {
        timeoutMs: 60_000,
        match: (e) => (e.payload as { ref?: string }).ref === '001-slug.md',
      },
    )

    expect(result).toEqual({ id: 'd1', ref: '001-slug.md' })
    expect(store.getStep(instance.id, 'await-approval')?.status).toBe(
      'succeeded',
    )
  })

  it('fails the step with a timeout error once wakeAt has passed with no match', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    await createWorkflowContext(deps, instance)
      .step.waitForEvent('await-approval', 'decision.resolved', {
        timeoutMs: 30,
      })
      .catch(() => {})

    await new Promise((r) => setTimeout(r, 40))
    // biome-ignore lint/style/noNonNullAssertion: created above
    const replay = createWorkflowContext(deps, store.get(instance.id)!)

    await expect(
      replay.step.waitForEvent('await-approval', 'decision.resolved', {
        timeoutMs: 30,
      }),
    ).rejects.toThrow(/timed out/)
    expect(store.getStep(instance.id, 'await-approval')?.status).toBe('failed')
  })
})
