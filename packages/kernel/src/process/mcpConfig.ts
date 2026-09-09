import fs from 'node:fs/promises'
import path from 'node:path'
import type { RoutineConfig, Run } from '@agentos/shared'

export async function writeRunMcpConfig(
  runtimeDir: string,
  run: Run,
  daemonUrl: string,
  runToken: string,
  extra?: RoutineConfig['extra_mcp'],
): Promise<string> {
  const runDir = path.join(runtimeDir, 'runs', run.id)
  await fs.mkdir(runDir, { recursive: true })
  const binPath = path.resolve(import.meta.dirname, '..', 'syscall', 'bin.js')
  const mcpConfig = {
    mcpServers: {
      agentos: {
        command: process.execPath,
        args: [binPath],
        env: {
          AGENTOS_DAEMON_URL: daemonUrl,
          AGENTOS_RUN_ID: run.id,
          AGENTOS_RUN_TOKEN: runToken,
        },
      },
      ...(extra ?? {}),
    },
  }
  const configPath = path.join(runDir, 'mcp.json')
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2), 'utf8')
  return configPath
}
