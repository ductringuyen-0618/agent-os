import type {
  Decision,
  Event,
  GithubRepo,
  Message,
  ProjectConfig,
  ProjectListItem,
  RoutineConfig,
  Run,
  SkillMeta,
  WikiPageMeta,
  WorkflowInstance,
  WorkflowStep,
} from '@agentos/shared'
import { vi } from 'vitest'

export const fixtures = {
  run: {
    id: 'run_1',
    routine: 'heartbeat',
    status: 'success',
    attempt: 1,
  } satisfies Run,
  events: [
    {
      id: 1,
      ts: '2026-09-08T00:00:00Z',
      type: 'run.started',
      runId: 'run_1',
      payload: {},
    },
  ] satisfies Event[],
  decision: {
    id: 'dec_1',
    title: 'Approve proposal',
    body: '# Proposal\nDo the thing.',
    status: 'pending',
    createdAt: '2026-09-08T00:00:00Z',
  } satisfies Decision,
  routine: { name: 'heartbeat', every: '30m' } satisfies RoutineConfig,
  skill: {
    name: 'heartbeat',
    path: 'skills/heartbeat',
    hasLearnings: true,
    description: 'Cheap, frequent pulse-check across the OS.',
    routines: ['heartbeat'],
    runs: 10,
    succeeded: 9,
    lastRunAt: '2026-09-08T00:00:00Z',
    lastStatus: 'success',
    costUsd: 1.2,
    lastScore: 0.92,
  } satisfies SkillMeta,
  wikiPages: [
    {
      path: 'projects/techpulse/overview.md',
      title: 'overview',
      type: 'ingest',
      updated: '2026-09-08T00:00:00Z',
      sources: ['raw/techpulse/state.md'],
      bytes: 1200,
    },
    {
      path: 'concepts/remember-syscall-limitations.md',
      title: 'remember-syscall-limitations',
      type: 'note',
      updated: '2026-09-07T00:00:00Z',
      sources: [],
      bytes: 400,
    },
  ] satisfies WikiPageMeta[],
  message: {
    id: 'msg_1',
    from: 'ops',
    to: 'librarian',
    body: 'wiki looks stale, can you re-sync?',
    ts: '2026-09-08T00:00:00Z',
  } satisfies Message,
  githubRepos: [
    {
      nameWithOwner: 'octo/widgets',
      description: 'Widget factory',
      defaultBranch: 'main',
      isPrivate: false,
      updatedAt: '2026-09-01T00:00:00Z',
    },
  ] satisfies GithubRepo[],
  projectListItem: {
    config: {
      name: 'techpulse',
      adapter: 'techpulse-coo',
      repo: 'octo/techpulse',
      clone: '/clones/techpulse',
      base_branch: 'main',
      options: {},
    },
    routines: ['techpulse-sync'],
    hasCooLayout: true,
  } satisfies ProjectListItem,
  pendingProjectListItem: {
    config: {
      name: 'widgets',
      repo: 'https://github.com/octo/widgets.git',
      clone: '/clones/widgets',
      base_branch: 'main',
      options: {},
      setup: {
        adapter: 'coo-missions',
        branch: 'agentos/coo-setup',
        status: 'pending',
        pr_url: 'https://github.com/octo/widgets/pull/7',
        pr_number: 7,
      },
    },
    routines: [],
    hasCooLayout: false,
  } satisfies ProjectListItem,
  workflow: {
    id: 'wf_1',
    kind: 'feature-request',
    status: 'running',
    project: 'techpulse',
    title: 'Add a personalized company digest',
    input: {
      project: 'techpulse',
      title: 'Add a personalized company digest',
      description: 'Summarize the week per company the user follows.',
      autoApprove: true,
    },
    state: { brief: { costUsd: 0.08 } },
    currentStep: 'build',
    createdAt: '2026-09-08T00:00:00Z',
    startedAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:05:00Z',
  } satisfies WorkflowInstance,
  workflowSteps: [
    {
      id: 'wfs_1',
      workflowId: 'wf_1',
      name: 'brief',
      seq: 1,
      status: 'succeeded',
      attempt: 1,
      output: { costUsd: 0.08 },
      startedAt: '2026-09-08T00:00:00Z',
      endedAt: '2026-09-08T00:01:00Z',
    },
    {
      id: 'wfs_2',
      workflowId: 'wf_1',
      name: 'build',
      seq: 2,
      status: 'running',
      attempt: 1,
      runId: 'run_1',
      startedAt: '2026-09-08T00:01:00Z',
    },
  ] satisfies WorkflowStep[],
  project: {
    name: 'techpulse',
    adapter: 'techpulse-coo',
    repo: 'ductringuyen-0618/techpulse',
    clone: '/clones/techpulse',
    base_branch: 'main',
    options: {},
  } satisfies ProjectConfig,
}

type Handler = (url: URL, init?: RequestInit) => unknown

export function installMockFetch(overrides: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/health': () => ({ ok: true, version: '0.1.0' }),
    'GET /api/runs': () => [fixtures.run],
    'GET /api/runs/run_1': () => fixtures.run,
    'GET /api/runs/run_1/events': () => fixtures.events,
    'POST /api/runs/run_1/kill': () => ({ ok: true }),
    'GET /api/decisions': () => [fixtures.decision],
    'POST /api/decisions/dec_1/approve': () => ({
      ...fixtures.decision,
      status: 'approved',
    }),
    'POST /api/decisions/dec_1/reject': () => ({
      ...fixtures.decision,
      status: 'rejected',
    }),
    'GET /api/routines': () => [
      { routine: fixtures.routine, nextRun: '2026-09-08T01:00:00Z' },
    ],
    'POST /api/routines/heartbeat/run': () => ({ runId: 'run_2' }),
    'POST /api/routines/heartbeat/enable': () => ({ ok: true }),
    'POST /api/routines/heartbeat/disable': () => ({ ok: true }),
    'GET /api/wiki/index': () => ({ content: '# Index' }),
    'GET /api/wiki/pages': () => fixtures.wikiPages,
    'GET /api/wiki/log': () => ({ content: '## [2026-09-08] note | Hello' }),
    'GET /api/wiki/page': () => ({
      content: '# Page\nSee [[projects/techpulse]].',
    }),
    'GET /api/skills': () => [fixtures.skill],
    'GET /api/skills/heartbeat': () => ({
      skillMd: '# skill\n\nCheap, frequent pulse-check across the OS.',
      learningsMd: '- 2026-09-08: routines.yaml is the source of truth',
      eval: {
        criteria: [
          { key: 'accuracy', weight: 0.6, description: 'Facts check out.' },
          { key: 'concise', weight: 0.4, description: 'No filler.' },
        ],
      },
      lastOutputMd: '# output',
      scoreHistory: [
        { ts: '2026-09-07T00:00:00Z', runId: 'run_0', score: 0.8 },
        { ts: '2026-09-08T00:00:00Z', runId: 'run_1', score: 0.92 },
      ],
    }),
    'GET /api/agents': () => [{ name: 'ops', status: 'idle' }],
    'GET /api/costs': () => [
      { day: '2026-09-08', agent: 'ops', costUsd: 0.42 },
    ],
    'GET /api/messages': () => [fixtures.message],
    'GET /api/github/repos': () => fixtures.githubRepos,
    'GET /api/projects': () => [fixtures.projectListItem],
    'POST /api/projects': () => ({
      project: {
        name: 'widgets',
        adapter: 'techpulse-coo',
        repo: 'octo/widgets',
        clone: '/clones/widgets',
        base_branch: 'main',
        options: {},
      },
      sync: { added: [], changed: [], events: [], hasCooLayout: false },
    }),
    'POST /api/projects/widgets/setup': () => ({
      setup: {
        status: 'pending',
        prUrl: 'https://github.com/octo/widgets/pull/7',
        prNumber: 7,
      },
      project: fixtures.pendingProjectListItem,
    }),
    'DELETE /api/projects/widgets': () => ({ ok: true }),
    'DELETE /api/projects/techpulse': () => ({ ok: true }),
    'GET /api/workflows': () => [fixtures.workflow],
    'GET /api/workflows/wf_1': () => ({
      workflow: fixtures.workflow,
      steps: fixtures.workflowSteps,
    }),
    'POST /api/workflows': () => ({ workflowId: 'wf_2' }),
    'POST /api/workflows/wf_1/pause': () => ({
      ...fixtures.workflow,
      status: 'paused',
    }),
    'POST /api/workflows/wf_1/resume': () => ({
      ...fixtures.workflow,
      status: 'running',
    }),
    'POST /api/workflows/wf_1/terminate': () => ({
      ...fixtures.workflow,
      status: 'terminated',
    }),
    'POST /api/workflows/wf_1/events': () => ({ id: 2 }),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      const key = `${init?.method ?? 'GET'} ${url.pathname}`
      const handler = routes[key]
      if (!handler)
        return new Response(JSON.stringify({ error: `no mock for ${key}` }), {
          status: 404,
        })
      const body = handler(url, init)
      if (body instanceof Response) return body
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

export class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  readyState = 0
  url: string
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  send() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}
