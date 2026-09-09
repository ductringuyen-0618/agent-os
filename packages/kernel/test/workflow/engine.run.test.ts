import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { KernelConfig } from '../../src/config.js'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

const fakeClaudeBin = fileURLToPath(
  new URL('../../../../tools/fake-claude/bin.js', import.meta.url),
)
const fixturesDir = fileURLToPath(
  new URL('../../../../tools/fake-claude/fixtures', import.meta.url),
)

/**
 * Waits until `engine.get(id)` reaches one of `statuses`, instead of a fixed
 * sleep. A fixed sleep here is racy under CPU contention (e.g. this
 * workspace's other packages' test suites, or sibling agents, running
 * concurrently) since these tests exercise a real or mocked async
 * completion rather than fixed in-process work.
 */
async function waitForStatus(
  engine: WorkflowEngine,
  id: string,
  statuses: string[],
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (statuses.includes(engine.get(id)?.status ?? '')) return
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-wf-'))
  await fs.mkdir(path.join(dir, 'agents', 'ops', 'workspace'), {
    recursive: true,
  })
  await fs.writeFile(path.join(dir, 'agents', 'ops', 'AGENT.md'), '# ops\n')
  await fs.mkdir(path.join(dir, 'skills', 'brief', 'context'), {
    recursive: true,
  })
  await fs.writeFile(path.join(dir, 'skills', 'brief', 'skill.md'), '# brief\n')
  await fs.writeFile(path.join(dir, 'skills', 'brief', 'learnings.md'), '')
  return dir
}

describe('WorkflowEngine step.run', () => {
  it('spawns a kernel Run via ProcessManager.runToCompletion and records run_id on the step', async () => {
    const osRoot = await makeOsRoot()
    const cfg = {
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'node',
      host: '127.0.0.1',
      port: 4545,
      logLevel: 'info',
    } as KernelConfig
    const log = new EventLog(':memory:')
    const pm = new ProcessManager(cfg, log)
    pm.runToCompletion = vi.fn().mockResolvedValue({
      status: 'success',
      sessionId: 's1',
      costUsd: 0.01,
      resultText: 'done',
    })
    const engine = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition<{ title: string }> = {
      kind: 'brief-only',
      async run(ctx) {
        const result = await ctx.step.run('brief', {
          skill: 'brief',
          agent: 'ops',
          task: { title: ctx.input.title },
        })
        ctx.state.sessionId = result.sessionId
      },
    }
    engine.registry.register(def)

    const instance = await engine.create('brief-only', {
      title: 'Add dark mode',
    })
    await waitForStatus(engine, instance.id, ['succeeded', 'failed'])

    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(engine.get(instance.id)?.state.sessionId).toBe('s1')
    const step = engine.steps(instance.id).find((s) => s.name === 'brief')
    expect(step?.runId).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: asserting against a vi.fn() mock's captured call args
    expect((pm.runToCompletion as any).mock.calls[0][1].model).toBe('sonnet')
  })

  it('fails the step and the instance when the run does not succeed', async () => {
    const osRoot = await makeOsRoot()
    const cfg = {
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'node',
      host: '127.0.0.1',
      port: 4545,
      logLevel: 'info',
    } as KernelConfig
    const log = new EventLog(':memory:')
    const pm = new ProcessManager(cfg, log)
    pm.runToCompletion = vi
      .fn()
      .mockResolvedValue({ status: 'failed', error: 'brief crashed' })
    const engine = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition = {
      kind: 'brief-fails',
      async run(ctx) {
        await ctx.step.run('brief', { skill: 'brief', agent: 'ops' })
      },
    }
    engine.registry.register(def)

    const instance = await engine.create('brief-fails', {})
    await waitForStatus(engine, instance.id, ['succeeded', 'failed'])

    expect(engine.get(instance.id)?.status).toBe('failed')
    expect(engine.get(instance.id)?.error).toBe('brief crashed')
  })

  it('runs a real step.run through fake-claude end to end', async () => {
    const osRoot = await makeOsRoot()
    const cfg = {
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos-wf-e2e'),
      dbPath: ':memory:',
      claudeBin: fakeClaudeBin,
      host: '127.0.0.1',
      port: 4546,
      logLevel: 'info',
    } as KernelConfig
    process.env.AGENTOS_CLAUDE_BIN = fakeClaudeBin
    process.env.FAKE_CLAUDE_FIXTURE = path.join(
      fixturesDir,
      'init-success.jsonl',
    )
    const log = new EventLog(':memory:')
    const pm = new ProcessManager(cfg, log)
    const engine = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition = {
      kind: 'brief-real',
      async run(ctx) {
        await ctx.step.run('brief', { skill: 'brief', agent: 'ops' })
      },
    }
    engine.registry.register(def)

    const instance = await engine.create('brief-real', {})
    await waitForStatus(engine, instance.id, ['succeeded', 'failed'])

    expect(engine.get(instance.id)?.status).toBe('succeeded')
  }, 15_000)
})
