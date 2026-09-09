import type { PermissionMode } from './routine.js'

export interface ProjectBuildConfig {
  enabled: boolean
  model: string
  permission_mode: PermissionMode
  allowed_tools: string[]
  checks: string[]
  timeout_ms: number
}

export interface ProjectConfig {
  name: string
  adapter: string
  repo: string
  clone: string
  base_branch: string
  options: Record<string, unknown>
  build?: ProjectBuildConfig
}
