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

export function loadKernelConfig(
  osRoot: string,
  overrides: Partial<KernelConfig> = {},
): KernelConfig {
  const resolvedOsRoot = path.resolve(osRoot)
  const runtimeDir =
    overrides.runtimeDir ?? path.resolve(resolvedOsRoot, '..', '.agentos')
  const dbPath = overrides.dbPath ?? path.join(runtimeDir, 'agentos.db')
  const port =
    overrides.port ??
    (process.env.AGENTOS_PORT ? Number(process.env.AGENTOS_PORT) : 4545)
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
