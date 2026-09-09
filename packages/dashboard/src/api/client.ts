import type {
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  Decision,
  DecisionStatus,
  DeliverWorkflowEventRequest,
  EvalCriteria,
  Event,
  GetWorkflowResponse,
  ListWorkflowsQuery,
  Message,
  ProjectConfig,
  RoutineConfig,
  Run,
  RunStatus,
  SkillMeta,
  WorkflowInstance,
} from '@agentos/shared'

export class ApiError extends Error {
  status: number
  body?: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export interface AgentStatus {
  name: string
  status: 'idle' | 'working' | 'blocked'
  currentRun?: string
}
export interface RoutineListItem {
  routine: RoutineConfig
  nextRun?: string
  lastRun?: Run
}
export interface CostEntry {
  day: string
  agent: string
  costUsd: number
}
export interface SkillDetail {
  skillMd: string
  learningsMd: string
  eval: EvalCriteria
  lastOutputMd: string
}

function authHeaders(): Record<string, string> {
  const token =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('agentosToken')
      : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export class ApiClient {
  constructor(private baseUrl = '') {}

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    // Only declare a JSON body when there is one: Fastify rejects
    // `content-type: application/json` with an empty body as 400.
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...authHeaders(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined
    if (!res.ok)
      throw new ApiError(res.status, data?.error || res.statusText, data)
    return data as T
  }

  health() {
    return this.req<{ ok: true; version: string }>('GET', '/api/health')
  }

  listRuns(
    opts: { status?: RunStatus; routine?: string; limit?: number } = {},
  ) {
    const qs = new URLSearchParams(opts as Record<string, string>).toString()
    return this.req<Run[]>('GET', `/api/runs${qs ? `?${qs}` : ''}`)
  }
  getRun(id: string) {
    return this.req<Run>('GET', `/api/runs/${id}`)
  }
  getRunEvents(id: string, sinceId?: number) {
    return this.req<Event[]>(
      'GET',
      `/api/runs/${id}/events${sinceId ? `?sinceId=${sinceId}` : ''}`,
    )
  }
  killRun(id: string) {
    return this.req<{ ok: true }>('POST', `/api/runs/${id}/kill`)
  }

  listDecisions(status?: DecisionStatus) {
    return this.req<Decision[]>(
      'GET',
      `/api/decisions${status ? `?status=${status}` : ''}`,
    )
  }
  approveDecision(id: string) {
    return this.req<Decision>('POST', `/api/decisions/${id}/approve`)
  }
  rejectDecision(id: string) {
    return this.req<Decision>('POST', `/api/decisions/${id}/reject`)
  }

  listRoutines() {
    return this.req<RoutineListItem[]>('GET', '/api/routines')
  }
  runRoutine(name: string, payload?: Record<string, unknown>) {
    return this.req<{ runId: string }>('POST', `/api/routines/${name}/run`, {
      payload,
    })
  }
  enableRoutine(name: string) {
    return this.req<{ ok: true }>('POST', `/api/routines/${name}/enable`)
  }
  disableRoutine(name: string) {
    return this.req<{ ok: true }>('POST', `/api/routines/${name}/disable`)
  }

  wikiIndex() {
    return this.req<{ content: string }>('GET', '/api/wiki/index')
  }
  wikiLog(limit?: number) {
    return this.req<{ content: string }>(
      'GET',
      `/api/wiki/log${limit ? `?limit=${limit}` : ''}`,
    )
  }
  wikiPage(path: string) {
    return this.req<{ content: string }>(
      'GET',
      `/api/wiki/page?path=${encodeURIComponent(path)}`,
    )
  }

  listSkills() {
    return this.req<SkillMeta[]>('GET', '/api/skills')
  }
  getSkill(name: string) {
    return this.req<SkillDetail>('GET', `/api/skills/${name}`)
  }

  listAgents() {
    return this.req<AgentStatus[]>('GET', '/api/agents')
  }
  costs(days?: number) {
    return this.req<CostEntry[]>(
      'GET',
      `/api/costs${days ? `?days=${days}` : ''}`,
    )
  }
  messages(limit?: number) {
    return this.req<Message[]>(
      'GET',
      `/api/messages${limit ? `?limit=${limit}` : ''}`,
    )
  }

  listWorkflows(opts: ListWorkflowsQuery = {}) {
    const qs = new URLSearchParams(opts as Record<string, string>).toString()
    return this.req<WorkflowInstance[]>(
      'GET',
      `/api/workflows${qs ? `?${qs}` : ''}`,
    )
  }
  getWorkflow(id: string) {
    return this.req<GetWorkflowResponse>('GET', `/api/workflows/${id}`)
  }
  createWorkflow(body: CreateWorkflowRequest) {
    return this.req<CreateWorkflowResponse>('POST', '/api/workflows', body)
  }
  pauseWorkflow(id: string) {
    return this.req<WorkflowInstance>('POST', `/api/workflows/${id}/pause`)
  }
  resumeWorkflow(id: string) {
    return this.req<WorkflowInstance>('POST', `/api/workflows/${id}/resume`)
  }
  terminateWorkflow(id: string) {
    return this.req<WorkflowInstance>('POST', `/api/workflows/${id}/terminate`)
  }
  sendWorkflowEvent(id: string, event: DeliverWorkflowEventRequest) {
    return this.req<{ id: number }>(
      'POST',
      `/api/workflows/${id}/events`,
      event,
    )
  }

  listProjects() {
    return this.req<ProjectConfig[]>('GET', '/api/projects')
  }
}
