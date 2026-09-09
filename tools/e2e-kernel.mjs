import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernel, loadKernelConfig } from '@agentos/kernel'
import { seedDecision } from './seed-decision.mjs'
import { seedWorkflow } from './seed-workflow.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-e2e-'))
// Run against a throwaway copy of the template: the e2e adds projects and
// routines, and those writes must never land in the repo's own template.
const osRoot = path.join(runtimeDir, 'os')
fs.cpSync(path.resolve(here, '../examples/os-template/os'), osRoot, {
  recursive: true,
})

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
// Every project the e2e adds clones this local bare repo (one empty commit
// on main), so the run never touches GitHub and never waits on credentials.
const seedRepo = path.join(runtimeDir, 'fake-remote-src')
const bareRepo = path.join(runtimeDir, 'fake-remote.git')
execFileSync('git', ['init', '-q', '-b', 'main', seedRepo])
execFileSync('git', [
  '-C',
  seedRepo,
  '-c',
  'user.name=e2e',
  '-c',
  'user.email=e2e@example.com',
  'commit',
  '-q',
  '--allow-empty',
  '-m',
  'init',
])
execFileSync('git', ['clone', '-q', '--bare', seedRepo, bareRepo])
process.env.FAKE_GH_CLONE_URL = bareRepo

const cfg = loadKernelConfig(osRoot, {
  port: 4545,
  runtimeDir,
  dbPath: path.join(runtimeDir, 'agentos.db'),
  claudeBin: path.resolve(here, 'fake-claude/bin.js'),
})

const kernel = createKernel(cfg)
await kernel.start()
seedDecision(cfg.dbPath)
seedWorkflow(cfg.dbPath)
