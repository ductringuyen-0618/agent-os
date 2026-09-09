import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Kernel, createKernel, loadKernelConfig } from '@agentos/kernel'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiClient } from './client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templateOsRoot = path.resolve(
  __dirname,
  '../../../examples/os-template/os',
)
const fakeClaudeBin = path.resolve(
  __dirname,
  '../../../tools/fake-claude/bin.js',
)
const fixturesDir = path.resolve(
  __dirname,
  '../../../tools/fake-claude/fixtures',
)

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

describe('M1 acceptance: up -> run heartbeat -> logs', () => {
  let tmpRoot: string
  let osRoot: string
  let kernel: Kernel

  afterEach(async () => {
    await kernel?.stop()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
    delete process.env.FAKE_CLAUDE_FIXTURE
  })

  it('starts the daemon, runs heartbeat through the fake claude, and lists its events', async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-acceptance-'))
    osRoot = path.join(tmpRoot, 'os')
    copyDir(templateOsRoot, osRoot)
    process.env.FAKE_CLAUDE_FIXTURE = path.join(
      fixturesDir,
      'init-success.jsonl',
    )

    const port = 45450 + Math.floor(Math.random() * 500)
    const cfg = loadKernelConfig(osRoot, { claudeBin: fakeClaudeBin, port })
    kernel = createKernel(cfg)
    await kernel.start()

    const client = new ApiClient({ baseUrl: `http://127.0.0.1:${port}` })
    expect(await client.health()).toEqual({ ok: true, version: '0.1.0' })

    const { runId } = await client.createRun({
      skill: 'heartbeat',
      agent: 'ops',
    })
    expect(runId).toBeTruthy()

    let run = await client.getRun(runId)
    for (
      let i = 0;
      i < 20 && run.status !== 'success' && run.status !== 'failed';
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      run = await client.getRun(runId)
    }
    expect(run.status).toBe('success')

    const events = await client.getRunEvents(runId)
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['run.started', 'run.stream', 'run.finished']),
    )
  })
})
