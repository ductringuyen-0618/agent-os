import type { Event, Run, RunStatus } from '@agentos/shared'

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
  costForRoutineToday(routine: string): number {
    const todayPrefix = new Date().toISOString().slice(0, 10)
    return this.runs
      .filter(
        (r) =>
          r.routine === routine &&
          r.costUsd !== undefined &&
          r.startedAt !== undefined &&
          r.startedAt.slice(0, 10) === todayPrefix,
      )
      .reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  }
}

export const DEFAULTS = {
  model: 'sonnet',
  permission_mode: 'plan' as const,
  allowed_tools: [],
  max_attempts: 2,
  timeout_ms: 60_000,
}
