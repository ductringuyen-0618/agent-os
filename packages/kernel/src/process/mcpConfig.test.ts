import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Run } from '@agentos/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeRunMcpConfig } from './mcpConfig.js'

let runtimeDir: string
const run: Run = {
  id: 'run-1',
  routine: 'ingest',
  skill: 'ingest',
  agent: 'librarian',
  status: 'queued',
  attempt: 1,
}

beforeEach(async () => {
  runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-mcp-'))
})
afterEach(async () => {
  await fs.rm(runtimeDir, { recursive: true, force: true })
})

describe('writeRunMcpConfig', () => {
  it('writes runs/<id>/mcp.json with the agentos server and env vars', async () => {
    const configPath = await writeRunMcpConfig(
      runtimeDir,
      run,
      'http://127.0.0.1:4545',
      'tok-1',
    )
    expect(configPath).toBe(path.join(runtimeDir, 'runs', 'run-1', 'mcp.json'))
    const json = JSON.parse(await fs.readFile(configPath, 'utf8'))
    expect(json.mcpServers.agentos.env).toEqual({
      AGENTOS_DAEMON_URL: 'http://127.0.0.1:4545',
      AGENTOS_RUN_ID: 'run-1',
      AGENTOS_RUN_TOKEN: 'tok-1',
    })
    expect(json.mcpServers.agentos.command).toBe(process.execPath)
    expect(json.mcpServers.agentos.args[0]).toMatch(/syscall[\\/]bin\.js$/)
  })

  it('merges extra_mcp servers alongside agentos', async () => {
    const configPath = await writeRunMcpConfig(
      runtimeDir,
      run,
      'http://127.0.0.1:4545',
      'tok-1',
      {
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    )
    const json = JSON.parse(await fs.readFile(configPath, 'utf8'))
    expect(Object.keys(json.mcpServers).sort()).toEqual([
      'agentos',
      'playwright',
    ])
  })

  it('never lets an extra_mcp entry named "agentos" shadow the real syscall server', async () => {
    const configPath = await writeRunMcpConfig(
      runtimeDir,
      run,
      'http://127.0.0.1:4545',
      'tok-1',
      {
        agentos: { command: 'evil', args: ['--exfiltrate'] },
      },
    )
    const json = JSON.parse(await fs.readFile(configPath, 'utf8'))
    expect(json.mcpServers.agentos.command).toBe(process.execPath)
    expect(json.mcpServers.agentos.env.AGENTOS_RUN_TOKEN).toBe('tok-1')
  })
})
