import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ProjectConfig,
  ProjectListItem,
  ProjectSetupOutcome,
  RoutineConfig,
  RoutinesFile,
} from '@agentos/shared'
import { parseRoutinesFile } from '@agentos/shared'
import { stringify as stringifyYaml } from 'yaml'
import type { AdapterHost } from '../adapters/adapterHost.js'
import type { ProjectSetupResult, SyncResult } from '../adapters/types.js'
import type { KernelConfig } from '../config.js'
import {
  assertValidRepoName,
  getCloneUrl,
  getDefaultBranch,
  readRepoFile,
} from '../github/gh.js'
import type { EventLog } from '../log/eventLog.js'
import type { Scheduler } from '../scheduler/scheduler.js'

export class ProjectNameCollisionError extends Error {
  constructor(name: string) {
    super(`project '${name}' already exists`)
  }
}

export class ProjectNotFoundError extends Error {
  constructor(name: string) {
    super(`unknown project '${name}'`)
  }
}

export function deriveProjectName(repo: string): string {
  const segment = repo.split('/').pop() ?? repo
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

export interface AddProjectInput {
  repo: string
  name?: string
  /** Names an adapter to activate immediately, skipping the setup pull request. */
  adapter?: string
  baseBranch?: string
  build?: boolean
}

export interface AddProjectResult {
  project: ProjectConfig
  sync: SyncResult
  syncError?: string
  /** Present when the adapter is being set up through a pull request. */
  setup?: ProjectSetupOutcome
}

const EMPTY_SYNC: SyncResult = { added: [], changed: [], events: [] }

/** The adapter a new project gets unless the caller names one. */
export const DEFAULT_ADAPTER = 'coo-missions'
/** The same adapter under the name it was born with. */
const LEGACY_ADAPTER = 'techpulse-coo'
const SETUP_BRANCH = 'agentos/coo-setup'

const COO_OPTIONS = {
  proposals_path: 'docs/missions/coo/proposals',
  state_path: 'docs/missions/coo/state.md',
  reports_path: 'docs/missions/coo/reports',
}

async function pathExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false)
}

const DEFAULT_CHECKS = [
  'pnpm -r --if-present typecheck',
  'pnpm -r --if-present lint',
  'pnpm -r --if-present test',
]

/**
 * Probes the repo (via the Task 3 gh.ts helpers) for a recognizable build
 * tool and returns the checks to run for it, falling back to DEFAULT_CHECKS
 * when nothing recognizable is found. Order: package.json scripts,
 * pyproject.toml (ruff+pytest), Makefile targets.
 */
async function inferBuildChecks(repo: string): Promise<string[]> {
  const pkgRaw = await readRepoFile(repo, 'package.json')
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> }
      const checks = ['typecheck', 'lint', 'test']
        .filter((s) => pkg.scripts?.[s])
        .map((s) => `pnpm -r --if-present ${s}`)
      if (checks.length > 0) return checks
    } catch {
      // fall through to the next probe on unparseable package.json
    }
  }
  const pyproject = await readRepoFile(repo, 'pyproject.toml')
  if (pyproject) return ['ruff check .', 'pytest']
  const makefile = await readRepoFile(repo, 'Makefile')
  if (makefile) {
    const targets = [...makefile.matchAll(/^([a-zA-Z][\w-]*):/gm)].map(
      (m) => m[1],
    )
    const checks = ['typecheck', 'lint', 'test']
      .filter((t) => targets.includes(t))
      .map((t) => `make ${t}`)
    if (checks.length > 0) return checks
  }
  return DEFAULT_CHECKS
}

/**
 * Projects live as os/projects/<name>.yaml. A new project starts without an
 * adapter: the adapter's setup pull request has to land in the repo first
 * (see addProject / runSetup). Adapters with no setup needs, and an adapter
 * the caller names explicitly, activate on add as they always did.
 */
export class ProjectService {
  constructor(
    private cfg: KernelConfig,
    private adapters: AdapterHost,
    private scheduler: Scheduler,
    private log: EventLog,
  ) {}

  async writeProjectYaml(project: ProjectConfig): Promise<void> {
    const dir = path.join(this.cfg.osRoot, 'projects')
    await mkdir(dir, { recursive: true })
    // yaml's stringify writes `key: null` for undefined-valued keys we
    // clear (setup.note); drop them so the file stays tidy.
    const clean = JSON.parse(JSON.stringify(project)) as ProjectConfig
    await writeFile(
      path.join(dir, `${project.name}.yaml`),
      stringifyYaml(clean),
      'utf8',
    )
  }

  private async loadRoutinesFile(): Promise<{
    file: RoutinesFile
    path: string
  }> {
    const p = path.join(this.cfg.osRoot, 'routines.yaml')
    const text = await readFile(p, 'utf8')
    return { file: parseRoutinesFile(text), path: p }
  }

  private async saveRoutinesFile(
    file: RoutinesFile,
    filePath: string,
  ): Promise<void> {
    await writeFile(filePath, stringifyYaml(file), 'utf8')
  }

  private resolveAdapterName(requested?: string): string {
    if (requested) return requested
    if (this.adapters.getRegistered(DEFAULT_ADAPTER)) return DEFAULT_ADAPTER
    if (this.adapters.getRegistered(LEGACY_ADAPTER)) return LEGACY_ADAPTER
    return DEFAULT_ADAPTER
  }

  private async ensureSyncRoutine(name: string): Promise<void> {
    const routineName = `${name}-sync`
    const { file: routinesFile, path: routinesPath } =
      await this.loadRoutinesFile()
    const existingRoutine = routinesFile.routines.find(
      (r) => r.name === routineName,
    )
    if (!existingRoutine) {
      const routine: RoutineConfig = {
        name: routineName,
        every: '1h',
        adapter: name,
      }
      routinesFile.routines.push(routine)
      await this.saveRoutinesFile(routinesFile, routinesPath)
      this.scheduler.registerRoutine(routine)
    } else {
      this.scheduler.registerRoutine(existingRoutine)
    }
  }

  private async firstSync(
    name: string,
  ): Promise<Pick<AddProjectResult, 'sync' | 'syncError'>> {
    try {
      return { sync: await this.adapters.sync(name) }
    } catch (err) {
      return {
        sync: EMPTY_SYNC,
        syncError: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async requireProject(name: string): Promise<ProjectConfig> {
    const projects = await this.adapters.loadProjects()
    const project = projects.find((p) => p.name === name)
    if (!project) throw new ProjectNotFoundError(name)
    return project
  }

  async addProject(input: AddProjectInput): Promise<AddProjectResult> {
    assertValidRepoName(input.repo)
    const adapterName = this.resolveAdapterName(input.adapter)
    const name = input.name ?? deriveProjectName(input.repo)

    const existing = await this.adapters.loadProjects()
    if (existing.some((p) => p.name === name)) {
      throw new ProjectNameCollisionError(name)
    }

    const baseBranch = input.baseBranch ?? (await getDefaultBranch(input.repo))
    const cloneUrl = await getCloneUrl(input.repo)
    const adapter = this.adapters.getRegistered(adapterName)
    // An explicitly named adapter is the caller taking responsibility for
    // the repo already being set up; only the default path goes via a PR.
    const needsSetup = adapter?.setup !== undefined && !input.adapter

    const options =
      adapter?.setup?.defaultOptions ??
      (adapterName === DEFAULT_ADAPTER || adapterName === LEGACY_ADAPTER
        ? COO_OPTIONS
        : {})

    const project: ProjectConfig = {
      name,
      ...(needsSetup ? {} : { adapter: adapterName }),
      repo: cloneUrl,
      clone: `\${AGENTOS_CLONES}/${name}`,
      base_branch: baseBranch,
      options,
      ...(input.build
        ? {
            build: {
              enabled: true,
              model: 'sonnet',
              permission_mode: 'acceptEdits' as const,
              allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
              checks: await inferBuildChecks(input.repo),
              timeout_ms: 2_400_000,
            },
          }
        : {}),
      ...(needsSetup
        ? {
            setup: {
              adapter: adapterName,
              branch: SETUP_BRANCH,
              status: 'pending' as const,
            },
          }
        : {}),
    }

    await this.writeProjectYaml(project)

    if (!needsSetup) {
      await this.ensureSyncRoutine(name)
      return { project, ...(await this.firstSync(name)) }
    }

    const setup = await this.runSetup(name)
    const current = await this.requireProject(name)
    if (setup.status === 'ready') {
      return { project: current, ...(await this.firstSync(name)), setup }
    }
    return { project: current, sync: EMPTY_SYNC, setup }
  }

  /**
   * Moves a pending project along: activates the adapter when the repo
   * already carries what it needs (the setup PR was merged), otherwise
   * opens the setup PR if none is recorded yet. Safe to call repeatedly.
   */
  async runSetup(name: string): Promise<ProjectSetupOutcome> {
    const project = await this.requireProject(name)
    if (project.adapter) return this.completeSetup(project)
    const pending = project.setup
    if (!pending) throw new Error(`project '${name}' has no setup state`)
    const adapter = this.adapters.getRegistered(pending.adapter)
    if (!adapter?.setup) {
      throw new Error(`adapter '${pending.adapter}' has no setup routine`)
    }
    const ctx = this.adapters.contextFor(project)

    try {
      if (await adapter.setup.isReady(ctx)) {
        await this.finishSetup(project)
        return {
          status: 'ready',
          prUrl: pending.pr_url,
          prNumber: pending.pr_number,
        }
      }
      let result: ProjectSetupResult | undefined
      if (!pending.pr_url) {
        result = await adapter.setup.openSetupPr(ctx)
        if (result.applied) {
          await this.finishSetup(project)
          return {
            status: 'ready',
            skipped:
              'layout committed directly: the remote has no pull request host',
          }
        }
        if (result.skipped && !result.url) {
          await this.finishSetup(project)
          return { status: 'ready', skipped: result.skipped }
        }
      }
      const prUrl = result?.url ?? pending.pr_url
      const prNumber = result?.number ?? pending.pr_number
      await this.writeProjectYaml({
        ...project,
        setup: {
          adapter: pending.adapter,
          branch: pending.branch,
          status: 'pending',
          pr_url: prUrl,
          pr_number: prNumber,
        },
      })
      return { status: 'pending', prUrl, prNumber }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.writeProjectYaml({
        ...project,
        setup: { ...pending, status: 'pending', note: message },
      })
      return {
        status: 'pending',
        prUrl: pending.pr_url,
        prNumber: pending.pr_number,
        error: message,
      }
    }
  }

  /**
   * A project that already has its adapter can still be missing part of
   * the layout (projects connected before setup PRs existed, or a repo
   * that lost a file). Open the PR for whatever is missing; record it.
   */
  private async completeSetup(
    project: ProjectConfig,
  ): Promise<ProjectSetupOutcome> {
    const adapterName = project.adapter as string
    const adapter = this.adapters.getRegistered(adapterName)
    if (!adapter?.setup) return { status: 'ready' }
    const result = await adapter.setup.openSetupPr(
      this.adapters.contextFor(project),
    )
    if (!result.url) {
      return {
        status: 'ready',
        skipped:
          result.skipped ??
          'layout committed directly: the remote has no pull request host',
      }
    }
    await this.writeProjectYaml({
      ...project,
      setup: {
        adapter: adapterName,
        branch: project.setup?.branch ?? SETUP_BRANCH,
        status: 'ready',
        pr_url: result.url,
        pr_number: result.number,
      },
    })
    return { status: 'ready', prUrl: result.url, prNumber: result.number }
  }

  /** Activates the adapter: writes it into the yaml and registers the sync routine. */
  private async finishSetup(project: ProjectConfig): Promise<void> {
    const pending = project.setup
    if (!pending) return
    const adapter = this.adapters.getRegistered(pending.adapter)
    await this.writeProjectYaml({
      ...project,
      adapter: pending.adapter,
      options:
        Object.keys(project.options).length > 0
          ? project.options
          : (adapter?.setup?.defaultOptions ?? {}),
      setup: {
        adapter: pending.adapter,
        branch: pending.branch,
        status: 'ready',
        pr_url: pending.pr_url,
        pr_number: pending.pr_number,
      },
    })
    await this.adapters.loadProjects()
    await this.ensureSyncRoutine(project.name)
    this.log.append({
      type: 'project.ready',
      payload: { project: project.name, adapter: pending.adapter },
    })
  }

  /**
   * Pending projects with an open setup PR are re-checked on every list so
   * a merged PR activates the adapter without anyone pressing a button.
   * A failed check lands on the project (setup.note), never on the list.
   */
  private async settlePending(
    projects: ProjectConfig[],
  ): Promise<ProjectConfig[]> {
    const pending = projects.filter((p) => !p.adapter && p.setup?.pr_url)
    if (pending.length === 0) return projects
    for (const p of pending) {
      await this.runSetup(p.name).catch(() => undefined)
    }
    return this.adapters.loadProjects()
  }

  async listProjects(): Promise<ProjectListItem[]> {
    const projects = await this.settlePending(
      await this.adapters.loadProjects(),
    )
    const registered = new Set(this.scheduler.list().map((l) => l.routine.name))
    return Promise.all(
      projects.map(async (config) => {
        const routineName = `${config.name}-sync`
        const routines = registered.has(routineName) ? [routineName] : []
        const lastSync = this.log.listRuns({
          routine: `adapter:${config.name}`,
          limit: 1,
        })[0]
        const proposalsPath = config.options.proposals_path
        const hasCooLayout =
          typeof proposalsPath === 'string'
            ? await pathExists(path.join(config.clone, proposalsPath))
            : true
        return { config, routines, lastSync, hasCooLayout }
      }),
    )
  }

  async removeProject(name: string): Promise<void> {
    const projects = await this.adapters.loadProjects()
    const project = projects.find((p) => p.name === name)
    if (!project) throw new ProjectNotFoundError(name)

    await rm(path.join(this.cfg.osRoot, 'projects', `${name}.yaml`))

    const routineName = `${name}-sync`
    const { file: routinesFile, path: routinesPath } =
      await this.loadRoutinesFile()
    routinesFile.routines = routinesFile.routines.filter(
      (r) => r.name !== routineName,
    )
    await this.saveRoutinesFile(routinesFile, routinesPath)
    this.scheduler.unregisterRoutine(routineName)
    // clone/ and raw/<name>/ deliberately untouched -- spec §4.2
  }
}
