import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from '../config.js'
import { type Kernel, createKernel } from '../kernel.js'
import { buildServer } from './server.js'

describe('empty JSON bodies', () => {
  let tmpDir: string
  let kernel: Kernel

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-body-'))
    const osRoot = path.join(tmpDir, 'os')
    fs.mkdirSync(osRoot, { recursive: true })
    kernel = createKernel(
      loadKernelConfig(osRoot, {
        runtimeDir: path.join(tmpDir, '.agentos'),
        dbPath: ':memory:',
        port: 0,
      }),
    )
  })

  afterEach(async () => {
    await kernel.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('accepts a body-less POST that still declares application/json', async () => {
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/decisions/does-not-exist/approve',
      headers: { 'content-type': 'application/json' },
    })
    // 404 (unknown decision) proves the request got past body parsing.
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('still rejects malformed JSON', async () => {
    const app = buildServer(kernel)
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
