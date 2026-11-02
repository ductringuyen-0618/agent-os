import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createKernel } from '../src/kernel.js'

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-os-'))
  await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true })
  await fs.writeFile(path.join(dir, 'wiki', 'index.md'), '# index\n')
  await fs.writeFile(path.join(dir, 'wiki', 'log.md'), '')
  await fs.mkdir(path.join(dir, 'skills', 'heartbeat', 'context'), {
    recursive: true,
  })
  await fs.writeFile(
    path.join(dir, 'skills', 'heartbeat', 'skill.md'),
    '# heartbeat\n',
  )
  await fs.writeFile(path.join(dir, 'skills', 'heartbeat', 'learnings.md'), '')
  await fs.mkdir(path.join(dir, 'agents', 'ops', 'workspace'), {
    recursive: true,
  })
  await fs.writeFile(path.join(dir, 'agents', 'ops', 'AGENT.md'), '# ops\n')
  await fs.writeFile(
    path.join(dir, 'routines.yaml'),
    'defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 60000\nroutines:\n  - name: heartbeat\n    every: 1h\n    skill: heartbeat\n    agent: ops\n    model: haiku\n',
  )
  return dir
}

describe('kernel.ts exec wiring', () => {
  it('exec resolves a skill+agent routine, injects the heartbeat payload shape, and marks the run successful', async () => {
    const osRoot = await makeOsRoot()
    const kernel = createKernel({
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'node',
      host: '127.0.0.1',
      port: 4999,
      logLevel: 'info',
    })
    kernel.pm.start = vi.fn().mockResolvedValue({
      status: 'success',
      sessionId: 's1',
      costUsd: 0,
      inputTokens: 1,
      outputTokens: 1,
    })
    await kernel.start()
    const runId = await kernel.scheduler.runNow('heartbeat')
    await new Promise((r) => setTimeout(r, 50))
    const run = kernel.log.getRun(runId)
    expect(run?.status).toBe('success')
    // biome-ignore lint/suspicious/noExplicitAny: asserting against a vi.fn() mock's captured call args
    expect((kernel.pm.start as any).mock.calls[0][1].model).toBe('haiku')
    await kernel.stop()
  })

  it('stores the run context window and raises an ops.alert once inputTokens crosses the warn threshold', async () => {
    const osRoot = await makeOsRoot()
    const kernel = createKernel({
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'node',
      host: '127.0.0.1',
      port: 4996,
      logLevel: 'info',
    })
    // 'haiku' isn't a known model id in CONTEXT_WINDOWS, so this also
    // exercises the 200,000-token fallback window.
    kernel.pm.start = vi.fn().mockResolvedValue({
      status: 'success',
      sessionId: 's2',
      costUsd: 0,
      inputTokens: 180_000,
      outputTokens: 1,
    })
    await kernel.start()
    const runId = await kernel.scheduler.runNow('heartbeat')
    await new Promise((r) => setTimeout(r, 50))
    const run = kernel.log.getRun(runId)
    expect(run?.contextWindow).toBe(200_000)
    const alerts = kernel.log.listEvents({ types: ['ops.alert'] })
    expect(
      alerts.some((a) => a.payload.reason === 'context_budget_warning'),
    ).toBe(true)
    await kernel.stop()
  })

  it('raises no context-budget ops.alert when inputTokens stays under the warn threshold', async () => {
    const osRoot = await makeOsRoot()
    const kernel = createKernel({
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'node',
      host: '127.0.0.1',
      port: 4995,
      logLevel: 'info',
    })
    kernel.pm.start = vi.fn().mockResolvedValue({
      status: 'success',
      sessionId: 's3',
      costUsd: 0,
      inputTokens: 1_000,
      outputTokens: 1,
    })
    await kernel.start()
    await kernel.scheduler.runNow('heartbeat')
    await new Promise((r) => setTimeout(r, 50))
    const alerts = kernel.log.listEvents({ types: ['ops.alert'] })
    expect(
      alerts.some((a) => a.payload.reason === 'context_budget_warning'),
    ).toBe(false)
    await kernel.stop()
  })
})
