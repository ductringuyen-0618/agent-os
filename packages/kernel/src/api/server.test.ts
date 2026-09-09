import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from '../config.js'
import { createKernel } from '../kernel.js'
import type { Kernel } from '../kernel.js'
import { EventLog } from '../log/eventLog.js'
import { ProcessManager } from '../process/processManager.js'
import { WikiService } from '../wiki/wikiService.js'
import { buildServer } from './server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fakeClaudeBin = path.resolve(
  __dirname,
  '../../../../tools/fake-claude/bin.js',
)
const fixturesDir = path.resolve(
  __dirname,
  '../../../../tools/fake-claude/fixtures',
)

describe('api/server runs routes', () => {
  let tmpDir: string
  let osRoot: string
  let log: EventLog

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-api-'))
    osRoot = path.join(tmpDir, 'os')
    await fsp.mkdir(path.join(osRoot, 'skills', 'heartbeat'), {
      recursive: true,
    })
    await fsp.mkdir(path.join(osRoot, 'agents', 'ops'), { recursive: true })
    await fsp.writeFile(
      path.join(osRoot, 'skills', 'heartbeat', 'skill.md'),
      '# Heartbeat skill\nCheck routines.',
    )
    await fsp.writeFile(
      path.join(osRoot, 'agents', 'ops', 'AGENT.md'),
      '# ops agent',
    )
    await fsp.writeFile(
      path.join(osRoot, 'CLAUDE.md'),
      '# agent-os instance schema',
    )
    await fsp.writeFile(
      path.join(osRoot, 'routines.yaml'),
      [
        'defaults:',
        '  model: sonnet',
        '  permission_mode: plan',
        '  allowed_tools: [Read]',
        '  max_attempts: 1',
        '  timeout_ms: 5000',
        'routines: []',
        '',
      ].join('\n'),
    )
    process.env.FAKE_CLAUDE_FIXTURE = path.join(
      fixturesDir,
      'init-success.jsonl',
    )
    process.env.FAKE_CLAUDE_WRAPUP_FIXTURE = path.join(
      fixturesDir,
      'wrapup-success.jsonl',
    )
    log = new EventLog(path.join(tmpDir, '.agentos', 'agentos.db'))
  })

  afterEach(() => {
    log.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
    delete process.env.FAKE_CLAUDE_FIXTURE
    // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
    delete process.env.FAKE_CLAUDE_WRAPUP_FIXTURE
  })

  it('reports health', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.json()).toEqual({ ok: true, version: '0.1.0' })
    await app.close()
  })

  it('creates a run over HTTP and lets it complete through the fake claude', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
    })
    const kernel = createKernel(cfg)
    const app = buildServer(kernel)

    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { skill: 'heartbeat', agent: 'ops' },
    })
    expect(created.statusCode).toBe(202)
    const { runId } = created.json() as { runId: string }
    expect(runId).toBeTruthy()

    // Now goes through the Scheduler's runToCompletion (main turn + a
    // kernel-driven wrap-up turn, i.e. two real fake-claude subprocess
    // spawns), which can take longer than a single fixed sleep under
    // parallel-suite CPU contention -- poll until the run reaches a
    // terminal status instead of guessing a sleep duration.
    const terminal = new Set(['success', 'failed', 'killed'])
    let runRes: Awaited<ReturnType<typeof app.inject>> | undefined
    for (let i = 0; i < 40; i++) {
      runRes = await app.inject({ method: 'GET', url: `/api/runs/${runId}` })
      if (terminal.has(runRes.json().status)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    // biome-ignore lint/style/noNonNullAssertion: the loop above always assigns at least once
    expect(runRes!.json().status).toBe('success')

    const eventsRes = await app.inject({
      method: 'GET',
      url: `/api/runs/${runId}/events`,
    })
    const events = eventsRes.json() as Array<{ type: string }>
    expect(events.some((e) => e.type === 'run.finished')).toBe(true)

    const listRes = await app.inject({ method: 'GET', url: '/api/runs' })
    expect((listRes.json() as unknown[]).length).toBeGreaterThan(0)

    await app.close()
    await kernel.stop()
  })

  it('rejects requests without a skill', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('enforces the bearer token when authToken is set', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
      authToken: 'secret',
    })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)
    const unauthorized = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(unauthorized.statusCode).toBe(401)
    const authorized = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { authorization: 'Bearer secret' },
    })
    expect(authorized.statusCode).toBe(200)
    await app.close()
  })

  it('reaches /internal/syscall via X-Run-Token even when a daemon authToken is set', async () => {
    await fsp.mkdir(path.join(osRoot, 'wiki'), { recursive: true })
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
      authToken: 'secret',
    })
    const pm = new ProcessManager(cfg, log)
    const wiki = new WikiService(osRoot, log)
    const scheduler = {
      scheduleOnce: () => 'sched-1',
    } as unknown as Kernel['scheduler']
    const app = buildServer({
      cfg,
      log,
      pm,
      wiki,
      scheduler,
    } as unknown as Kernel)

    const run = log.createRun({
      routine: 'ingest',
      skill: 'ingest',
      agent: 'librarian',
    })
    log.createRunToken(run.id, 'tok-good')

    // No Authorization header at all — only the run token, as a sandboxed
    // agent subprocess would send it. Must NOT be blocked by the daemon's
    // admin bearer-token hook.
    const res = await app.inject({
      method: 'POST',
      url: '/internal/syscall',
      headers: { 'x-run-token': 'tok-good' },
      payload: { tool: 'get_context', args: {} },
    })
    expect(res.statusCode).toBe(200)

    // A missing/invalid run token must still 401 (via internal.ts's own
    // check, not the bearer hook) even without an Authorization header.
    const noToken = await app.inject({
      method: 'POST',
      url: '/internal/syscall',
      payload: { tool: 'get_context', args: {} },
    })
    expect(noToken.statusCode).toBe(401)

    await app.close()
  })

  it('serves the built dashboard at /', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    await app.close()
  })

  it('lists skills and agents from the os/ directory', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)

    const skills = await app.inject({ method: 'GET', url: '/api/skills' })
    expect(skills.json()).toEqual([
      { name: 'heartbeat', path: 'skills/heartbeat', hasLearnings: false },
    ])

    const agents = await app.inject({ method: 'GET', url: '/api/agents' })
    expect(agents.json()).toEqual([{ name: 'ops', status: 'idle' }])

    await app.close()
  })

  it('returns costs for recent runs within the window', async () => {
    const cfg = loadKernelConfig(osRoot, {
      claudeBin: fakeClaudeBin,
      runtimeDir: path.join(tmpDir, '.agentos'),
      dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)

    const run = log.createRun({ routine: 'heartbeat', agent: 'ops' })
    log.updateRun(run.id, {
      status: 'success',
      startedAt: new Date().toISOString(),
      costUsd: 0.05,
    })

    const res = await app.inject({ method: 'GET', url: '/api/costs?days=1' })
    expect(res.json()).toEqual([
      {
        day: new Date().toISOString().slice(0, 10),
        agent: 'ops',
        costUsd: 0.05,
      },
    ])

    await app.close()
  })
})
