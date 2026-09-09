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
