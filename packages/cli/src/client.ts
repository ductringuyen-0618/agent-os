import type {
  CreateRunRequest,
  CreateRunResponse,
  Event,
  HealthResponse,
  RoutineConfig,
  Run,
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
    headers.set('content-type', 'application/json')
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
}
