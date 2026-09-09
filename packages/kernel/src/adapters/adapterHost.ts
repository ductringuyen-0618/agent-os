import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  type Decision,
  type ProjectConfig,
  ProjectConfigSchema,
} from '@agentos/shared'
import { parse as parseYaml } from 'yaml'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'
import type { AdapterContext, ProjectAdapter, SyncResult } from './types.js'

/**
 * Loads os/projects/*.yaml, dispatches sync()/applyDecision() to the
 * registered ProjectAdapter for each project's `adapter` type, and wraps
 * every call in a tracked Run (adapter:<projectName> for sync,
 * adapter:apply-decision for applyDecision).
 */
export class AdapterHost {
  private cachedProjects: ProjectConfig[] = []

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private wiki: WikiService,
    private registry: Record<string, ProjectAdapter>,
  ) {}

  private expand(value: string): string {
    const expanded = value
      .replaceAll('${AGENTOS_HOME}', this.cfg.osRoot)
      .replaceAll('${AGENTOS_CLONES}', path.join(this.cfg.runtimeDir, 'clones'))
    // Variable expansion mixes native separators (from path.join above) with
    // the '/' literals from the YAML source (on Windows: a backslash-joined
    // prefix followed by 'clones/techpulse'). Normalize once here, the single
    // point where path-valued fields are produced, so every caller gets a
    // platform-native path.
    return path.normalize(expanded)
  }

  async loadProjects(): Promise<ProjectConfig[]> {
    const dir = path.join(this.cfg.osRoot, 'projects')
    const files = await readdir(dir).catch(() => null)
    if (!files) {
      this.cachedProjects = []
      return []
    }
    const projects: ProjectConfig[] = []
    for (const file of files.filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
    )) {
      const raw = await readFile(path.join(dir, file), 'utf8')
      const parsed = parseYaml(raw) as Record<string, unknown>
      const expanded = {
        ...parsed,
        clone:
          typeof parsed.clone === 'string'
            ? this.expand(parsed.clone)
            : parsed.clone,
      }
      projects.push(ProjectConfigSchema.parse(expanded))
    }
    this.cachedProjects = projects
    return projects
  }

  /** Synchronous read of the last successfully loaded project list -- see this task's test file for why this exists. */
  getCachedProjects(): ProjectConfig[] {
    return this.cachedProjects
  }

  private getAdapter(project: ProjectConfig): ProjectAdapter {
    const adapter = this.registry[project.adapter]
    if (!adapter) {
      throw new Error(`no adapter registered for '${project.adapter}'`)
    }
    return adapter
  }

  async sync(projectName: string, runId?: string): Promise<SyncResult> {
    const projects = await this.loadProjects()
    const project = projects.find((p) => p.name === projectName)
    if (!project) throw new Error(`unknown project '${projectName}'`)
    const adapter = this.getAdapter(project)

    const ownRun = !runId
    const run = ownRun
      ? this.log.createRun({
          routine: `adapter:${projectName}`,
          adapter: project.adapter,
          payload: { action: 'sync', project: projectName },
        })
      : this.log.getRun(runId)
    if (ownRun && run) {
      this.log.updateRun(run.id, {
        status: 'running',
        startedAt: new Date().toISOString(),
      })
    }
    const activeRunId = run?.id ?? runId

    const ctx: AdapterContext = {
      cfg: this.cfg,
      log: this.log,
      wiki: this.wiki,
      project,
      runId: activeRunId,
    }
    try {
      const result = await adapter.sync(ctx)
      if (ownRun && run) {
        this.log.updateRun(run.id, {
          status: 'success',
          endedAt: new Date().toISOString(),
        })
      }
      return result
    } catch (err) {
      if (ownRun && run) {
        this.log.updateRun(run.id, {
          status: 'failed',
          endedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    }
  }

  async applyDecision(decision: Decision): Promise<void> {
    if (!decision.adapter) {
      throw new Error(`decision ${decision.id} has no adapter`)
    }
    const projects = await this.loadProjects()
    // Several projects can share one adapter type, so the decision's own
    // project wins; the adapter-only match is for rows created before
    // decisions recorded their project.
    const project = decision.project
      ? projects.find((p) => p.name === decision.project)
      : projects.find((p) => p.adapter === decision.adapter)
    if (!project) {
      throw new Error(
        decision.project
          ? `no project named '${decision.project}' is configured`
          : `no project configured for adapter '${decision.adapter}'`,
      )
    }
    if (project.adapter !== decision.adapter) {
      throw new Error(
        `decision ${decision.id} is for adapter '${decision.adapter}' but project '${project.name}' uses '${project.adapter}'`,
      )
    }
    const adapter = this.getAdapter(project)

    const run = this.log.createRun({
      routine: 'adapter:apply-decision',
      adapter: decision.adapter,
      payload: { decisionId: decision.id },
    })
    this.log.updateRun(run.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })
    const ctx: AdapterContext = {
      cfg: this.cfg,
      log: this.log,
      wiki: this.wiki,
      project,
      runId: run.id,
    }
    try {
      await adapter.applyDecision(decision, ctx)
      this.log.updateRun(run.id, {
        status: 'success',
        endedAt: new Date().toISOString(),
      })
    } catch (err) {
      this.log.updateRun(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
