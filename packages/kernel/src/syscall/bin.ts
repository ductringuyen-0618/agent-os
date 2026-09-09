import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { SyscallToolDefs } from './tools.js'

const daemonUrl = process.env.AGENTOS_DAEMON_URL
const runId = process.env.AGENTOS_RUN_ID
const runToken = process.env.AGENTOS_RUN_TOKEN

if (!daemonUrl || !runId || !runToken) {
  console.error(
    'agentos syscall bin: missing AGENTOS_DAEMON_URL/AGENTOS_RUN_ID/AGENTOS_RUN_TOKEN',
  )
  process.exit(1)
}

const server = new Server(
  { name: 'agentos', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(SyscallToolDefs).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.mcpInputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const res = await fetch(`${daemonUrl}/internal/syscall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Run-Token': runToken },
    body: JSON.stringify({ tool: name, args: args ?? {} }),
  })
  const json = await res
    .json()
    .catch(() => ({ error: 'invalid JSON response from daemon' }))
  if (!res.ok) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(json) }],
      isError: true,
    }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(json) }] }
})

const transport = new StdioServerTransport()
await server.connect(transport)
