import { describe, expect, it, vi } from 'vitest'
import type { KernelConfig } from '../../src/config.js'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

const cfg = {
  osRoot: 'C:/os',
  runtimeDir: 'C:/.agentos',
  dbPath: ':memory:',
  claudeBin: 'claude',
  host: '127.0.0.1',
  port: 4545,
  logLevel: 'info',
} as KernelConfig

function makeEngine() {
  const log = new EventLog(':memory:')
  const pm = new ProcessManager(cfg, log)
  const engine = new WorkflowEngine(cfg, log, pm)
  return { engine, log, pm }
}

describe('WorkflowEngine core', () => {
  it('create() rejects an unregistered kind', async () => {
    const { engine } = makeEngine()
    await expect(engine.create('nope', {})).rejects.toThrow(
      /unknown workflow kind/,
    )
  })

  it('runs a fake definition to completion and emits workflow.created/succeeded', async () => {
    const { engine, log } = makeEngine()
    const fakeDef: WorkflowDefinition<{ title: string }> = {
      kind: 'fake',
      async run(ctx) {
        const brief = await ctx.step.do('brief', {}, async () => ({
          slug: 'my-feature',
        }))
        ctx.state.slug = (brief as { slug: string }).slug
      },
    }
    engine.registry.register(fakeDef)

    const instance = await engine.create('fake', { title: 'Add dark mode' })
    await new Promise((r) => setTimeout(r, 20))

    const final = engine.get(instance.id)
    expect(final?.status).toBe('succeeded')
    expect(final?.state.slug).toBe('my-feature')
    const types = log.listEvents({}).map((e) => e.type)
    expect(types).toContain('workflow.created')
    expect(types).toContain('workflow.step.succeeded')
    expect(types).toContain('workflow.succeeded')
  })

  it('fails the instance and emits workflow.failed when a step exhausts retries', async () => {
    const { engine } = makeEngine()
    const failingDef: WorkflowDefinition = {
      kind: 'failing',
      async run(ctx) {
        await ctx.step.do('boom', { retries: 0 }, async () => {
          throw new Error('nope')
        })
      },
    }
    engine.registry.register(failingDef)

    const instance = await engine.create('failing', {})
    await new Promise((r) => setTimeout(r, 20))

    const final = engine.get(instance.id)
    expect(final?.status).toBe('failed')
    expect(final?.error).toBe('nope')
  })

  it('list()/steps() reflect the persisted instance and its step rows', async () => {
    const { engine } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'listed',
      async run(ctx) {
        await ctx.step.do('a', {}, async () => 'a')
      },
    }
    engine.registry.register(def)
    const instance = await engine.create(
      'listed',
      {},
      { project: 'techpulse', title: 'Listed' },
    )
    await new Promise((r) => setTimeout(r, 20))

    expect(engine.list({ status: 'succeeded' }).map((w) => w.id)).toContain(
      instance.id,
    )
    expect(engine.list({ project: 'techpulse' }).map((w) => w.id)).toContain(
      instance.id,
    )
    expect(engine.steps(instance.id).map((s) => s.name)).toEqual(['a'])
  })
})

describe('WorkflowEngine wake-ups', () => {
  it('wakes a sleeping instance once its wakeAt has passed via the 5s alarm tick', async () => {
    vi.useFakeTimers()
    const { engine } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'napper',
      async run(ctx) {
        await ctx.step.sleep('nap', 8_000)
        ctx.state.woke = true
      },
    }
    engine.registry.register(def)
    engine.start()

    const instance = await engine.create('napper', {})
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.get(instance.id)?.status).toBe('sleeping')

    await vi.advanceTimersByTimeAsync(10_000) // past wakeAt, at least one 5s alarm tick
    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(engine.get(instance.id)?.state.woke).toBe(true)
    engine.stop()
    vi.useRealTimers()
  })

  it('wakes a waiting instance as soon as a matching event is appended', async () => {
    const { engine, log } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'waiter',
      async run(ctx) {
        const payload = await ctx.step.waitForEvent<{ approved: boolean }>(
          'gate',
          'decision.resolved',
          { timeoutMs: 60_000 },
        )
        ctx.state.approved = payload.approved
      },
    }
    engine.registry.register(def)
    engine.start()

    const instance = await engine.create('waiter', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.get(instance.id)?.status).toBe('waiting')

    log.append({ type: 'decision.resolved', payload: { approved: true } })
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(engine.get(instance.id)?.state.approved).toBe(true)
    engine.stop()
  })

  it('resumes running|waiting|sleeping instances on start() (boot recovery)', async () => {
    const { engine, log } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'resumable',
      async run(ctx) {
        await ctx.step.do('step-a', {}, async () => 'a')
      },
    }
    engine.registry.register(def)
    const stuck = log.createWorkflow({
      kind: 'resumable',
      title: 't',
      input: {},
    })
    log.updateWorkflow(stuck.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })

    engine.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(engine.get(stuck.id)?.status).toBe('succeeded')
    engine.stop()
  })
})

describe('WorkflowEngine pause/resume/terminate and max_concurrent', () => {
  it('pause stops further steps from starting; an already in-flight step still finishes', async () => {
    const { engine } = makeEngine()
    let resolveStepA: (v: string) => void = () => {}
    const stepAPromise = new Promise<string>((r) => {
      resolveStepA = r
    })
    const def: WorkflowDefinition = {
      kind: 'pausable',
      async run(ctx) {
        await ctx.step.do('step-a', {}, () => stepAPromise)
        await ctx.step.do('step-b', {}, async () => 'b')
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('pausable', {})
    await new Promise((r) => setTimeout(r, 10)) // step-a is now in flight

    await engine.pause(instance.id)
    expect(engine.get(instance.id)?.status).toBe('paused')

    resolveStepA('a')
    await new Promise((r) => setTimeout(r, 10))

    expect(
      engine.steps(instance.id).find((s) => s.name === 'step-a')?.status,
    ).toBe('succeeded')
    expect(
      engine.steps(instance.id).find((s) => s.name === 'step-b'),
    ).toBeUndefined()
    expect(engine.get(instance.id)?.status).toBe('paused')
  })

  it('resume replays a paused instance to completion', async () => {
    const { engine } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'resume-me',
      async run(ctx) {
        await ctx.step.do('step-a', {}, async () => 'a')
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('resume-me', {})
    await engine.pause(instance.id)
    await new Promise((r) => setTimeout(r, 10))

    await engine.resume(instance.id)
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
  })

  it('resume from failed resets the failed step and retries it', async () => {
    const { engine } = makeEngine()
    let attempts = 0
    const def: WorkflowDefinition = {
      kind: 'flaky',
      async run(ctx) {
        await ctx.step.do('validate', { retries: 0 }, async () => {
          attempts++
          if (attempts === 1) throw new Error('checks failed')
          return 'ok'
        })
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('flaky', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.get(instance.id)?.status).toBe('failed')

    await engine.resume(instance.id)
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(attempts).toBe(2)
  })

  it('resume rejects an instance that is neither paused nor failed', async () => {
    const { engine } = makeEngine()
    const def: WorkflowDefinition = { kind: 'done-already', async run() {} }
    engine.registry.register(def)
    const instance = await engine.create('done-already', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.get(instance.id)?.status).toBe('succeeded')
    await expect(engine.resume(instance.id)).rejects.toThrow(/cannot resume/)
  })

  it('terminate kills the current step run and marks the instance terminated', async () => {
    const { engine, pm } = makeEngine()
    const killSpy = vi.spyOn(pm, 'kill').mockReturnValue(true)
    pm.runToCompletion = vi.fn().mockImplementation(() => new Promise(() => {}))
    const def: WorkflowDefinition = {
      kind: 'long-build',
      async run(ctx) {
        await ctx.step.run('build', { skill: 'build', agent: 'ops' })
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('long-build', {})
    await new Promise((r) => setTimeout(r, 10))

    await engine.terminate(instance.id)

    expect(killSpy).toHaveBeenCalled()
    expect(engine.get(instance.id)?.status).toBe('terminated')
    expect(
      engine.steps(instance.id).find((s) => s.name === 'build')?.status,
    ).toBe('skipped')
  })

  it('runs at most max_concurrent instances at once, queuing the rest', async () => {
    const { engine } = makeEngine()
    engine.load(
      {
        model: 'sonnet',
        permission_mode: 'plan',
        allowed_tools: [],
        max_attempts: 2,
        timeout_ms: 60_000,
      },
      1,
    )
    let concurrent = 0
    let maxSeen = 0
    const gate: Array<() => void> = []
    const def: WorkflowDefinition = {
      kind: 'slow',
      async run() {
        concurrent++
        maxSeen = Math.max(maxSeen, concurrent)
        await new Promise<void>((resolve) => gate.push(resolve))
        concurrent--
      },
    }
    engine.registry.register(def)
    const a = await engine.create('slow', {})
    const b = await engine.create('slow', {})
    await new Promise((r) => setTimeout(r, 10))

    expect(maxSeen).toBe(1) // max_concurrent: 1 -- b has not started yet
    gate.shift()?.()
    await new Promise((r) => setTimeout(r, 10))
    gate.shift()?.()
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(a.id)?.status).toBe('succeeded')
    expect(engine.get(b.id)?.status).toBe('succeeded')
  })
})
