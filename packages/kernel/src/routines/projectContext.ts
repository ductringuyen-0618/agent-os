import type { Decision, ProjectConfig, WorkflowInstance } from '@agentos/shared'

const OPEN_STATUSES = new Set(['queued', 'running', 'waiting', 'sleeping'])

export interface ProjectRoutineContext {
  project: string
  clone: string
  baseBranch: string
  /** Decisions for this project still waiting on a human. */
  pendingDecisions: number
  /** Feature requests for this project that have not finished. */
  openRequests: Array<{ id: string; title: string; status: string }>
  /** Titles already raised for this project, so an ideation run never repeats one. */
  recentTitles: string[]
}

/**
 * What a project-scoped routine (`routine.project`) is told about the
 * project on top of its own payload. Pure so it can be tested without a
 * kernel: the caller passes the decisions and workflows it already has.
 */
export function buildProjectContext(
  project: ProjectConfig,
  decisions: Decision[],
  workflows: WorkflowInstance[],
): ProjectRoutineContext {
  const mine = workflows.filter((w) => w.project === project.name)
  const myDecisions = decisions.filter((d) => d.project === project.name)
  const titles = new Set<string>()
  for (const w of mine) titles.add(w.title)
  for (const d of myDecisions) titles.add(d.title)
  return {
    project: project.name,
    clone: project.clone,
    baseBranch: project.base_branch,
    pendingDecisions: myDecisions.filter((d) => d.status === 'pending').length,
    openRequests: mine
      .filter((w) => OPEN_STATUSES.has(w.status))
      .map((w) => ({ id: w.id, title: w.title, status: w.status })),
    recentTitles: [...titles].slice(-40),
  }
}

/** True when the human still owes this project a decision or a build is in flight. */
export function projectHasIdeaInFlight(ctx: ProjectRoutineContext): boolean {
  return ctx.pendingDecisions > 0 || ctx.openRequests.length > 0
}
