import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { ProcessManager } from './processManager.js'
import type { SpawnSpec, WrapUpSpec } from './processManager.js'

const fakeClaudeBin = fileURLToPath(
  new URL('../../../../tools/fake-claude/bin.js', import.meta.url),
)
const fixtures = (name: string) =>
  fileURLToPath(
    new URL(`../../../../tools/fake-claude/fixtures/${name}`, import.meta.url),
  )

let dir: string
let log: EventLog
let pm: ProcessManager

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-pm-wrap-'))
  log = new EventLog(path.join(dir, 'test.db'))
  const cfg = loadKernelConfig(dir, { claudeBin: fakeClaudeBin })
  pm = new ProcessManager(cfg, log)
})

afterEach(async () => {
  // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
  delete process.env.FAKE_CLAUDE_FIXTURE
  // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
  delete process.env.FAKE_CLAUDE_WRAPUP_FIXTURE
  log.close()
  await fs.rm(dir, { recursive: true, force: true })
})

function baseSpec(mcpConfigPath: string): SpawnSpec {
  return {
    prompt: 'do the thing',
    systemPromptAppend: '',
    cwd: dir,
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    allowedTools: ['Read'],
    addDirs: [dir],
    mcpConfigPath,
    timeoutMs: 5000,
  }
}

describe('ProcessManager.runToCompletion', () => {
  it('runs the wrap-up turn after a successful main run and finishes success', async () => {
    process.env.FAKE_CLAUDE_FIXTURE = fixtures('init-success.jsonl')
    process.env.FAKE_CLAUDE_WRAPUP_FIXTURE = fixtures('wrapup-success.jsonl')
    const run = log.createRun({
      routine: 'ingest',
      skill: 'ingest',
      agent: 'librarian',
    })
    const mcpConfigPath = path.join(dir, 'mcp.json')
    await fs.writeFile(mcpConfigPath, '{}', 'utf8')
    const wrapUp: WrapUpSpec = {
      skill: 'ingest',
      osRoot: dir,
      cwd: dir,
      model: 'haiku',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read'],
      addDirs: [dir],
      mcpConfigPath,
      timeoutMs: 5000,
    }

    const result = await pm.runToCompletion(
      run,
      baseSpec(mcpConfigPath),
      wrapUp,
    )

    expect(result.status).toBe('success')
    const finalRun = log.getRun(run.id)
    expect(finalRun?.status).toBe('success')
    const wrapupEvents = log.listEvents({
      runId: run.id,
      types: ['run.wrapup'],
    })
    expect(wrapupEvents).toHaveLength(1)
  })

  it('keeps the main turn result text even after the wrap-up turn', async () => {
    process.env.FAKE_CLAUDE_FIXTURE = fixtures('init-success.jsonl')
    process.env.FAKE_CLAUDE_WRAPUP_FIXTURE = fixtures('wrapup-success.jsonl')
    const run = log.createRun({
      routine: 'ingest',
      skill: 'ingest',
      agent: 'librarian',
    })
    const mcpConfigPath = path.join(dir, 'mcp.json')
    await fs.writeFile(mcpConfigPath, '{}', 'utf8')
    const result = await pm.runToCompletion(run, baseSpec(mcpConfigPath), {
      skill: 'ingest',
      osRoot: dir,
      ...baseSpec(mcpConfigPath),
    })
    expect(result.resultText).toBe('Heartbeat check complete.')
  })

  it('runs only the main turn when no wrap-up is given (workflow steps)', async () => {
    process.env.FAKE_CLAUDE_FIXTURE = fixtures('init-success.jsonl')
    const run = log.createRun({
      routine: 'workflow:feature-request:build',
      skill: 'feature-build',
      agent: 'ops',
    })
    const mcpConfigPath = path.join(dir, 'mcp.json')
    await fs.writeFile(mcpConfigPath, '{}', 'utf8')
    const result = await pm.runToCompletion(run, baseSpec(mcpConfigPath))
    expect(result.status).toBe('success')
    expect(result.resultText).toBe('Heartbeat check complete.')
    expect(log.getRun(run.id)?.status).toBe('success')
    expect(
      log.listEvents({ runId: run.id, types: ['run.wrapup'] }),
    ).toHaveLength(0)
  })

  it('does not run the wrap-up turn when the main run fails', async () => {
    process.env.FAKE_CLAUDE_FIXTURE = fixtures('error.jsonl')
    const run = log.createRun({
      routine: 'ingest',
      skill: 'ingest',
      agent: 'librarian',
    })
    const mcpConfigPath = path.join(dir, 'mcp.json')
    await fs.writeFile(mcpConfigPath, '{}', 'utf8')
    const wrapUp: WrapUpSpec = {
      skill: 'ingest',
      osRoot: dir,
      cwd: dir,
      model: 'haiku',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read'],
      addDirs: [dir],
      mcpConfigPath,
      timeoutMs: 5000,
    }

    const result = await pm.runToCompletion(
      run,
      baseSpec(mcpConfigPath),
      wrapUp,
    )

    expect(result.status).toBe('failed')
    expect(log.getRun(run.id)?.status).toBe('failed')
    expect(
      log.listEvents({ runId: run.id, types: ['run.wrapup'] }),
    ).toHaveLength(0)
  })
})
