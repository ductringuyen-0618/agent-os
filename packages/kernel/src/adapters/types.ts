import type { Decision, EventType, ProjectConfig } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'

export interface AdapterContext {
  cfg: KernelConfig
  log: EventLog
  wiki: WikiService
  project: ProjectConfig
  runId?: string
}

export interface SyncResult {
  added: string[]
  changed: string[]
  events: EventType[]
  hasCooLayout?: boolean
}

export interface ProjectAdapter {
  name: string
  sync(ctx: AdapterContext): Promise<SyncResult>
  applyDecision(decision: Decision, ctx: AdapterContext): Promise<void>
}
