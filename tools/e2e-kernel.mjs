import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernel, loadKernelConfig } from '@agentos/kernel'
import { seedDecision } from './seed-decision.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const osRoot = path.resolve(here, '../examples/os-template/os')
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-e2e-'))

// gh.ts has no KernelConfig field for its binary (unlike claudeBin below),
// so it's pointed at the fake CLI the same way any other AGENTOS_GH_BIN
// consumer would be: via the environment, set here before the kernel
// starts handling requests. Mirrors the fake-claude wiring immediately
// below, just via env vars instead of a cfg override.
process.env.AGENTOS_GH_BIN = path.resolve(here, 'fake-gh/bin.js')
process.env.FAKE_GH_REPOS_FIXTURE = path.resolve(
  here,
  'fake-gh/fixtures/repos.json',
)
process.env.FAKE_GH_DEFAULT_BRANCH = 'main'

const cfg = loadKernelConfig(osRoot, {
  port: 4545,
  runtimeDir,
  dbPath: path.join(runtimeDir, 'agentos.db'),
  claudeBin: path.resolve(here, 'fake-claude/bin.js'),
})

const kernel = createKernel(cfg)
await kernel.start()
seedDecision(cfg.dbPath)
