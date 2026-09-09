import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { ProcessManager } from './processManager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fakeClaudeBin = path.resolve(
  __dirname,
  '../../../../tools/fake-claude/bin.js',
)
const fixturesDir = path.resolve(
  __dirname,
  '../../../../tools/fake-claude/fixtures',
)

describe('ProcessManager', () => {
  let tmpDir: string
  let log: EventLog

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-pm-'))
    log = new EventLog(path.join(tmpDir, 'agentos.db'))
  })

  afterEach(() => {
    log.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
    delete process.env.FAKE_CLAUDE_FIXTURE
    // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
    delete process.env.FAKE_CLAUDE_ARGS_OUT
  })

  it('runs a successful session through the fake claude and records events', async () => {
    const cfg = loadKernelConfig(path.join(tmpDir, 'os'), {
      claudeBin: fakeClaudeBin,
      dbPath: path.join(tmpDir, 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const run = log.createRun({
      routine: 'heartbeat',
      skill: 'heartbeat',
      agent: 'ops',
    })

    const argsOutPath = path.join(tmpDir, 'args.json')
    process.env.FAKE_CLAUDE_FIXTURE = path.join(
      fixturesDir,
      'init-success.jsonl',
    )
    process.env.FAKE_CLAUDE_ARGS_OUT = argsOutPath

    const result = await pm.start(run, {
      prompt: 'run the heartbeat',
      systemPromptAppend: 'you are ops',
      cwd: tmpDir,
      model: 'haiku',
      permissionMode: 'plan',
      allowedTools: ['Read', 'Glob'],
      addDirs: [tmpDir],
      mcpConfigPath: path.join(tmpDir, 'mcp.json'),
      timeoutMs: 10_000,
    })

    expect(result.status).toBe('success')
    expect(result.sessionId).toBe('sess-init-success')
    expect(result.costUsd).toBeCloseTo(0.0021)

    const updated = log.getRun(run.id)
    expect(updated?.status).toBe('success')
    expect(updated?.sessionId).toBe('sess-init-success')

    const events = log.listEvents({ runId: run.id })
    expect(events.some((e) => e.type === 'run.started')).toBe(true)
    expect(events.some((e) => e.type === 'run.stream')).toBe(true)
    expect(events.some((e) => e.type === 'run.finished')).toBe(true)

    const recordedArgs = JSON.parse(
      fs.readFileSync(argsOutPath, 'utf8'),
    ) as string[]
    expect(recordedArgs).toContain('--permission-mode')
    expect(recordedArgs).toContain('plan')
    expect(recordedArgs).toContain('--model')
    expect(recordedArgs).toContain('haiku')
  })

  it('marks the run failed when the fake claude reports an error', async () => {
    const cfg = loadKernelConfig(path.join(tmpDir, 'os'), {
      claudeBin: fakeClaudeBin,
      dbPath: path.join(tmpDir, 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const run = log.createRun({
      routine: 'heartbeat',
      skill: 'heartbeat',
      agent: 'ops',
    })

    process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'error.jsonl')

    const result = await pm.start(run, {
      prompt: 'run the heartbeat',
      systemPromptAppend: '',
      cwd: tmpDir,
      model: 'sonnet',
      permissionMode: 'plan',
      allowedTools: [],
      addDirs: [],
      mcpConfigPath: path.join(tmpDir, 'mcp.json'),
      timeoutMs: 10_000,
    })

    expect(result.status).toBe('failed')
    expect(log.getRun(run.id)?.status).toBe('failed')
  })

  it('running() reflects in-flight runs and empties out after completion', async () => {
    const cfg = loadKernelConfig(path.join(tmpDir, 'os'), {
      claudeBin: fakeClaudeBin,
      dbPath: path.join(tmpDir, 'agentos.db'),
    })
    const pm = new ProcessManager(cfg, log)
    const run = log.createRun({ routine: 'heartbeat' })
    process.env.FAKE_CLAUDE_FIXTURE = path.join(
      fixturesDir,
      'init-success.jsonl',
    )

    const promise = pm.start(run, {
      prompt: 'x',
      systemPromptAppend: '',
      cwd: tmpDir,
      model: 'haiku',
      permissionMode: 'plan',
      allowedTools: [],
      addDirs: [],
      mcpConfigPath: path.join(tmpDir, 'mcp.json'),
      timeoutMs: 10_000,
    })
    await promise
    expect(pm.running()).toEqual([])
  })
})
