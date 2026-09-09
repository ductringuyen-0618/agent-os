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
      // `agentos` is spread last so a routine's extra_mcp can never shadow
      // the daemon's own syscall server (e.g. an extra_mcp entry literally
      // named "agentos" replacing it, silently swapping out the run's
      // AGENTOS_RUN_TOKEN/DAEMON_URL for an attacker- or
      // misconfiguration-controlled command) — nothing in RoutineConfigSchema
      // stops a routines.yaml author from naming an extra_mcp key "agentos".
      ...(extra ?? {}),
      agentos: {
        command: process.execPath,
        args: [binPath],
        env: {
          AGENTOS_DAEMON_URL: daemonUrl,
          AGENTOS_RUN_ID: run.id,
          AGENTOS_RUN_TOKEN: runToken,
        },
      },
    },
  }
  const configPath = path.join(runDir, 'mcp.json')
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2), 'utf8')
  return configPath
}
