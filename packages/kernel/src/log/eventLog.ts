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
} from '@agentos/shared'
import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function nowIso(): string {
  return new Date().toISOString()
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

export class EventLog {
  private db: Database.Database
  private subscribers = new Set<(e: Event) => void>()

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    this.db.exec(schema)
  }

  append(e: Omit<Event, 'id' | 'ts'>): Event {
    const ts = nowIso()
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
    for (const cb of this.subscribers) cb(event)
    return event
  }

  createRun(
    r: Omit<Run, 'id' | 'status' | 'attempt'> & { attempt?: number },
  ): Run {
    const id = nanoid()
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
    const id = nanoid()
    const createdAt = nowIso()
    this.db
      .prepare(
        `INSERT INTO decisions (id, title, body, adapter, ref, status, created_by_run, created_at, resolved_at, error)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
      )
      .run(
        id,
        d.title,
        d.body,
        d.adapter ?? null,
        d.ref ?? null,
        d.createdByRun ?? null,
        createdAt,
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
    return rowToDecision(row)
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

  sendMessage(m: Omit<Message, 'id' | 'ts'>): Message {
    const id = nanoid()
    const ts = nowIso()
    this.db
      .prepare(
        'INSERT INTO messages (id, from_agent, to_agent, body, ts, read_at) VALUES (?, ?, ?, ?, ?, NULL)',
      )
      .run(id, m.from, m.to, m.body, ts)
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
    const id = nanoid()
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

  close(): void {
    this.db.close()
  }
}
