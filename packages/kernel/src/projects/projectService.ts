import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ProjectConfig,
  ProjectListItem,
  RoutineConfig,
  RoutinesFile,
} from '@agentos/shared'
import { parseRoutinesFile } from '@agentos/shared'
import { stringify as stringifyYaml } from 'yaml'
import type { AdapterHost } from '../adapters/adapterHost.js'
import type { SyncResult } from '../adapters/types.js'
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
  adapter?: string
  baseBranch?: string
  build?: boolean
}

export interface AddProjectResult {
  project: ProjectConfig
  sync: SyncResult
  syncError?: string
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
 * Happy-path skeleton only: name derivation and the yaml writer. `addProject`
 * (routine wiring, build-checks inference, first sync) lands in a later task
 * on top of this class -- do not treat this file as finished.
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
    await writeFile(
      path.join(dir, `${project.name}.yaml`),
      stringifyYaml(project),
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

  async addProject(input: AddProjectInput): Promise<AddProjectResult> {
    assertValidRepoName(input.repo)
    const adapter = input.adapter ?? 'techpulse-coo'
    const name = input.name ?? deriveProjectName(input.repo)

    const existing = await this.adapters.loadProjects()
    if (existing.some((p) => p.name === name)) {
      throw new ProjectNameCollisionError(name)
    }

    const baseBranch = input.baseBranch ?? (await getDefaultBranch(input.repo))
    const cloneUrl = await getCloneUrl(input.repo)

    const options =
      adapter === 'techpulse-coo'
        ? {
            proposals_path: 'docs/missions/coo/proposals',
            state_path: 'docs/missions/coo/state.md',
            reports_path: 'docs/missions/coo/reports',
          }
        : {}

    const project: ProjectConfig = {
      name,
      adapter,
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
    }

    await this.writeProjectYaml(project)

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

    try {
      const sync = await this.adapters.sync(name)
      return { project, sync }
    } catch (err) {
      return {
        project,
        sync: { added: [], changed: [], events: [] },
        syncError: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async listProjects(): Promise<ProjectListItem[]> {
    const projects = await this.adapters.loadProjects()
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
