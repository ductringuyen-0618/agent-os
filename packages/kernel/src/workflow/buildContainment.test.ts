import path from 'node:path'
import type { ProjectConfig } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import {
  CwdNotAllowedError,
  assertCloneCwdAllowed,
} from './buildContainment.js'

const osRoot = path.join('fake', 'os')
const workspace = path.join(osRoot, 'agents', 'ops', 'workspace')
const clone = path.join('fake', 'clones', 'techpulse')

const buildEnabledProject: ProjectConfig = {
  name: 'techpulse',
  adapter: 'techpulse-coo',
  repo: 'owner/techpulse',
  clone,
  base_branch: 'main',
  options: {},
  build: {
    enabled: true,
    model: 'sonnet',
    permission_mode: 'acceptEdits',
    allowed_tools: ['Bash'],
    checks: [],
    timeout_ms: 60_000,
  },
}

describe('assertCloneCwdAllowed', () => {
  it('allows the default agent workspace cwd regardless of project', () => {
    expect(() =>
      assertCloneCwdAllowed({ cwd: workspace, osRoot, agent: 'ops' }),
    ).not.toThrow()
  })

  it('rejects a non-workspace cwd with no project given', () => {
    expect(() =>
      assertCloneCwdAllowed({ cwd: clone, osRoot, agent: 'ops' }),
    ).toThrow(CwdNotAllowedError)
  })

  it('rejects a non-workspace cwd when the project has no build config', () => {
    const project: ProjectConfig = { ...buildEnabledProject, build: undefined }
    expect(() =>
      assertCloneCwdAllowed({ cwd: clone, osRoot, agent: 'ops', project }),
    ).toThrow(/build.enabled/)
  })

  it('rejects a non-workspace cwd when build.enabled is false', () => {
    const project: ProjectConfig = {
      ...buildEnabledProject,
      // biome-ignore lint/style/noNonNullAssertion: buildEnabledProject.build is always set
      build: { ...buildEnabledProject.build!, enabled: false },
    }
    expect(() =>
      assertCloneCwdAllowed({ cwd: clone, osRoot, agent: 'ops', project }),
    ).toThrow(CwdNotAllowedError)
  })

  it('rejects a cwd that is neither the workspace nor exactly the clone, even with build.enabled', () => {
    expect(() =>
      assertCloneCwdAllowed({
        cwd: path.join('fake', 'somewhere', 'else'),
        osRoot,
        agent: 'ops',
        project: buildEnabledProject,
      }),
    ).toThrow(/must be exactly/)
  })

  it('allows cwd === project.clone when build.enabled is true', () => {
    expect(() =>
      assertCloneCwdAllowed({
        cwd: clone,
        osRoot,
        agent: 'ops',
        project: buildEnabledProject,
      }),
    ).not.toThrow()
  })
})
