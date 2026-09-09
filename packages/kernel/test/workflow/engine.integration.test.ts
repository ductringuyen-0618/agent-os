import { describe, expect, it } from 'vitest'
import type { KernelConfig } from '../../src/config.js'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

const cfg = {
  osRoot: 'C:/os',
  runtimeDir: 'C:/.agentos',
  dbPath: ':memory:',
  claudeBin: 'true',
  host: '127.0.0.1',
  port: 4547,
  logLevel: 'info',
} as KernelConfig

describe('WorkflowEngine restart-resume from every resumable status', () => {
  it('resumes a running instance (interrupted mid step.do) without re-running the already-succeeded step', async () => {
    const log = new EventLog(':memory:')
    const stuckDef: WorkflowDefinition = {
      kind: 'restart-running',
      async run(ctx) {
        await ctx.step.do('a', {}, async () => 'a')
        // never resolves -- simulates a daemon process that died mid-step
        await ctx.step.do(
          'b',
          { retries: 0 },
          () => new Promise<string>(() => {}),
        )
      },
    }
    const first = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    first.registry.register(stuckDef)
    const instance = await first.create('restart-running', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(log.getWorkflow(instance.id)?.status).toBe('running')
    expect(
      log.listWorkflowSteps(instance.id).find((s) => s.name === 'a')?.status,
    ).toBe('succeeded')

    const workingDef: WorkflowDefinition = {
      kind: 'restart-running',
      async run(ctx) {
        const a = await ctx.step.do('a', {}, async () => 'a')
        const b = await ctx.step.do('b', {}, async () => 'b') // this time it actually resolves
        ctx.state.result = `${a}${b}`
      },
    }
    const second = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    second.registry.register(workingDef)
    second.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(second.get(instance.id)?.status).toBe('succeeded')
    expect(second.get(instance.id)?.state.result).toBe('ab')
    second.stop()
  })

  it('resumes a waiting instance once the second engine boots, replaying the same match predicate against events recorded while it was down', async () => {
    const log = new EventLog(':memory:')
    const def: WorkflowDefinition = {
      kind: 'restart-waiting',
      async run(ctx) {
        const payload = await ctx.step.waitForEvent<{ ref: string }>(
          'gate',
          'decision.resolved',
          {
            timeoutMs: 60_000,
            match: (e) => (e.payload as { ref?: string }).ref === '001-slug.md',
          },
        )
        ctx.state.ref = payload.ref
      },
    }
    const first = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    first.registry.register(def)
    const instance = await first.create('restart-waiting', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(first.get(instance.id)?.status).toBe('waiting')

    // Arrives while no engine is running -- proves resume scans EventLog history, not a live callback.
    log.append({ type: 'decision.resolved', payload: { ref: '001-slug.md' } })

    const second = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    second.registry.register(def)
    second.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(second.get(instance.id)?.status).toBe('succeeded')
    expect(second.get(instance.id)?.state.ref).toBe('001-slug.md')
    second.stop()
  })

  it('resumes a sleeping instance once its wakeAt has passed', async () => {
    const log = new EventLog(':memory:')
    const def: WorkflowDefinition = {
      kind: 'restart-sleeping',
      async run(ctx) {
        await ctx.step.sleep('cooldown', 30)
        ctx.state.done = true
      },
    }
    const first = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    first.registry.register(def)
    const instance = await first.create('restart-sleeping', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(first.get(instance.id)?.status).toBe('sleeping')

    await new Promise((r) => setTimeout(r, 40)) // past wakeAt while no engine is running

    const second = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    second.registry.register(def)
    second.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(second.get(instance.id)?.status).toBe('succeeded')
    second.stop()
  })
})
