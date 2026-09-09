import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadKernelConfig } from './config.js'

describe('loadKernelConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Must actually remove the key: assigning undefined coerces to the string
    // 'undefined' since process.env values are always strings, which would break
    // the "unset" semantics these tests rely on.
    // biome-ignore lint/performance/noDelete: see comment above
    delete process.env.AGENTOS_PORT
    // biome-ignore lint/performance/noDelete: see comment above
    delete process.env.AGENTOS_TOKEN
    // biome-ignore lint/performance/noDelete: see comment above
    delete process.env.AGENTOS_CLAUDE_BIN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('derives runtimeDir and dbPath from osRoot', () => {
    const cfg = loadKernelConfig(path.join('some', 'instance', 'os'))
    expect(cfg.osRoot).toBe(path.resolve(path.join('some', 'instance', 'os')))
    expect(cfg.runtimeDir).toBe(
      path.resolve(path.join('some', 'instance', '.agentos')),
    )
    expect(cfg.dbPath).toBe(path.join(cfg.runtimeDir, 'agentos.db'))
  })

  it('defaults host, port, claudeBin, logLevel', () => {
    const cfg = loadKernelConfig('os')
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(4545)
    expect(cfg.claudeBin).toBe('claude')
    expect(cfg.logLevel).toBe('info')
    expect(cfg.authToken).toBeUndefined()
  })

  it('reads AGENTOS_PORT, AGENTOS_TOKEN, AGENTOS_CLAUDE_BIN from env', () => {
    process.env.AGENTOS_PORT = '5050'
    process.env.AGENTOS_TOKEN = 'secret-token'
    process.env.AGENTOS_CLAUDE_BIN = '/opt/fake-claude'
    const cfg = loadKernelConfig('os')
    expect(cfg.port).toBe(5050)
    expect(cfg.authToken).toBe('secret-token')
    expect(cfg.claudeBin).toBe('/opt/fake-claude')
  })

  it('lets explicit overrides win over env and defaults', () => {
    process.env.AGENTOS_PORT = '5050'
    const cfg = loadKernelConfig('os', { port: 9999, claudeBin: '/bin/fake' })
    expect(cfg.port).toBe(9999)
    expect(cfg.claudeBin).toBe('/bin/fake')
  })

  it('falls back to 4545 when AGENTOS_PORT is non-numeric', () => {
    process.env.AGENTOS_PORT = 'abc'
    const cfg = loadKernelConfig('os')
    expect(cfg.port).toBe(4545)
  })
})
