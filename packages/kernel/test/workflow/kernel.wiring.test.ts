import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createKernel } from '../../src/kernel.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-wf-kernel-'))
  await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true })
  await fs.writeFile(path.join(dir, 'wiki', 'index.md'), '# index\n')
  await fs.writeFile(path.join(dir, 'wiki', 'log.md'), '')
  await fs.mkdir(path.join(dir, 'agents', 'ops', 'workspace'), {
    recursive: true,
  })
  await fs.writeFile(path.join(dir, 'agents', 'ops', 'AGENT.md'), '# ops\n')
  await fs.writeFile(
    path.join(dir, 'routines.yaml'),
    'defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 60000\nroutines: []\nworkflows:\n  max_concurrent: 3\n',
  )
  return dir
}

describe('kernel workflow wiring', () => {
  it('starts and stops the WorkflowEngine, loading max_concurrent from routines.yaml, and runs a registered definition', async () => {
    const osRoot = await makeOsRoot()
    const def: WorkflowDefinition = {
      kind: 'smoke',
      async run(ctx) {
        await ctx.step.do('a', {}, async () => 'ok')
      },
    }
    const kernel = createKernel(
      {
        osRoot,
        runtimeDir: path.join(osRoot, '..', '.agentos'),
        dbPath: ':memory:',
        claudeBin: 'true',
        host: '127.0.0.1',
        port: 4991,
        logLevel: 'info',
      },
      {},
      [def],
    )
    await kernel.start()

    const instance = await kernel.workflows.create('smoke', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(kernel.workflows.get(instance.id)?.status).toBe('succeeded')

    await kernel.stop()
  })
})
