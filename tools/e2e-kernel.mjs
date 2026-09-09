import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernel, loadKernelConfig } from '@agentos/kernel'
import { seedDecision } from './seed-decision.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const osRoot = path.resolve(here, '../examples/os-template/os')
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-e2e-'))

const cfg = loadKernelConfig(osRoot, {
  port: 4545,
  runtimeDir,
  dbPath: path.join(runtimeDir, 'agentos.db'),
  claudeBin: path.resolve(here, 'fake-claude/bin.js'),
})

const kernel = createKernel(cfg)
await kernel.start()
seedDecision(cfg.dbPath)
