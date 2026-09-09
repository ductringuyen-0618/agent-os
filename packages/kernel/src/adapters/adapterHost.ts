import type { Decision, ProjectConfig } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'
import type { ProjectAdapter, SyncResult } from './types.js'

/**
 * M1 stub: no project registry is wired up yet (packages/adapters, which
 * owns the real techpulse-coo adapter, is created in M4). loadProjects()
 * and applyDecision() are no-ops so createKernel() type-checks; M4
 * (docs/superpowers/plans/2026-09-08-agent-os-m4-techpulse-adapter.md)
 * replaces this file with real git/frontmatter logic.
 */
export class AdapterHost {
  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private wiki: WikiService,
    private registry: Record<string, ProjectAdapter>,
  ) {}

  async loadProjects(): Promise<ProjectConfig[]> {
    return []
  }

  async sync(projectName: string): Promise<SyncResult> {
    throw new Error(
      `AdapterHost.sync('${projectName}') is not implemented until M4`,
    )
  }

  async applyDecision(_decision: Decision): Promise<void> {
    return
  }
}
