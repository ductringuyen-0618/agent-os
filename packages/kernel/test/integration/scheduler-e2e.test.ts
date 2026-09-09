import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createKernel } from '../../src/kernel.js'

// path.resolve('tools/...') is cwd-dependent and breaks under
// `pnpm --filter @agentos/kernel test` (cwd = packages/kernel/, not the
// repo root) -- every other test file in this codebase resolves
// tools/fake-claude via import.meta.url instead; match that convention.
const fakeClaudeBin = fileURLToPath(
  new URL('../../../../tools/fake-claude/bin.js', import.meta.url),
)
const fixturesDir = fileURLToPath(
  new URL('../../../../tools/fake-claude/fixtures', import.meta.url),
)

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-e2e-'))
  await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true })
  await fs.writeFile(path.join(dir, 'wiki', 'index.md'), '# index\n')
  await fs.writeFile(path.join(dir, 'wiki', 'log.md'), '')
  for (const skill of ['heartbeat', 'ingest']) {
    await fs.mkdir(path.join(dir, 'skills', skill, 'context'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(dir, 'skills', skill, 'skill.md'),
      `# ${skill}\n`,
    )
    await fs.writeFile(path.join(dir, 'skills', skill, 'learnings.md'), '')
  }
  for (const agent of ['ops', 'librarian']) {
    await fs.mkdir(path.join(dir, 'agents', agent, 'workspace'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(dir, 'agents', agent, 'AGENT.md'),
      `# ${agent}\n`,
    )
  }
  await fs.writeFile(
    path.join(dir, 'routines.yaml'),
    [
      'defaults:',
      '  model: sonnet',
      '  permission_mode: plan',
      '  allowed_tools: []',
      '  max_attempts: 2',
      '  timeout_ms: 5000',
      'routines:',
      '  - name: heartbeat',
      '    every: 1s',
      '    skill: heartbeat',
      '    agent: ops',
      '  - name: ingest',
      '    on: [raw.added]',
      '    skill: ingest',
      '    agent: librarian',
    ].join('\n'),
  )
  return dir
}

describe('scheduler + heartbeat end-to-end (fake claude)', () => {
  it('heartbeat fires on a 1s override, a raw.added event auto-triggers ingest, and agentos routines shows next runs', async () => {
    const osRoot = await makeOsRoot()
    process.env.AGENTOS_CLAUDE_BIN = fakeClaudeBin
    process.env.FAKE_CLAUDE_FIXTURE = path.join(
      fixturesDir,
      'init-success.jsonl',
    )

    const kernel = createKernel({
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos-e2e'),
      dbPath: ':memory:',
      claudeBin: fakeClaudeBin,
      host: '127.0.0.1',
      port: 4998,
      logLevel: 'info',
    })
    await kernel.start()

    await new Promise((r) => setTimeout(r, 1500))
    const heartbeatRuns = kernel.log.listRuns({ routine: 'heartbeat' })
    expect(heartbeatRuns.length).toBeGreaterThanOrEqual(1)
    expect(heartbeatRuns[0].status).toBe('success')

    kernel.log.append({ type: 'raw.added', payload: { path: 'raw/x.md' } })
    await new Promise((r) => setTimeout(r, 300))
    const ingestRuns = kernel.log.listRuns({ routine: 'ingest' })
    expect(ingestRuns.length).toBe(1)

    const list = kernel.scheduler.list()
    const heartbeatEntry = list.find((l) => l.routine.name === 'heartbeat')
    expect(heartbeatEntry?.nextRun).toBeDefined()

    await kernel.stop()
  }, 10_000)

  it('a failed run retries once with 30s backoff', async () => {
    const osRoot = await makeOsRoot()
    process.env.AGENTOS_CLAUDE_BIN = fakeClaudeBin
    process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'error.jsonl')

    const kernel = createKernel({
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos-e2e-2'),
      dbPath: ':memory:',
      claudeBin: fakeClaudeBin,
      host: '127.0.0.1',
      port: 4997,
      logLevel: 'info',
    })
    await kernel.start()
    await kernel.scheduler.runNow('ingest')
    await new Promise((r) => setTimeout(r, 300))
    expect(kernel.log.listRuns({ routine: 'ingest' })[0].status).toBe('failed')
    expect(kernel.log.listRuns({ routine: 'ingest' })[0].attempt).toBe(1)
    // second attempt is scheduled 30s out; asserting it appears requires
    // fast-forwarding wall-clock time, out of scope for this integration
    // test -- the 30s*attempt backoff itself is covered by the fake-timer
    // unit test in Task 5 (scheduler.retry.test.ts). Here we only assert
    // the first failure was recorded correctly.
    await kernel.stop()
  }, 10_000)
})
