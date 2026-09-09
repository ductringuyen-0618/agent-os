import type { SyncResult } from '@agentos/kernel/adapters/types'
import type {
  CreateRunRequest,
  CreateRunResponse,
  Decision,
  DecisionStatus,
  Event,
  HealthResponse,
  RoutineConfig,
  Run,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
} from '@agentos/shared'

export interface RoutineListItem {
  routine: RoutineConfig
  nextRun?: string
  lastRun?: Run
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
}

export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  private async request<T>(
    urlPath: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers)
    // Only set content-type when there's an actual JSON body -- Fastify's
    // default JSON body parser rejects an empty body when content-type is
    // application/json (FST_ERR_CTP_EMPTY_JSON_BODY), which every bodyless
    // POST here (approve/reject/sync/enable/disable) would otherwise hit.
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    if (this.opts.token)
      headers.set('authorization', `Bearer ${this.opts.token}`)
    const res = await fetch(`${this.opts.baseUrl}${urlPath}`, {
      ...init,
      headers,
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`agent-os API ${res.status}: ${body}`)
    }
    return (await res.json()) as T
  }

  health(): Promise<HealthResponse> {
    return this.request('/api/health')
  }

  listRuns(
    opts: { status?: string; routine?: string; limit?: number } = {},
  ): Promise<Run[]> {
    const params = new URLSearchParams()
    if (opts.status) params.set('status', opts.status)
    if (opts.routine) params.set('routine', opts.routine)
    if (opts.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return this.request(`/api/runs${qs ? `?${qs}` : ''}`)
  }

  getRun(id: string): Promise<Run> {
    return this.request(`/api/runs/${id}`)
  }

  getRunEvents(id: string, sinceId?: number): Promise<Event[]> {
    const qs = sinceId !== undefined ? `?sinceId=${sinceId}` : ''
    return this.request(`/api/runs/${id}/events${qs}`)
  }

  createRun(body: CreateRunRequest): Promise<CreateRunResponse> {
    return this.request('/api/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  listRoutines(): Promise<RoutineListItem[]> {
    return this.request('/api/routines')
  }

  runRoutine(
    name: string,
    payload?: Record<string, unknown>,
  ): Promise<{ runId: string }> {
    return this.request(`/api/routines/${name}/run`, {
      method: 'POST',
      body: JSON.stringify({ payload }),
    })
  }

  setRoutineEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }> {
    return this.request(
      `/api/routines/${name}/${enabled ? 'enable' : 'disable'}`,
      { method: 'POST' },
    )
  }

  listDecisions(status?: DecisionStatus): Promise<Decision[]> {
    return this.request(`/api/decisions${status ? `?status=${status}` : ''}`)
  }

  approveDecision(id: string): Promise<Decision> {
    return this.request(`/api/decisions/${id}/approve`, { method: 'POST' })
  }

  rejectDecision(id: string): Promise<Decision> {
    return this.request(`/api/decisions/${id}/reject`, { method: 'POST' })
  }

  syncProject(name: string): Promise<SyncResult> {
    return this.request(`/api/projects/${name}/sync`, { method: 'POST' })
  }

  listWorkflows(
    opts: { status?: WorkflowStatus; project?: string; kind?: string } = {},
  ): Promise<WorkflowInstance[]> {
    const params = new URLSearchParams()
    if (opts.status) params.set('status', opts.status)
    if (opts.project) params.set('project', opts.project)
    if (opts.kind) params.set('kind', opts.kind)
    const qs = params.toString()
    return this.request(`/api/workflows${qs ? `?${qs}` : ''}`)
  }

  getWorkflow(
    id: string,
  ): Promise<{ workflow: WorkflowInstance; steps: WorkflowStep[] }> {
    return this.request(`/api/workflows/${id}`)
  }

  createWorkflow(body: {
    kind: string
    project?: string
    title?: string
    input: Record<string, unknown>
  }): Promise<{ workflowId: string }> {
    return this.request('/api/workflows', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  pauseWorkflow(id: string): Promise<WorkflowInstance> {
    return this.request(`/api/workflows/${id}/pause`, { method: 'POST' })
  }

  resumeWorkflow(id: string): Promise<WorkflowInstance> {
    return this.request(`/api/workflows/${id}/resume`, { method: 'POST' })
  }

  terminateWorkflow(id: string): Promise<WorkflowInstance> {
    return this.request(`/api/workflows/${id}/terminate`, { method: 'POST' })
  }
}
