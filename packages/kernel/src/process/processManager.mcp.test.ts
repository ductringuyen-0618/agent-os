import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from '../config.js'
import { EventLog } from '../log/eventLog.js'
import { ProcessManager } from './processManager.js'
import type { SpawnSpec } from './processManager.js'

const fakeClaudeBin = fileURLToPath(
  new URL('../../../../tools/fake-claude/bin.js', import.meta.url),
)

let dir: string
let log: EventLog
let pm: ProcessManager
let argsOutPath: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-pm-mcp-'))
  argsOutPath = path.join(dir, 'args.json')
  log = new EventLog(path.join(dir, 'test.db'))
  const cfg = loadKernelConfig(dir, { claudeBin: fakeClaudeBin })
  pm = new ProcessManager(cfg, log)
  process.env.FAKE_CLAUDE_FIXTURE = fileURLToPath(
    new URL(
      '../../../../tools/fake-claude/fixtures/init-success.jsonl',
      import.meta.url,
    ),
  )
  process.env.FAKE_CLAUDE_ARGS_OUT = argsOutPath
})

afterEach(async () => {
  // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
  delete process.env.FAKE_CLAUDE_FIXTURE
  // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
  delete process.env.FAKE_CLAUDE_ARGS_OUT
  log.close()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('ProcessManager mcp wiring', () => {
  it('passes --mcp-config <path> and --strict-mcp-config', async () => {
    const run = log.createRun({
      routine: 'ingest',
      skill: 'ingest',
      agent: 'librarian',
    })
    const spec: SpawnSpec = {
      prompt: 'do the thing',
      systemPromptAppend: '',
      cwd: dir,
      model: 'sonnet',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read'],
      addDirs: [dir],
      mcpConfigPath: path.join(dir, 'mcp.json'),
      timeoutMs: 5000,
    }
    await fs.writeFile(spec.mcpConfigPath, '{}', 'utf8')
    await pm.start(run, spec)

    const argv: string[] = JSON.parse(await fs.readFile(argsOutPath, 'utf8'))
    const mcpIdx = argv.indexOf('--mcp-config')
    expect(mcpIdx).toBeGreaterThanOrEqual(0)
    expect(argv[mcpIdx + 1]).toBe(spec.mcpConfigPath)
    expect(argv).toContain('--strict-mcp-config')
  })
})
