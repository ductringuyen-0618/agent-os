import path from 'node:path'

export interface KernelConfig {
  osRoot: string
  runtimeDir: string
  dbPath: string
  claudeBin: string
  host: '127.0.0.1'
  port: number
  authToken?: string
  logLevel: 'info' | 'debug'
}

const DEFAULT_PORT = 4545

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT
  if (!/^\d+$/.test(value)) return DEFAULT_PORT
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535)
    return DEFAULT_PORT
  return parsed
}

export function loadKernelConfig(
  osRoot: string,
  overrides: Partial<KernelConfig> = {},
): KernelConfig {
  const resolvedOsRoot = path.resolve(osRoot)
  const runtimeDir =
    overrides.runtimeDir ?? path.resolve(resolvedOsRoot, '..', '.agentos')
  const dbPath = overrides.dbPath ?? path.join(runtimeDir, 'agentos.db')
  const port = overrides.port ?? parsePort(process.env.AGENTOS_PORT)
  const claudeBin =
    overrides.claudeBin ?? process.env.AGENTOS_CLAUDE_BIN ?? 'claude'
  const authToken = overrides.authToken ?? process.env.AGENTOS_TOKEN
  const logLevel = overrides.logLevel ?? 'info'

  return {
    osRoot: resolvedOsRoot,
    runtimeDir,
    dbPath,
    claudeBin,
    host: '127.0.0.1',
    port,
    authToken,
    logLevel,
  }
}
