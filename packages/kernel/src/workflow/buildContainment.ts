import path from 'node:path'
import type { ProjectConfig } from '@agentos/shared'

export interface AssertCloneCwdAllowedInput {
  cwd: string
  osRoot: string
  agent: string
  project?: ProjectConfig
}

export class CwdNotAllowedError extends Error {}

/**
 * Guards the one containment rule spec §5.3/§4.4 rely on: a spawned run's
 * cwd may only be outside its agent's normal `agents/<agent>/workspace`
 * when the workflow's project has `build.enabled: true`, and even then it
 * must be exactly that project's clone directory -- never an arbitrary
 * path. Wrapped by Task 5's `createFeatureRequestCwdPolicy`, which the
 * workflow engine calls as `WorkflowRuntimeDeps.cwdPolicy` before every
 * spawn where `spec.cwd` is set (W1, per team-lead ruling) -- this
 * function itself is engine-agnostic and has no dependency on that hook.
 */
export function assertCloneCwdAllowed(input: AssertCloneCwdAllowedInput): void {
  const workspace = path.resolve(
    input.osRoot,
    'agents',
    input.agent,
    'workspace',
  )
  const cwd = path.resolve(input.cwd)
  if (cwd === workspace) return

  if (!input.project?.build?.enabled) {
    const reason = input.project
      ? `project '${input.project.name}' does not have build.enabled: true`
      : 'no project was given'
    throw new CwdNotAllowedError(
      `cwd '${input.cwd}' is outside agents/${input.agent}/workspace and ${reason}`,
    )
  }
  const clone = path.resolve(input.project.clone)
  if (cwd !== clone) {
    throw new CwdNotAllowedError(
      `cwd '${input.cwd}' must be exactly project '${input.project.name}''s ` +
        `clone directory ('${input.project.clone}') when build.enabled is true`,
    )
  }
}
