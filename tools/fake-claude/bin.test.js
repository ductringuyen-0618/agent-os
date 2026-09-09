import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const binPath = path.resolve(__dirname, 'bin.js')
const fixturesDir = path.resolve(__dirname, 'fixtures')

describe('fake-claude bin.js', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('replays the fixture to stdout and exits 0 on success', async () => {
    const result = await execa(
      process.execPath,
      [binPath, '-p', '--output-format', 'stream-json'],
      {
        env: {
          ...process.env,
          FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'init-success.jsonl'),
        },
        reject: false,
      },
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"session_id":"sess-init-success"')
  })

  it('exits 1 when the fixture reports an error', async () => {
    const result = await execa(process.execPath, [binPath, '-p'], {
      env: {
        ...process.env,
        FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'error.jsonl'),
      },
      reject: false,
    })
    expect(result.exitCode).toBe(1)
  })

  it('records argv when FAKE_CLAUDE_ARGS_OUT is set', async () => {
    const argsOut = path.join(tmpDir, 'args.json')
    await execa(process.execPath, [binPath, '-p', '--model', 'haiku'], {
      env: {
        ...process.env,
        FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'init-success.jsonl'),
        FAKE_CLAUDE_ARGS_OUT: argsOut,
      },
      reject: false,
    })
    const recorded = JSON.parse(fs.readFileSync(argsOut, 'utf8'))
    expect(recorded).toEqual(['-p', '--model', 'haiku'])
  })

  it('replays the wrapup fixture when --resume is passed and FAKE_CLAUDE_WRAPUP_FIXTURE is set', async () => {
    const result = await execa(
      process.execPath,
      [binPath, '-p', '--resume', 'sess-init-success'],
      {
        env: {
          ...process.env,
          FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'init-success.jsonl'),
          FAKE_CLAUDE_WRAPUP_FIXTURE: path.join(
            fixturesDir,
            'wrapup-success.jsonl',
          ),
        },
        reject: false,
      },
    )
    expect(result.stdout).toContain('"session_id":"sess-wrapup"')
  })
})
