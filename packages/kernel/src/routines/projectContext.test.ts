import type { Decision, ProjectConfig, WorkflowInstance } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import {
  buildProjectContext,
  projectHasIdeaInFlight,
} from './projectContext.js'

const project: ProjectConfig = {
  name: 'techpulse',
  adapter: 'coo-missions',
  repo: 'https://github.com/o/r.git',
  clone: '/clones/techpulse',
  base_branch: 'main',
  options: {},
}

function wf(
  id: string,
  title: string,
  status: WorkflowInstance['status'],
  projectName = 'techpulse',
): WorkflowInstance {
  return {
    id,
    kind: 'feature-request',
    status,
    project: projectName,
    title,
    input: {},
    state: {},
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
  }
}

function decision(
  id: string,
  title: string,
  status: Decision['status'],
  projectName = 'techpulse',
): Decision {
  return {
    id,
    title,
    body: '',
    status,
    project: projectName,
    createdAt: '2026-09-10T00:00:00Z',
  }
}

describe('buildProjectContext', () => {
  it("counts only this project's pending decisions and unfinished requests", () => {
    const ctx = buildProjectContext(
      project,
      [
        decision('d1', 'Alerts', 'pending'),
        decision('d2', 'Old idea', 'approved'),
        decision('d3', 'Other project', 'pending', 'salon-hub'),
      ],
      [
        wf('w1', 'Alerts', 'waiting'),
        wf('w2', 'Shipped thing', 'succeeded'),
        wf('w3', 'Elsewhere', 'running', 'salon-hub'),
      ],
    )
    expect(ctx.project).toBe('techpulse')
    expect(ctx.clone).toBe('/clones/techpulse')
    expect(ctx.pendingDecisions).toBe(1)
    expect(ctx.openRequests).toEqual([
      { id: 'w1', title: 'Alerts', status: 'waiting' },
    ])
    expect(ctx.recentTitles.sort()).toEqual([
      'Alerts',
      'Old idea',
      'Shipped thing',
    ])
    expect(projectHasIdeaInFlight(ctx)).toBe(true)
  })

  it('reports nothing in flight when every request finished and no decision waits', () => {
    const ctx = buildProjectContext(
      project,
      [decision('d2', 'Old idea', 'rejected')],
      [wf('w2', 'Shipped thing', 'succeeded'), wf('w4', 'Dead', 'failed')],
    )
    expect(ctx.pendingDecisions).toBe(0)
    expect(ctx.openRequests).toEqual([])
    expect(projectHasIdeaInFlight(ctx)).toBe(false)
  })
})
