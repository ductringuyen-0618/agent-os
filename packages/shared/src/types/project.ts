import type { PermissionMode } from './routine.js'

export interface ProjectBuildConfig {
  enabled: boolean
  model: string
  permission_mode: PermissionMode
  allowed_tools: string[]
  checks: string[]
  timeout_ms: number
}

/**
 * Present while a project waits for its adapter to be set up in the repo
 * (a pull request adding the adapter's layout). `adapter` on the project
 * stays unset until `status` is `ready`.
 */
export interface ProjectSetup {
  /** Adapter that becomes active once the setup lands. */
  adapter: string
  branch: string
  status: 'pending' | 'ready'
  pr_url?: string
  pr_number?: number
  /** Why setup is incomplete, when the last attempt failed. */
  note?: string
}

export interface ProjectConfig {
  name: string
  /** Unset until the project's setup pull request is merged. */
  adapter?: string
  repo: string
  clone: string
  base_branch: string
  options: Record<string, unknown>
  build?: ProjectBuildConfig
  setup?: ProjectSetup
}
