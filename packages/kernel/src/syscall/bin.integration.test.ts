import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerInternalRoutes } from '../api/internal.js'
import { EventLog } from '../log/eventLog.js'
import { WikiService } from '../wiki/wikiService.js'

const binTsPath = fileURLToPath(new URL('./bin.ts', import.meta.url))

let osRoot: string
let log: EventLog
let wiki: WikiService
let app: ReturnType<typeof Fastify>
let daemonUrl: string
let client: Client

beforeEach(async () => {
  osRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bin-'))
  await fs.mkdir(path.join(osRoot, 'wiki'), { recursive: true })
  await fs.mkdir(path.join(osRoot, 'raw', 'techpulse', 'proposals'), {
    recursive: true,
  })
  log = new EventLog(path.join(osRoot, 'test.db'))
  wiki = new WikiService(osRoot, log)
  const run = log.createRun({
    routine: 'ingest',
    skill: 'ingest',
    agent: 'librarian',
  })
  log.createRunToken(run.id, 'tok-e2e')

  app = Fastify()
  registerInternalRoutes(app, {
    log,
    wiki,
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake satisfying the Scheduler interface
    scheduler: { scheduleOnce: () => 'sched-1' } as any,
    osRoot,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  daemonUrl = `http://127.0.0.1:${port}`

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', binTsPath],
    env: {
      AGENTOS_DAEMON_URL: daemonUrl,
      AGENTOS_RUN_ID: run.id,
      AGENTOS_RUN_TOKEN: 'tok-e2e',
    },
  })
  client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { capabilities: {} },
  )
  await client.connect(transport)
})

afterEach(async () => {
  await client.close()
  await app.close()
  log.close()
  await fs.rm(osRoot, { recursive: true, force: true })
})

describe('syscall/bin.ts stdio MCP server', () => {
  it('lists all 8 agentos tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'emit_event',
        'get_context',
        'read_inbox',
        'read_wiki',
        'remember',
        'request_approval',
        'schedule',
        'send_message',
      ].sort(),
    )
  })

  it('a remember tool call produces a real wiki page, index line, log line, and wiki.written event', async () => {
    const result = await client.callTool({
      name: 'remember',
      arguments: {
        page: 'projects/techpulse/proposals/001-slug.md',
        content: '# Proposal 001\n\nSummary of the raw proposal.',
        links: ['raw/techpulse/proposals/001-slug.md'],
        op: 'ingest',
      },
    })
    expect(result.isError).not.toBe(true)

    const page = await wiki.readPage('projects/techpulse/proposals/001-slug.md')
    expect(page).toContain('Summary of the raw proposal')

    const index = await wiki.readIndex()
    expect(index).toContain('](projects/techpulse/proposals/001-slug.md)')

    const logMd = await wiki.readLog()
    expect(logMd).toMatch(/ingest \| 001-slug/)

    expect(log.listEvents({ types: ['wiki.written'] })).toHaveLength(1)
  })
})
