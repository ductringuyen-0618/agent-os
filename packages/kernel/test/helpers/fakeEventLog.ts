import type {
  Event,
  Run,
  RunStatus,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
} from '@agentos/shared'

export class FakeEventLog {
  runs: Run[] = []
  events: Event[] = []
  schedules: Array<{
    id: string
    skill: string
    whenAt: string
    payload?: Record<string, unknown>
    firedAt?: string
  }> = []
  workflows: WorkflowInstance[] = []
  workflowSteps: WorkflowStep[] = []
  private subs: Array<(e: Event) => void> = []
  private seq = 0

  append(e: Omit<Event, 'id' | 'ts'>): Event {
    const full: Event = { id: ++this.seq, ts: new Date().toISOString(), ...e }
    this.events.push(full)
    for (const cb of this.subs) cb(full)
    return full
  }
  createRun(
    r: Omit<Run, 'id' | 'status' | 'attempt'> & { attempt?: number },
  ): Run {
    const run: Run = {
      id: `run-${++this.seq}`,
      status: 'queued',
      attempt: r.attempt ?? 1,
      ...r,
    }
    this.runs.push(run)
    return run
  }
  updateRun(id: string, patch: Partial<Run>): Run {
    const run = this.runs.find((r) => r.id === id)
    if (!run) throw new Error(`no run ${id}`)
    Object.assign(run, patch)
    return run
  }
  getRun(id: string): Run | undefined {
    return this.runs.find((r) => r.id === id)
  }
  listRuns(
    opts: { status?: RunStatus; routine?: string; limit?: number } = {},
  ): Run[] {
    let list = this.runs.filter(
      (r) =>
        (!opts.status || r.status === opts.status) &&
        (!opts.routine || r.routine === opts.routine),
    )
    list = list.slice().reverse()
    return opts.limit ? list.slice(0, opts.limit) : list
  }
  subscribe(cb: (e: Event) => void): () => void {
    this.subs.push(cb)
    return () => {
      this.subs = this.subs.filter((c) => c !== cb)
    }
  }
  createSchedule(s: {
    skill: string
    whenAt: string
    payload?: Record<string, unknown>
  }): { id: string } {
    const id = `sched-${++this.seq}`
    this.schedules.push({ id, ...s })
    return { id }
  }
  dueSchedules(nowIso: string) {
    return this.schedules.filter((s) => !s.firedAt && s.whenAt <= nowIso)
  }
  markScheduleFired(id: string, firedAtIso: string): void {
    const s = this.schedules.find((x) => x.id === id)
    if (s) s.firedAt = firedAtIso
  }
  createWorkflow(w: {
    kind: string
    project?: string
    title: string
    input: Record<string, unknown>
  }): WorkflowInstance {
    const now = new Date().toISOString()
    const wf: WorkflowInstance = {
      id: `wf-${++this.seq}`,
      kind: w.kind,
      status: 'queued',
      project: w.project,
      title: w.title,
      input: w.input,
      state: {},
      createdAt: now,
      updatedAt: now,
    }
    this.workflows.push(wf)
    return wf
  }
  getWorkflow(id: string): WorkflowInstance | undefined {
    return this.workflows.find((w) => w.id === id)
  }
  listWorkflows(
    opts: { status?: WorkflowStatus; kind?: string; project?: string } = {},
  ): WorkflowInstance[] {
    return this.workflows.filter(
      (w) =>
        (!opts.status || w.status === opts.status) &&
        (!opts.kind || w.kind === opts.kind) &&
        (!opts.project || w.project === opts.project),
    )
  }
  updateWorkflow(
    id: string,
    patch: Partial<WorkflowInstance>,
  ): WorkflowInstance {
    const wf = this.workflows.find((w) => w.id === id)
    if (!wf) throw new Error(`no workflow ${id}`)
    Object.assign(wf, patch, { updatedAt: new Date().toISOString() })
    return wf
  }
  createWorkflowStep(s: {
    workflowId: string
    name: string
    seq: number
    status: WorkflowStepStatus
    attempt?: number
  }): WorkflowStep {
    const step: WorkflowStep = {
      id: `wfs-${++this.seq}`,
      workflowId: s.workflowId,
      name: s.name,
      seq: s.seq,
      status: s.status,
      attempt: s.attempt ?? 1,
      startedAt: new Date().toISOString(),
    }
    this.workflowSteps.push(step)
    return step
  }
  listWorkflowSteps(workflowId: string): WorkflowStep[] {
    return this.workflowSteps
      .filter((s) => s.workflowId === workflowId)
      .slice()
      .sort((a, b) => a.seq - b.seq)
  }
  updateWorkflowStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep {
    const step = this.workflowSteps.find((s) => s.id === id)
    if (!step) throw new Error(`no workflow step ${id}`)
    Object.assign(step, patch)
    return step
  }
  deleteWorkflowStep(id: string): void {
    this.workflowSteps = this.workflowSteps.filter((s) => s.id !== id)
  }
}

export const DEFAULTS = {
  model: 'sonnet',
  permission_mode: 'plan' as const,
  allowed_tools: [],
  max_attempts: 2,
  timeout_ms: 60_000,
}
