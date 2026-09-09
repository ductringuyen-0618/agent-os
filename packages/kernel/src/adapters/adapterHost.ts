import type { Decision, ProjectConfig } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'
import type { ProjectAdapter, SyncResult } from './types.js'

/**
 * M3 stub: no project registry is wired up yet (packages/adapters, which
 * owns the real techpulse-coo adapter, is created in M4). loadProjects()
 * is a no-op, sync() on an unregistered project logs ops.alert and returns
 * an empty SyncResult instead of throwing (so callers like the Scheduler
 * can call kernel.adapters.sync() safely before M4), and applyDecision()
 * throws until M4 implements it. M4
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

  async sync(projectName: string, _runId?: string): Promise<SyncResult> {
    const adapter = this.registry[projectName]
    if (!adapter) {
      this.log.append({
        type: 'ops.alert',
        payload: { reason: 'adapter-not-implemented', projectName },
      })
      return { added: [], changed: [], events: [] }
    }
    // Real ctx construction + adapter.sync() call lands in M4 alongside
    // projects/*.yaml loading.
    return { added: [], changed: [], events: [] }
  }

  async applyDecision(_decision: Decision): Promise<void> {
    throw new Error('AdapterHost.applyDecision is implemented in M4')
  }
}
