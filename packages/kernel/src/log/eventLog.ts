import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Decision,
  DecisionStatus,
  Event,
  EventType,
  Message,
  Run,
  RunStatus,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
} from '@agentos/shared'
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Module-level (not per-instance) so ordering holds even across multiple
// EventLog instances created in the same process, as tests do.
let lastNowMs = 0

/**
 * Millisecond-resolution wall clock, but strictly increasing per process.
 * Plain `Date.now()` can tie within the same millisecond on fast in-memory
 * SQLite (no I/O latency between an INSERT's default timestamp and a
 * following UPDATE's `nowIso()` call), which made e.g. `updateWorkflow`'s
 * `updatedAt` intermittently equal the row's `createdAt` -- a real flake,
 * not a one-off. Clamping to `lastNowMs + 1` when the clock hasn't visibly
 * advanced keeps every timestamp this module hands out strictly ordered.
 */
function nowIso(): string {
  let ms = Date.now()
  if (ms <= lastNowMs) ms = lastNowMs + 1
  lastNowMs = ms
  return new Date(ms).toISOString()
}

/**
 * nanoid's default alphabet can produce a leading '-', which commander (used
 * by the CLI's `approve <id>`/`reject <id>`/`logs <runId>` etc.) misparses as
 * an unknown flag when passed positionally. Regenerate on that rare case
 * instead so every id this module hands out is safe as a bare CLI argument.
 */
function genId(): string {
  let id = nanoid()
  while (id.startsWith('-')) id = nanoid()
  return id
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToRun(row: any): Run {
  return {
    id: row.id,
    routine: row.routine,
    skill: row.skill ?? undefined,
    adapter: row.adapter ?? undefined,
    agent: row.agent ?? undefined,
    status: row.status as RunStatus,
    attempt: row.attempt,
    payload: row.payload ? JSON.parse(row.payload) : undefined,
    sessionId: row.session_id ?? undefined,
    pid: row.pid ?? undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    error: row.error ?? undefined,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToEvent(row: any): Event {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type as EventType,
    runId: row.run_id ?? undefined,
    payload: JSON.parse(row.payload),
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToDecision(row: any): Decision {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    adapter: row.adapter ?? undefined,
    project: row.project ?? undefined,
    ref: row.ref ?? undefined,
    status: row.status as DecisionStatus,
    createdByRun: row.created_by_run ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    error: row.error ?? undefined,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToMessage(row: any): Message {
  return {
    id: row.id,
    from: row.from_agent,
    to: row.to_agent,
    body: row.body,
    ts: row.ts,
    readAt: row.read_at ?? undefined,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToWorkflow(row: any): WorkflowInstance {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as WorkflowStatus,
    project: row.project ?? undefined,
    title: row.title,
    input: JSON.parse(row.input),
    state: JSON.parse(row.state),
    currentStep: row.current_step ?? undefined,
    wakeAt: row.wake_at ?? undefined,
    waitEvent: row.wait_event ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    updatedAt: row.updated_at,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToWorkflowStep(row: any): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    name: row.name,
    seq: row.seq,
    status: row.status as WorkflowStepStatus,
    attempt: row.attempt,
    runId: row.run_id ?? undefined,
    output:
      row.output !== null && row.output !== undefined
        ? JSON.parse(row.output)
        : undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
  }
}

export class EventLog {
  private db: Database.Database
  private subscribers = new Set<(e: Event) => void>()

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    this.db.exec(schema)
    this.migrate()
  }

  /** Additive column migrations for databases created by older builds. */
  private migrate() {
    const cols = (
      this.db.prepare('PRAGMA table_info(decisions)').all() as Array<{
        name: string
      }>
    ).map((c) => c.name)
    if (!cols.includes('project'))
      this.db.exec('ALTER TABLE decisions ADD COLUMN project TEXT')
  }

  append(e: Omit<Event, 'id' | 'ts'>): Event {
    const ts = nowIso()
    // A subprocess's stdout 'data' handler (ProcessManager) can still be
    // in flight when kernel.stop() closes this EventLog (a narrow shutdown
    // race, not a correctness issue for any completed run's own state) --
    // dropping the write is safe and preferable to an uncaught "database
    // connection is not open" exception crashing the process/test run.
    if (!this.db.open) {
      return { id: -1, ts, type: e.type, runId: e.runId, payload: e.payload }
    }
    const info = this.db
      .prepare(
        'INSERT INTO events (ts, type, run_id, payload) VALUES (?, ?, ?, ?)',
      )
      .run(ts, e.type, e.runId ?? null, JSON.stringify(e.payload))
    const event: Event = {
      id: Number(info.lastInsertRowid),
      ts,
      type: e.type,
      runId: e.runId,
      payload: e.payload,
    }
    // A broken subscriber (e.g. a dead websocket) must never fail the producer.
    for (const cb of this.subscribers) {
      try {
        cb(event)
      } catch {
        this.subscribers.delete(cb)
      }
    }
    return event
  }

  createRun(
    r: Omit<Run, 'id' | 'status' | 'attempt'> & { attempt?: number },
  ): Run {
    const id = genId()
    const attempt = r.attempt ?? 1
    this.db
      .prepare(
        `INSERT INTO runs (id, routine, skill, adapter, agent, status, attempt, payload, session_id, pid, started_at, ended_at, input_tokens, output_tokens, cost_usd, error)
         VALUES (@id, @routine, @skill, @adapter, @agent, 'queued', @attempt, @payload, @sessionId, @pid, @startedAt, @endedAt, @inputTokens, @outputTokens, @costUsd, @error)`,
      )
      .run({
        id,
        routine: r.routine,
        skill: r.skill ?? null,
        adapter: r.adapter ?? null,
        agent: r.agent ?? null,
        attempt,
        payload: r.payload ? JSON.stringify(r.payload) : null,
        sessionId: r.sessionId ?? null,
        pid: r.pid ?? null,
        startedAt: r.startedAt ?? null,
        endedAt: r.endedAt ?? null,
        inputTokens: r.inputTokens ?? null,
        outputTokens: r.outputTokens ?? null,
        costUsd: r.costUsd ?? null,
        error: r.error ?? null,
      })
    // biome-ignore lint/style/noNonNullAssertion: just inserted
    return this.getRun(id)!
  }

  updateRun(id: string, patch: Partial<Run>): Run {
    const existing = this.getRun(id)
    if (!existing) throw new Error(`Run not found: ${id}`)
    const merged: Run = { ...existing, ...patch }
    this.db
      .prepare(
        `UPDATE runs SET routine=@routine, skill=@skill, adapter=@adapter, agent=@agent, status=@status, attempt=@attempt,
         payload=@payload, session_id=@sessionId, pid=@pid, started_at=@startedAt, ended_at=@endedAt,
         input_tokens=@inputTokens, output_tokens=@outputTokens, cost_usd=@costUsd, error=@error WHERE id=@id`,
      )
      .run({
        id,
        routine: merged.routine,
        skill: merged.skill ?? null,
        adapter: merged.adapter ?? null,
        agent: merged.agent ?? null,
        status: merged.status,
        attempt: merged.attempt,
        payload: merged.payload ? JSON.stringify(merged.payload) : null,
        sessionId: merged.sessionId ?? null,
        pid: merged.pid ?? null,
        startedAt: merged.startedAt ?? null,
        endedAt: merged.endedAt ?? null,
        inputTokens: merged.inputTokens ?? null,
        outputTokens: merged.outputTokens ?? null,
        costUsd: merged.costUsd ?? null,
        error: merged.error ?? null,
      })
    // biome-ignore lint/style/noNonNullAssertion: just updated
    return this.getRun(id)!
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
    return row ? rowToRun(row) : undefined
  }

  listRuns(
    opts: { status?: RunStatus; routine?: string; limit?: number } = {},
  ): Run[] {
    let sql = 'SELECT * FROM runs WHERE 1=1'
    const params: unknown[] = []
    if (opts.status) {
      sql += ' AND status = ?'
      params.push(opts.status)
    }
    if (opts.routine) {
      sql += ' AND routine = ?'
      params.push(opts.routine)
    }
    sql += ' ORDER BY created_at DESC'
    if (opts.limit) {
      sql += ' LIMIT ?'
      params.push(opts.limit)
    }
    return this.db
      .prepare(sql)
      .all(...params)
      .map(rowToRun)
  }

  listEvents(opts: {
    runId?: string
    sinceId?: number
    types?: EventType[]
    limit?: number
  }): Event[] {
    let sql = 'SELECT * FROM events WHERE 1=1'
    const params: unknown[] = []
    if (opts.runId) {
      sql += ' AND run_id = ?'
      params.push(opts.runId)
    }
    if (opts.sinceId !== undefined) {
      sql += ' AND id > ?'
      params.push(opts.sinceId)
    }
    if (opts.types && opts.types.length > 0) {
      sql += ` AND type IN (${opts.types.map(() => '?').join(',')})`
      params.push(...opts.types)
    }
    sql += ' ORDER BY id ASC'
    if (opts.limit) {
      sql += ' LIMIT ?'
      params.push(opts.limit)
    }
    return this.db
      .prepare(sql)
      .all(...params)
      .map(rowToEvent)
  }

  createDecision(d: Omit<Decision, 'id' | 'status' | 'createdAt'>): Decision {
    const id = genId()
    const createdAt = nowIso()
    this.db
      .prepare(
        `INSERT INTO decisions (id, title, body, adapter, ref, status, created_by_run, created_at, resolved_at, error, project)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?)`,
      )
      .run(
        id,
        d.title,
        d.body,
        d.adapter ?? null,
        d.ref ?? null,
        d.createdByRun ?? null,
        createdAt,
        d.project ?? null,
      )
    return rowToDecision(
      this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id),
    )
  }

  resolveDecision(
    id: string,
    status: 'approved' | 'rejected' | 'error',
    error?: string,
  ): Decision {
    const resolvedAt = nowIso()
    this.db
      .prepare(
        'UPDATE decisions SET status = ?, resolved_at = ?, error = ? WHERE id = ?',
      )
      .run(status, resolvedAt, error ?? null, id)
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id)
    if (!row) throw new Error(`Decision not found: ${id}`)
    const decision = rowToDecision(row)
    this.append({
      type: 'decision.resolved',
      payload: {
        decisionId: decision.id,
        status: decision.status,
        ref: decision.ref,
        project: decision.project,
      },
    })
    return decision
  }

  listDecisions(opts: { status?: DecisionStatus } = {}): Decision[] {
    let sql = 'SELECT * FROM decisions WHERE 1=1'
    const params: unknown[] = []
    if (opts.status) {
      sql += ' AND status = ?'
      params.push(opts.status)
    }
    sql += ' ORDER BY created_at DESC'
    return this.db
      .prepare(sql)
      .all(...params)
      .map(rowToDecision)
  }

  getDecision(id: string): Decision | undefined {
    return this.listDecisions().find((d) => d.id === id)
  }

  /** Rewrite a pending decision's title/body (e.g. its proposal was edited). */
  updateDecision(
    id: string,
    patch: { title?: string; body?: string; project?: string },
  ): Decision {
    const current = this.getDecision(id)
    if (!current) throw new Error(`Decision not found: ${id}`)
    this.db
      .prepare(
        'UPDATE decisions SET title = ?, body = ?, project = ? WHERE id = ?',
      )
      .run(
        patch.title ?? current.title,
        patch.body ?? current.body,
        patch.project ?? current.project ?? null,
        id,
      )
    return this.getDecision(id) as Decision
  }

  sendMessage(m: Omit<Message, 'id' | 'ts'>): Message {
    const id = genId()
    const ts = nowIso()
    this.db
      .prepare(
        'INSERT INTO messages (id, from_agent, to_agent, body, ts, read_at) VALUES (?, ?, ?, ?, ?, NULL)',
      )
      .run(id, m.from, m.to, m.body, ts)
    this.append({
      type: 'message.sent',
      payload: { id, from: m.from, to: m.to },
    })
    return { id, from: m.from, to: m.to, body: m.body, ts }
  }

  readInbox(agent: string, markRead = false): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE to_agent = ? ORDER BY ts ASC')
      .all(agent)
    const messages = rows.map(rowToMessage)
    if (markRead) {
      this.db
        .prepare(
          'UPDATE messages SET read_at = ? WHERE to_agent = ? AND read_at IS NULL',
        )
        .run(nowIso(), agent)
    }
    return messages
  }

  /**
   * All messages, newest first, for operator viewing -- never marks anything
   * read. Ties on `ts` (same-millisecond sends) break on rowid, SQLite's
   * implicit insertion-order column, so results are stable rather than
   * depending on clock resolution.
   */
  listMessages(limit = 100): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages ORDER BY ts DESC, rowid DESC LIMIT ?')
      .all(limit)
    return rows.map(rowToMessage)
  }

  /** Sum of cost_usd for a routine's runs that started since UTC midnight today. */
  costForRoutineToday(routine: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as total FROM runs
         WHERE routine = ? AND cost_usd IS NOT NULL AND started_at IS NOT NULL
         AND started_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')`,
      )
      .get(routine) as { total: number }
    return row.total
  }

  createRunToken(runId: string, token: string): void {
    this.db
      .prepare('INSERT INTO run_tokens (run_id, token) VALUES (?, ?)')
      .run(runId, token)
  }

  getRunByToken(token: string): Run | undefined {
    const row = this.db
      .prepare(
        'SELECT r.* FROM runs r JOIN run_tokens t ON t.run_id = r.id WHERE t.token = ?',
      )
      .get(token)
    return row ? rowToRun(row) : undefined
  }

  subscribe(cb: (e: Event) => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  createSchedule(s: {
    skill: string
    whenAt: string
    payload?: Record<string, unknown>
  }): { id: string } {
    const id = genId()
    this.db
      .prepare(
        'INSERT INTO schedules (id, skill, when_at, payload) VALUES (?, ?, ?, ?)',
      )
      .run(id, s.skill, s.whenAt, s.payload ? JSON.stringify(s.payload) : null)
    return { id }
  }

  dueSchedules(nowIso: string): Array<{
    id: string
    skill: string
    whenAt: string
    payload?: Record<string, unknown>
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, skill, when_at as whenAt, payload FROM schedules WHERE fired_at IS NULL AND when_at <= ?',
      )
      .all(nowIso) as Array<{
      id: string
      skill: string
      whenAt: string
      payload: string | null
    }>
    return rows.map((r) => ({
      id: r.id,
      skill: r.skill,
      whenAt: r.whenAt,
      payload: r.payload ? JSON.parse(r.payload) : undefined,
    }))
  }

  markScheduleFired(id: string, firedAtIso: string): void {
    this.db
      .prepare('UPDATE schedules SET fired_at = ? WHERE id = ?')
      .run(firedAtIso, id)
  }

  createWorkflow(w: {
    kind: string
    project?: string
    title: string
    input: Record<string, unknown>
  }): WorkflowInstance {
    const id = genId()
    // created_at/updated_at are set explicitly from this module's monotonic
    // nowIso() rather than left to schema.sql's SQL-side strftime() default:
    // that default is a separate clock read from JS's Date.now(), and the
    // two can tie at millisecond resolution on fast in-memory SQLite,
    // making a subsequent updateWorkflow()'s new updatedAt indistinguishable
    // from this row's initial one.
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO workflows (id, kind, status, project, title, input, state, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, '{}', ?, ?)`,
      )
      .run(
        id,
        w.kind,
        w.project ?? null,
        w.title,
        JSON.stringify(w.input),
        now,
        now,
      )
    // biome-ignore lint/style/noNonNullAssertion: just inserted
    return this.getWorkflow(id)!
  }

  getWorkflow(id: string): WorkflowInstance | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id)
    return row ? rowToWorkflow(row) : undefined
  }

  listWorkflows(
    opts: { status?: WorkflowStatus; kind?: string; project?: string } = {},
  ): WorkflowInstance[] {
    let sql = 'SELECT * FROM workflows WHERE 1=1'
    const params: unknown[] = []
    if (opts.status) {
      sql += ' AND status = ?'
      params.push(opts.status)
    }
    if (opts.kind) {
      sql += ' AND kind = ?'
      params.push(opts.kind)
    }
    if (opts.project) {
      sql += ' AND project = ?'
      params.push(opts.project)
    }
    sql += ' ORDER BY created_at DESC'
    return this.db
      .prepare(sql)
      .all(...params)
      .map(rowToWorkflow)
  }

  updateWorkflow(
    id: string,
    patch: Partial<WorkflowInstance>,
  ): WorkflowInstance {
    const existing = this.getWorkflow(id)
    if (!existing) throw new Error(`Workflow not found: ${id}`)
    const merged: WorkflowInstance = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    }
    this.db
      .prepare(
        `UPDATE workflows SET kind=@kind, status=@status, project=@project, title=@title, input=@input, state=@state,
         current_step=@currentStep, wake_at=@wakeAt, wait_event=@waitEvent, error=@error,
         started_at=@startedAt, ended_at=@endedAt, updated_at=@updatedAt WHERE id=@id`,
      )
      .run({
        id,
        kind: merged.kind,
        status: merged.status,
        project: merged.project ?? null,
        title: merged.title,
        input: JSON.stringify(merged.input),
        state: JSON.stringify(merged.state),
        currentStep: merged.currentStep ?? null,
        wakeAt: merged.wakeAt ?? null,
        waitEvent: merged.waitEvent ?? null,
        error: merged.error ?? null,
        startedAt: merged.startedAt ?? null,
        endedAt: merged.endedAt ?? null,
        updatedAt: merged.updatedAt,
      })
    // biome-ignore lint/style/noNonNullAssertion: just updated
    return this.getWorkflow(id)!
  }

  createWorkflowStep(s: {
    workflowId: string
    name: string
    seq: number
    status: WorkflowStepStatus
    attempt?: number
  }): WorkflowStep {
    const id = genId()
    this.db
      .prepare(
        'INSERT INTO workflow_steps (id, workflow_id, name, seq, status, attempt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, s.workflowId, s.name, s.seq, s.status, s.attempt ?? 1)
    // biome-ignore lint/style/noNonNullAssertion: just inserted
    return this.listWorkflowSteps(s.workflowId).find((row) => row.id === id)!
  }

  listWorkflowSteps(workflowId: string): WorkflowStep[] {
    return this.db
      .prepare(
        'SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY seq ASC',
      )
      .all(workflowId)
      .map(rowToWorkflowStep)
  }

  updateWorkflowStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep {
    const row = this.db
      .prepare('SELECT * FROM workflow_steps WHERE id = ?')
      .get(id)
    if (!row) throw new Error(`Workflow step not found: ${id}`)
    const existing = rowToWorkflowStep(row)
    const merged: WorkflowStep = { ...existing, ...patch }
    this.db
      .prepare(
        'UPDATE workflow_steps SET status=@status, attempt=@attempt, run_id=@runId, output=@output, error=@error, ended_at=@endedAt WHERE id=@id',
      )
      .run({
        id,
        status: merged.status,
        attempt: merged.attempt,
        runId: merged.runId ?? null,
        output:
          merged.output !== undefined ? JSON.stringify(merged.output) : null,
        error: merged.error ?? null,
        endedAt: merged.endedAt ?? null,
      })
    // biome-ignore lint/style/noNonNullAssertion: just updated
    return this.listWorkflowSteps(merged.workflowId).find((r) => r.id === id)!
  }

  deleteWorkflowStep(id: string): void {
    this.db.prepare('DELETE FROM workflow_steps WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }
}
