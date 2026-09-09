import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectConfig } from '@agentos/shared'
import { stringify as stringifyYaml } from 'yaml'
import type { AdapterHost } from '../adapters/adapterHost.js'
import type { KernelConfig } from '../config.js'
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
}
