// M1 subset only (health + runs routes). Later milestones append more
// entries here for decisions/routines/wiki/skills/agents/costs/projects/
// syscall as their routes land — see "Contract additions" in
// docs/superpowers/plans/2026-09-08-agent-os-m1-kernel-core.md.
import type { ProjectConfig } from './project.js'
import type { Run } from './run.js'
import type { RunStatus } from './run.js'

export interface HealthResponse {
  ok: true
  version: string
}

export interface ErrorResponse {
  error: string
}

export interface ListRunsQuery {
  status?: RunStatus
  routine?: string
  limit?: number
}

export interface ListRunEventsQuery {
  sinceId?: number
}

export interface CreateRunRequest {
  skill: string
  agent?: string
  payload?: Record<string, unknown>
}

export interface CreateRunResponse {
  runId: string
}

export interface KillRunResponse {
  ok: boolean
}

// SyncResult itself stays owned by @agentos/kernel/adapters/types per the
// 00-contract. Importing it here would create a cross-package dependency
// the wrong direction (kernel already depends on shared), so this is a
// local structural copy — the wire-shape twin, exactly like `RoutineListItem`
// already duplicates across `dashboard/src/api/client.ts` and
// `cli/src/client.ts` today. This plan follows that existing precedent
// rather than introducing a new one.
export interface SyncResultShape {
  added: string[]
  changed: string[]
  events: string[]
  hasCooLayout?: boolean
}

export interface GithubUnavailableResponse {
  error: string
  hint: string
}

export interface ProjectListItem {
  config: ProjectConfig
  routines: string[]
  lastSync?: Run
  hasCooLayout: boolean
}

export interface AddProjectRequest {
  repo: string
  name?: string
  adapter?: string
  base_branch?: string
  build?: boolean
}

export interface AddProjectResponse {
  project: ProjectConfig
  sync: SyncResultShape
  syncError?: string
}
