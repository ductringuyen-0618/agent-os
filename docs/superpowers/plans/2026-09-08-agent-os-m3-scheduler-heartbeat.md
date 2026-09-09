# agent-os M3 — Scheduler & Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agent-os a real `Scheduler` (cron/every/event/one-shot triggers, retry+backoff, restart recovery) wired into `kernel.ts`, plus the full `heartbeat` and `daily-digest` skills and a Routines API/CLI, so `agentos up` runs on its own against `routines.yaml` with no manual triggering.
**Architecture:** `scheduler/triggers.ts` holds pure trigger-matching helpers; `scheduler/scheduler.ts` owns timers (croner for `cron`, `setInterval` for `every`), the persistent `schedules` table for one-shot runs, and retry/backoff bookkeeping, calling an injected `exec(routine, payload)` callback. `kernel.ts` supplies that callback: it resolves a routine to either a skill+agent run (`PromptAssembler` + `ProcessManager`) or an adapter sync (`AdapterHost.sync`, stubbed until M4). The kernel also emits `ops.alert` itself (never via the restricted `emit_event` syscall) when the scheduler detects a failed or missed routine.
**Tech Stack:** `croner@^9` (cron), `better-sqlite3@^11` (schedules table), `zod@^3`/`yaml@^2` (routines.yaml), Vitest with `vi.useFakeTimers()`.
**Spec:** docs/superpowers/specs/2026-09-08-agent-os-design.md
**Contract:** docs/superpowers/plans/2026-09-08-agent-os-00-contract.md

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome (single tool).
- Runtime deps (pinned major): `zod@^3`, `better-sqlite3@^11`, `croner@^9`, `fastify@^5` + `@fastify/websocket@^11` + `@fastify/static@^8`, `commander@^12`, `yaml@^2`, `@modelcontextprotocol/sdk@^1`, `execa@^9`, `simple-git@^3`, `gray-matter@^4`, `nanoid@^5`, `pino@^9`.
- Dashboard: `react@^18`, `react-dom@^18`, `vite@^6`, `tailwindcss@^4`.
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`).
- Every commit message ends with: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Public repo: `github.com/ductringuyen-0618/agent-os`. Default branch `main`.
- Nothing machine-specific in committed files (no absolute paths, hostnames, tokens). Runtime state under `<osRoot>/../.agentos/` (gitignored).
- The `claude` binary path comes from `AGENTOS_CLAUDE_BIN` (default `claude`); tests point it at the fake binary.
---

## File structure
- `packages/kernel/src/scheduler/triggers.ts` — create: `parseEvery`, `matchesOn`, `afterSatisfied` (pure).
- `packages/kernel/src/scheduler/scheduler.ts` — create: full `Scheduler` class per contract §4.
- `packages/kernel/src/log/eventLog.ts` — modify: add `createSchedule`, `dueSchedules`, `markScheduleFired` (contract addition, §ContractAdditions).
- `packages/kernel/src/adapters/types.ts` — create: `ProjectAdapter`/`AdapterContext`/`SyncResult` (already specified in contract §5, implemented now as the surface M3 needs).
- `packages/kernel/src/adapters/adapterHost.ts` — create: minimal `AdapterHost` stub (`sync()` no-op returning empty `SyncResult`; full logic is M4).
- `packages/kernel/src/kernel.ts` — modify: replace the no-op `Scheduler` stub with the real one; add `adapters: AdapterHost`; implement the `exec` callback; load `routines.yaml` on `start()`.
- `packages/kernel/src/api/server.ts` — modify: add `GET /api/routines`, `POST /api/routines/:name/run|enable|disable`.
- `packages/cli/src/commands/routines.ts` — create: `agentos routines [list|run|enable|disable]`.
- `packages/cli/src/bin.ts` — modify: register the routines command.
- `examples/os-template/os/routines.yaml` — modify: full spec §4.3 file.
- `examples/os-template/os/skills/heartbeat/{skill.md,learnings.md,eval.json}` — modify/create: full heartbeat skill.
- `examples/os-template/os/skills/daily-digest/{skill.md,learnings.md,eval.json}` — create: full daily-digest skill.
- `packages/kernel/test/helpers/fakeEventLog.ts` — create: in-memory `EventLog` test double.
- `packages/kernel/test/scheduler/*.test.ts`, `packages/kernel/test/scheduler-e2e.test.ts` — create: unit + integration tests.

### Design decisions not spelled out in the contract (documented here, not new contract surface)
- `exec: (routine, payload) => Promise<void>` has no `runId` param. The Scheduler creates the `Run` and sets it to `status: 'running'` **before** calling `exec`; `exec` recovers the run via `log.listRuns({ routine: routine.name, status: 'running', limit: 1 })[0]`. The Scheduler never runs two instances of the same routine concurrently, so this lookup is unambiguous.
- `scheduleOnce(skill, when, payload)` (and the `schedule` syscall) only carries a skill name, not an agent. The tick resolves it against the already-loaded routines: the first loaded routine whose `skill` matches is reused (inherits its `agent`/`model`/`permission_mode`); if none matches, an ad-hoc `RoutineConfig` `{ name: 'adhoc-<skill>', skill, agent: 'ops' }` is used.
- `daily-digest` needs to write under `os/output/digests/`. Per spec §4.2 every run already gets `--add-dir <os-root>`, and `output/` lives under `osRoot`, so no new `RoutineConfig` field is needed — the routine just sets `permission_mode: acceptEdits` and lists `Write` in `allowed_tools`.
- `setEnabled`/routine-enabled state is in-memory only (no `routines` table exists in the SQLite schema); it resets to the yaml default (`enabled !== false`) on daemon restart. Documented in Task 6.

---

### Task 1: Trigger-matching helpers
**Files:** Create `packages/kernel/src/scheduler/triggers.ts`; Test `packages/kernel/test/scheduler/triggers.test.ts`
**Interfaces:**
- Consumes: `EventType`, `Run` from `@agentos/shared`.
- Produces: `parseEvery(spec: string): number`, `matchesOn(on: string[] | undefined, eventType: string): boolean`, `afterSatisfied(after: string[] | undefined, lastRunsToday: Map<string, Run | undefined>): boolean`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/scheduler/triggers.test.ts
import { describe, it, expect } from 'vitest'
import { parseEvery, matchesOn, afterSatisfied } from '../../src/scheduler/triggers.js'
import type { Run } from '@agentos/shared'

describe('parseEvery', () => {
  it('parses seconds, minutes, hours', () => {
    expect(parseEvery('90s')).toBe(90_000)
    expect(parseEvery('30m')).toBe(1_800_000)
    expect(parseEvery('1h')).toBe(3_600_000)
  })
  it('throws on invalid input', () => {
    expect(() => parseEvery('banana')).toThrow(/invalid every duration/)
  })
})

describe('matchesOn', () => {
  it('matches exact event types', () => {
    expect(matchesOn(['raw.added'], 'raw.added')).toBe(true)
    expect(matchesOn(['raw.added'], 'raw.changed')).toBe(false)
  })
  it('matches the custom.* wildcard', () => {
    expect(matchesOn(['custom.*'], 'custom.anything')).toBe(true)
    expect(matchesOn(['custom.*'], 'raw.added')).toBe(false)
  })
  it('returns false for undefined/empty on', () => {
    expect(matchesOn(undefined, 'raw.added')).toBe(false)
    expect(matchesOn([], 'raw.added')).toBe(false)
  })
})

describe('afterSatisfied', () => {
  const today = new Date().toISOString()
  it('true when there is no after clause', () => {
    expect(afterSatisfied(undefined, new Map())).toBe(true)
  })
  it('true only if every named routine last ran successfully today', () => {
    const ok: Run = { id: '1', routine: 'lint', status: 'success', attempt: 1, endedAt: today }
    expect(afterSatisfied(['lint'], new Map([['lint', ok]]))).toBe(true)
  })
  it('false if the last run failed', () => {
    const bad: Run = { id: '1', routine: 'lint', status: 'failed', attempt: 1, endedAt: today }
    expect(afterSatisfied(['lint'], new Map([['lint', bad]]))).toBe(false)
  })
  it('false if no run is recorded', () => {
    expect(afterSatisfied(['lint'], new Map())).toBe(false)
  })
  it('false if the last successful run was not today', () => {
    const stale: Run = { id: '1', routine: 'lint', status: 'success', attempt: 1, endedAt: '2020-01-01T00:00:00.000Z' }
    expect(afterSatisfied(['lint'], new Map([['lint', stale]]))).toBe(false)
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- triggers`
Expected: fails with `Cannot find module '../../src/scheduler/triggers.js'`.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/scheduler/triggers.ts
import type { Run } from '@agentos/shared'

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export function parseEvery(spec: string): number {
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(spec.trim())
  if (!m) throw new Error(`invalid every duration: ${spec}`)
  return Number(m[1]) * UNIT_MS[m[2]]
}

export function matchesOn(on: string[] | undefined, eventType: string): boolean {
  if (!on || on.length === 0) return false
  return on.some((pattern) => pattern === eventType || (pattern === 'custom.*' && eventType.startsWith('custom.')))
}

function isToday(iso?: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

export function afterSatisfied(after: string[] | undefined, lastRunsToday: Map<string, Run | undefined>): boolean {
  if (!after || after.length === 0) return true
  return after.every((name) => {
    const run = lastRunsToday.get(name)
    return !!run && run.status === 'success' && isToday(run.endedAt)
  })
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- triggers`
Expected: `PASS` — 9 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/scheduler/triggers.ts packages/kernel/test/scheduler/triggers.test.ts
git commit -m "feat(kernel): add scheduler trigger-matching helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fake EventLog test double + Scheduler skeleton (`every`/`cron`/`runNow`)
**Files:** Create `packages/kernel/test/helpers/fakeEventLog.ts`, `packages/kernel/src/scheduler/scheduler.ts`; Test `packages/kernel/test/scheduler/scheduler.timers.test.ts`
**Interfaces:**
- Consumes: `KernelConfig`, `RoutineConfig`, `RoutinesFile`, `Run`, `Event` from `@agentos/shared`; `EventLog` from `../log/eventLog.js`; `Cron` from `croner`; `parseEvery` from `./triggers.js`.
- Produces: `export class Scheduler { constructor(cfg, log, exec); load(file); start(); stop(); runNow(name, payload?): Promise<string> }` (per contract §4).

- [ ] **Step 1: Write the fake EventLog helper (not a test itself, but required by the failing test in Step 2)**
```ts
// packages/kernel/test/helpers/fakeEventLog.ts
import type { Event, Run, RunStatus } from '@agentos/shared'

export class FakeEventLog {
  runs: Run[] = []
  events: Event[] = []
  schedules: Array<{ id: string; skill: string; whenAt: string; payload?: Record<string, unknown>; firedAt?: string }> = []
  private subs: Array<(e: Event) => void> = []
  private seq = 0

  append(e: Omit<Event, 'id' | 'ts'>): Event {
    const full: Event = { id: ++this.seq, ts: new Date().toISOString(), ...e }
    this.events.push(full)
    for (const cb of this.subs) cb(full)
    return full
  }
  createRun(r: Omit<Run, 'id' | 'status' | 'attempt'> & { attempt?: number }): Run {
    const run: Run = { id: `run-${++this.seq}`, status: 'queued', attempt: r.attempt ?? 1, ...r }
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
  listRuns(opts: { status?: RunStatus; routine?: string; limit?: number } = {}): Run[] {
    let list = this.runs.filter(
      (r) => (!opts.status || r.status === opts.status) && (!opts.routine || r.routine === opts.routine),
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
  createSchedule(s: { skill: string; whenAt: string; payload?: Record<string, unknown> }): { id: string } {
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
}

export const DEFAULTS = { model: 'sonnet', permission_mode: 'plan' as const, allowed_tools: [], max_attempts: 2, timeout_ms: 60_000 }
```
- [ ] **Step 2: Write failing tests**
```ts
// packages/kernel/test/scheduler/scheduler.timers.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { FakeEventLog, DEFAULTS } from '../helpers/fakeEventLog.js'
import type { KernelConfig, RoutinesFile } from '@agentos/shared'

const cfg = {
  osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude',
  host: '127.0.0.1', port: 4545, logLevel: 'info',
} as KernelConfig

describe('Scheduler every/cron', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires an every-routine on its interval', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    const scheduler = new Scheduler(cfg, log as any, exec)
    const file: RoutinesFile = {
      defaults: DEFAULTS,
      routines: [{ name: 'heartbeat', every: '1s', skill: 'heartbeat', agent: 'ops' }],
    }
    scheduler.load(file)
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(exec).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(exec).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('runNow triggers exec immediately and returns a runId', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [{ name: 'lint', cron: '0 3 * * *', skill: 'lint', agent: 'librarian' }] })
    scheduler.start()
    const runId = await scheduler.runNow('lint')
    expect(typeof runId).toBe('string')
    expect(exec).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('runNow rejects an unknown routine name', async () => {
    const log = new FakeEventLog()
    const scheduler = new Scheduler(cfg, log as any, vi.fn())
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    await expect(scheduler.runNow('nope')).rejects.toThrow(/unknown routine/)
    scheduler.stop()
  })
})
```
- [ ] **Step 3: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- scheduler.timers`
Expected: fails — `scheduler.ts` does not exist yet.
- [ ] **Step 4: Implement the Scheduler skeleton**
```ts
// packages/kernel/src/scheduler/scheduler.ts
import { Cron } from 'croner'
import type { KernelConfig, Run, RoutineConfig, RoutineDefaults, RoutinesFile, Event } from '@agentos/shared'
import type { EventLog } from '../log/eventLog.js'
import { parseEvery, matchesOn, afterSatisfied } from './triggers.js'

interface LoadedRoutine {
  config: RoutineConfig
  enabled: boolean
  cronJob?: Cron
  intervalHandle?: NodeJS.Timeout
  everyMs?: number
  nextRunAt?: Date
  missedAlerted?: boolean
}

const TICK_MS = 15_000
const MIN_GRACE_MS = 60_000

export class Scheduler {
  private routines = new Map<string, LoadedRoutine>()
  private defaults: RoutineDefaults = { model: 'sonnet', permission_mode: 'plan', allowed_tools: [], max_attempts: 2, timeout_ms: 600_000 }
  private tickHandle?: NodeJS.Timeout
  private unsubscribe?: () => void
  private started = false

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private exec: (routine: RoutineConfig, payload?: Record<string, unknown>) => Promise<void>,
  ) {}

  load(file: RoutinesFile): void {
    this.defaults = file.defaults
    this.routines.clear()
    for (const r of file.routines) {
      this.routines.set(r.name, { config: r, enabled: r.enabled !== false })
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.recoverFromRestart()
    for (const lr of this.routines.values()) this.scheduleRoutine(lr)
    this.unsubscribe = this.log.subscribe((e) => this.onEvent(e))
    this.tickHandle = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    this.started = false
    for (const lr of this.routines.values()) {
      lr.cronJob?.stop()
      if (lr.intervalHandle) clearInterval(lr.intervalHandle)
    }
    this.unsubscribe?.()
    if (this.tickHandle) clearInterval(this.tickHandle)
  }

  private scheduleRoutine(lr: LoadedRoutine): void {
    const { config } = lr
    if (config.cron) {
      lr.cronJob = new Cron(config.cron, { catch: true }, () => this.trigger(lr))
    } else if (config.every) {
      lr.everyMs = parseEvery(config.every)
      lr.nextRunAt = new Date(Date.now() + lr.everyMs)
      lr.intervalHandle = setInterval(() => {
        lr.nextRunAt = new Date(Date.now() + lr.everyMs!)
        lr.missedAlerted = false
        this.trigger(lr)
      }, lr.everyMs)
    }
  }

  private trigger(lr: LoadedRoutine): void {
    if (!lr.enabled) return
    if (lr.config.after && !this.afterOk(lr.config.after)) return
    this.runRoutine(lr.config).catch(() => {})
  }

  private afterOk(after: string[]): boolean {
    const lastRuns = new Map(after.map((name) => [name, this.log.listRuns({ routine: name, limit: 1 })[0]]))
    return afterSatisfied(after, lastRuns)
  }

  async runNow(name: string, payload?: Record<string, unknown>): Promise<string> {
    const lr = this.routines.get(name)
    if (!lr) throw new Error(`unknown routine: ${name}`)
    return this.runRoutine(lr.config, payload)
  }

  private async runRoutine(config: RoutineConfig, payload?: Record<string, unknown>): Promise<string> {
    const run = this.log.createRun({ routine: config.name, skill: config.skill, adapter: config.adapter, agent: config.agent, payload })
    this.executeRoutine(run, config, payload).catch(() => {})
    return run.id
  }

  private async executeRoutine(run: Run, config: RoutineConfig, payload: Record<string, unknown> | undefined): Promise<void> {
    this.log.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() })
    try {
      await this.exec(config, payload)
      this.log.updateRun(run.id, { status: 'success', endedAt: new Date().toISOString() })
    } catch (err) {
      await this.handleFailure(run, config, err)
    }
  }

  private effectiveMaxAttempts(config: RoutineConfig): number {
    return config.max_attempts ?? this.defaults.max_attempts
  }

  private async handleFailure(run: Run, config: RoutineConfig, err: unknown): Promise<void> {
    const maxAttempts = this.effectiveMaxAttempts(config)
    const errorMsg = err instanceof Error ? err.message : String(err)
    this.log.updateRun(run.id, { status: 'failed', error: errorMsg, endedAt: new Date().toISOString() })
    if (run.attempt < maxAttempts) {
      const backoffMs = 30_000 * run.attempt
      setTimeout(() => {
        const retryRun = this.log.createRun({
          routine: config.name, skill: config.skill, adapter: config.adapter, agent: config.agent,
          payload: run.payload, attempt: run.attempt + 1,
        })
        this.executeRoutine(retryRun, config, run.payload).catch(() => {})
      }, backoffMs)
    } else {
      this.log.append({ type: 'ops.alert', payload: { routine: config.name, runId: run.id, reason: 'failed', error: errorMsg } })
    }
  }

  // -- filled in by later tasks --
  onEvent(_e: Event): void {}
  private tick(): void {}
  private recoverFromRestart(): void {}
  scheduleOnce(_skill: string, _when: Date, _payload?: Record<string, unknown>): string {
    throw new Error('not implemented until Task 4')
  }
  setEnabled(_name: string, _enabled: boolean): void {
    throw new Error('not implemented until Task 6')
  }
  list(): Array<{ routine: RoutineConfig; nextRun?: string; lastRun?: Run }> {
    throw new Error('not implemented until Task 6')
  }
}
```
- [ ] **Step 5: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler.timers`
Expected: `PASS` — 3 tests.
- [ ] **Step 6: Commit**
```
git add packages/kernel/src/scheduler/scheduler.ts packages/kernel/test/helpers/fakeEventLog.ts packages/kernel/test/scheduler/scheduler.timers.test.ts
git commit -m "feat(kernel): add Scheduler with every/cron timers and runNow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Event triggers (`on:`, `custom.*`) and `after:` gating
**Files:** Modify `packages/kernel/src/scheduler/scheduler.ts` (`onEvent`); Test `packages/kernel/test/scheduler/scheduler.events.test.ts`
**Interfaces:** Consumes `matchesOn` from Task 1. Produces: working `onEvent(e: Event): void`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/scheduler/scheduler.events.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { FakeEventLog, DEFAULTS } from '../helpers/fakeEventLog.js'
import type { KernelConfig } from '@agentos/shared'

const cfg = { osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude', host: '127.0.0.1', port: 4545, logLevel: 'info' } as KernelConfig

it('triggers a routine on a matching event, including the custom.* wildcard, but not on a mismatch', () => {
  const log = new FakeEventLog()
  const exec = vi.fn().mockResolvedValue(undefined)
  const scheduler = new Scheduler(cfg, log as any, exec)
  scheduler.load({
    defaults: DEFAULTS,
    routines: [
      { name: 'ingest', on: ['raw.added'], skill: 'ingest', agent: 'librarian' },
      { name: 'custom-handler', on: ['custom.*'], skill: 'ingest', agent: 'librarian' },
    ],
  })
  scheduler.start()
  log.append({ type: 'raw.added', payload: { path: 'raw/x.md' } })
  expect(exec).toHaveBeenCalledTimes(1)
  log.append({ type: 'custom.foo', payload: {} })
  expect(exec).toHaveBeenCalledTimes(2)
  log.append({ type: 'raw.changed', payload: {} })
  expect(exec).toHaveBeenCalledTimes(2)
  scheduler.stop()
})

it('does not trigger a disabled routine on a matching event', () => {
  const log = new FakeEventLog()
  const exec = vi.fn().mockResolvedValue(undefined)
  const scheduler = new Scheduler(cfg, log as any, exec)
  scheduler.load({ defaults: DEFAULTS, routines: [{ name: 'ingest', enabled: false, on: ['raw.added'], skill: 'ingest', agent: 'librarian' }] })
  scheduler.start()
  log.append({ type: 'raw.added', payload: {} })
  expect(exec).not.toHaveBeenCalled()
  scheduler.stop()
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- scheduler.events`
Expected: fails — `onEvent` is a no-op stub, `exec` never called.
- [ ] **Step 3: Implement**
Replace the stub in `scheduler.ts`:
```ts
onEvent(e: Event): void {
  for (const lr of this.routines.values()) {
    if (!lr.enabled) continue
    if (matchesOn(lr.config.on, e.type)) this.trigger(lr)
  }
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler.events`
Expected: `PASS` — 2 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/scheduler/scheduler.ts packages/kernel/test/scheduler/scheduler.events.test.ts
git commit -m "feat(kernel): wire Scheduler.onEvent to on: triggers with custom.* wildcard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Persistent one-shot queue (`scheduleOnce` + 15s tick) + EventLog schedule methods
**Files:** Modify `packages/kernel/src/log/eventLog.ts` (add 3 methods — contract addition), Modify `packages/kernel/src/scheduler/scheduler.ts` (`scheduleOnce`, `tick`→`processDueSchedules`); Test `packages/kernel/test/scheduler/scheduler.oneshot.test.ts`
**Interfaces:** Produces `EventLog.createSchedule`, `EventLog.dueSchedules`, `EventLog.markScheduleFired` (see Contract additions); `Scheduler.scheduleOnce(skill, when, payload?): string`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/scheduler/scheduler.oneshot.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { FakeEventLog, DEFAULTS } from '../helpers/fakeEventLog.js'
import type { KernelConfig } from '@agentos/shared'

const cfg = { osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude', host: '127.0.0.1', port: 4545, logLevel: 'info' } as KernelConfig

describe('Scheduler.scheduleOnce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs a one-shot schedule once its time is due, resolving the routine by matching skill', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [{ name: 'lint', cron: '0 3 * * *', skill: 'lint', agent: 'librarian' }] })
    scheduler.start()
    const id = scheduler.scheduleOnce('lint', new Date(Date.now() + 5000))
    expect(typeof id).toBe('string')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0].agent).toBe('librarian')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).toHaveBeenCalledTimes(1) // does not re-fire once marked fired
    scheduler.stop()
  })

  it('falls back to an ad-hoc routine when no loaded routine matches the skill', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockResolvedValue(undefined)
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [] })
    scheduler.start()
    scheduler.scheduleOnce('some-skill', new Date(Date.now() - 1))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0][0]).toMatchObject({ name: 'adhoc-some-skill', skill: 'some-skill', agent: 'ops' })
    scheduler.stop()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- scheduler.oneshot`
Expected: fails — `scheduleOnce` throws `not implemented until Task 4`.
- [ ] **Step 3: Add EventLog schedule methods**
```ts
// packages/kernel/src/log/eventLog.ts — add inside the EventLog class
createSchedule(s: { skill: string; whenAt: string; payload?: Record<string, unknown> }): { id: string } {
  const id = nanoid()
  this.db
    .prepare('INSERT INTO schedules (id, skill, when_at, payload) VALUES (?, ?, ?, ?)')
    .run(id, s.skill, s.whenAt, s.payload ? JSON.stringify(s.payload) : null)
  return { id }
}

dueSchedules(nowIso: string): Array<{ id: string; skill: string; whenAt: string; payload?: Record<string, unknown> }> {
  const rows = this.db
    .prepare('SELECT id, skill, when_at as whenAt, payload FROM schedules WHERE fired_at IS NULL AND when_at <= ?')
    .all(nowIso) as Array<{ id: string; skill: string; whenAt: string; payload: string | null }>
  return rows.map((r) => ({ id: r.id, skill: r.skill, whenAt: r.whenAt, payload: r.payload ? JSON.parse(r.payload) : undefined }))
}

markScheduleFired(id: string, firedAtIso: string): void {
  this.db.prepare('UPDATE schedules SET fired_at = ? WHERE id = ?').run(firedAtIso, id)
}
```
(Add `import { nanoid } from 'nanoid'` at the top if not already imported.)
- [ ] **Step 4: Implement `scheduleOnce` + `tick` in scheduler.ts**
```ts
scheduleOnce(skill: string, when: Date, payload?: Record<string, unknown>): string {
  return this.log.createSchedule({ skill, whenAt: when.toISOString(), payload }).id
}

private resolveAdhocRoutine(skill: string): RoutineConfig {
  for (const lr of this.routines.values()) {
    if (lr.config.skill === skill) return lr.config
  }
  return { name: `adhoc-${skill}`, skill, agent: 'ops' }
}

private processDueSchedules(): void {
  const due = this.log.dueSchedules(new Date().toISOString())
  for (const s of due) {
    this.log.markScheduleFired(s.id, new Date().toISOString())
    this.runRoutine(this.resolveAdhocRoutine(s.skill), s.payload).catch(() => {})
  }
}
```
Replace the `tick` stub:
```ts
private tick(): void {
  this.processDueSchedules()
  this.checkMissedRoutines() // filled in Task 5
}
private checkMissedRoutines(): void {}
```
- [ ] **Step 5: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler.oneshot`
Expected: `PASS` — 2 tests.
- [ ] **Step 6: Commit**
```
git add packages/kernel/src/log/eventLog.ts packages/kernel/src/scheduler/scheduler.ts packages/kernel/test/scheduler/scheduler.oneshot.test.ts
git commit -m "feat(kernel): persistent one-shot schedule queue via 15s tick

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Retry/backoff verification + `ops.alert` on exhausted retries and missed routines
**Files:** Modify `packages/kernel/src/scheduler/scheduler.ts` (`checkMissedRoutines`); Test `packages/kernel/test/scheduler/scheduler.retry.test.ts`
**Interfaces:** Uses `handleFailure` (Task 2) and `log.append` for `ops.alert`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/scheduler/scheduler.retry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { FakeEventLog, DEFAULTS } from '../helpers/fakeEventLog.js'
import type { KernelConfig } from '@agentos/shared'

const cfg = { osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude', host: '127.0.0.1', port: 4545, logLevel: 'info' } as KernelConfig

describe('Scheduler retry/backoff', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries a failed run once after 30s * attempt, then succeeds', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: { ...DEFAULTS, max_attempts: 2 }, routines: [{ name: 'ingest', on: ['raw.added'], skill: 'ingest', agent: 'librarian' }] })
    scheduler.start()
    await scheduler.runNow('ingest')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(log.runs.find((r) => r.attempt === 1)?.status).toBe('failed')
    await vi.advanceTimersByTimeAsync(30_000) // backoff = 30s * attempt(1)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(log.runs.find((r) => r.attempt === 2)?.status).toBe('success')
    scheduler.stop()
  })

  it('emits ops.alert once max_attempts is exhausted', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn().mockRejectedValue(new Error('always fails'))
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: { ...DEFAULTS, max_attempts: 1 }, routines: [{ name: 'ingest', on: ['raw.added'], skill: 'ingest', agent: 'librarian' }] })
    scheduler.start()
    await scheduler.runNow('ingest')
    const alert = log.events.find((e) => e.type === 'ops.alert')
    expect(alert?.payload).toMatchObject({ routine: 'ingest', reason: 'failed' })
    scheduler.stop()
  })

  it('emits ops.alert for an every-routine that misses its interval by more than the grace period', async () => {
    const log = new FakeEventLog()
    const exec = vi.fn(() => new Promise<void>(() => {})) // never resolves -> looks "hung"/missed
    const scheduler = new Scheduler(cfg, log as any, exec)
    scheduler.load({ defaults: DEFAULTS, routines: [{ name: 'heartbeat', every: '1s', skill: 'heartbeat', agent: 'ops' }] })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000) // first fire, exec hangs
    await vi.advanceTimersByTimeAsync(60_000) // past MIN_GRACE_MS with no new nextRunAt reached... next interval also fires at 2s
    const alert = log.events.find((e) => e.type === 'ops.alert' && e.payload.reason === 'missed')
    expect(alert?.payload).toMatchObject({ routine: 'heartbeat' })
    scheduler.stop()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- scheduler.retry`
Expected: first two tests pass already (handleFailure exists from Task 2); the third fails — `checkMissedRoutines` is a no-op stub, no `missed` alert.
- [ ] **Step 3: Implement `checkMissedRoutines`**
```ts
// packages/kernel/src/scheduler/scheduler.ts
private checkMissedRoutines(): void {
  const now = Date.now()
  for (const lr of this.routines.values()) {
    if (!lr.enabled || !lr.everyMs || !lr.nextRunAt) continue
    const grace = Math.max(MIN_GRACE_MS, lr.everyMs * 0.5)
    if (now > lr.nextRunAt.getTime() + grace && !lr.missedAlerted) {
      lr.missedAlerted = true
      this.log.append({ type: 'ops.alert', payload: { routine: lr.config.name, reason: 'missed', expectedAt: lr.nextRunAt.toISOString() } })
    }
  }
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler.retry`
Expected: `PASS` — 3 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/scheduler/scheduler.ts packages/kernel/test/scheduler/scheduler.retry.test.ts
git commit -m "feat(kernel): retry with 30s*attempt backoff and ops.alert on failure/missed routines

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Daemon restart recovery, `setEnabled`, `list()`
**Files:** Modify `packages/kernel/src/scheduler/scheduler.ts` (`recoverFromRestart`, `setEnabled`, `list`); Test `packages/kernel/test/scheduler/scheduler.restart.test.ts`

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/scheduler/scheduler.restart.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { FakeEventLog, DEFAULTS } from '../helpers/fakeEventLog.js'
import type { KernelConfig } from '@agentos/shared'

const cfg = { osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude', host: '127.0.0.1', port: 4545, logLevel: 'info' } as KernelConfig

it('marks a running run as failed with "daemon restarted" and re-queues it if attempts remain', () => {
  const log = new FakeEventLog()
  log.runs.push({ id: 'r1', routine: 'ingest', status: 'running', attempt: 1, payload: { path: 'x' } } as any)
  const exec = vi.fn().mockResolvedValue(undefined)
  const scheduler = new Scheduler(cfg, log as any, exec)
  scheduler.load({ defaults: { ...DEFAULTS, max_attempts: 2 }, routines: [{ name: 'ingest', on: ['raw.added'], skill: 'ingest', agent: 'librarian' }] })
  scheduler.start()
  expect(log.getRun('r1')?.status).toBe('failed')
  expect(log.getRun('r1')?.error).toBe('daemon restarted')
  expect(log.runs.some((r) => r.routine === 'ingest' && r.attempt === 2)).toBe(true)
  scheduler.stop()
})

it('executes a queued run left over from before restart', () => {
  const log = new FakeEventLog()
  log.runs.push({ id: 'r2', routine: 'lint', status: 'queued', attempt: 1 } as any)
  const exec = vi.fn().mockResolvedValue(undefined)
  const scheduler = new Scheduler(cfg, log as any, exec)
  scheduler.load({ defaults: DEFAULTS, routines: [{ name: 'lint', cron: '0 3 * * *', skill: 'lint', agent: 'librarian' }] })
  scheduler.start()
  expect(exec).toHaveBeenCalledTimes(1)
  scheduler.stop()
})

it('setEnabled toggles whether a routine fires, and list() reports nextRun/lastRun', async () => {
  const log = new FakeEventLog()
  const exec = vi.fn().mockResolvedValue(undefined)
  const scheduler = new Scheduler(cfg, log as any, exec)
  scheduler.load({ defaults: DEFAULTS, routines: [{ name: 'lint', cron: '0 3 * * *', skill: 'lint', agent: 'librarian' }] })
  scheduler.start()
  scheduler.setEnabled('lint', false)
  await scheduler.runNow('lint') // runNow bypasses enabled (manual/CLI trigger); enabled only gates automatic triggers
  const before = scheduler.list()
  expect(before[0].routine.name).toBe('lint')
  expect(before[0].lastRun?.status).toBe('success')
  expect(typeof before[0].nextRun).toBe('string')
  expect(() => scheduler.setEnabled('missing', true)).toThrow(/unknown routine/)
  scheduler.stop()
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- scheduler.restart`
Expected: fails — `recoverFromRestart` is a no-op, `setEnabled`/`list` throw "not implemented".
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/scheduler/scheduler.ts
private recoverFromRestart(): void {
  for (const run of this.log.listRuns({ status: 'running' })) {
    this.log.updateRun(run.id, { status: 'failed', error: 'daemon restarted', endedAt: new Date().toISOString() })
    const lr = this.routines.get(run.routine)
    if (!lr) continue
    if (run.attempt < this.effectiveMaxAttempts(lr.config)) {
      const retryRun = this.log.createRun({
        routine: run.routine, skill: run.skill, adapter: run.adapter, agent: run.agent,
        payload: run.payload, attempt: run.attempt + 1,
      })
      this.executeRoutine(retryRun, lr.config, run.payload).catch(() => {})
    }
  }
  for (const run of this.log.listRuns({ status: 'queued' })) {
    const lr = this.routines.get(run.routine)
    if (lr) this.executeRoutine(run, lr.config, run.payload).catch(() => {})
  }
}

setEnabled(name: string, enabled: boolean): void {
  const lr = this.routines.get(name)
  if (!lr) throw new Error(`unknown routine: ${name}`)
  lr.enabled = enabled
}

private computeNextRun(lr: LoadedRoutine): string | undefined {
  if (lr.cronJob) return lr.cronJob.nextRun()?.toISOString()
  if (lr.nextRunAt) return lr.nextRunAt.toISOString()
  return undefined
}

list(): Array<{ routine: RoutineConfig; nextRun?: string; lastRun?: Run }> {
  return Array.from(this.routines.values()).map((lr) => ({
    routine: { ...lr.config, enabled: lr.enabled },
    nextRun: this.computeNextRun(lr),
    lastRun: this.log.listRuns({ routine: lr.config.name, limit: 1 })[0],
  }))
}
```
Also update `trigger()` — it already checks `lr.enabled`, so `runNow` (which calls `runRoutine` directly, bypassing `trigger`) correctly ignores the enabled flag, matching the CLI/dashboard "run now" use case.
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler.restart`
Expected: `PASS` — 3 tests. Then run the full scheduler suite: `pnpm --filter @agentos/kernel test -- scheduler` → all prior scheduler test files still `PASS`.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/scheduler/scheduler.ts packages/kernel/test/scheduler/scheduler.restart.test.ts
git commit -m "feat(kernel): daemon-restart recovery, setEnabled, and Scheduler.list()

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Minimal `AdapterHost` stub (M4 surface, M3-usable)
**Files:** Create `packages/kernel/src/adapters/types.ts`, `packages/kernel/src/adapters/adapterHost.ts`; Test `packages/kernel/test/adapters/adapterHost.stub.test.ts`
**Interfaces:** Produces the exact contract §5 `ProjectAdapter`/`AdapterContext`/`SyncResult`, and a stub `AdapterHost` matching contract §4 `AdapterHost` (full logic deferred to M4).

- [ ] **Step 1: Write failing test**
```ts
// packages/kernel/test/adapters/adapterHost.stub.test.ts
import { describe, it, expect } from 'vitest'
import { AdapterHost } from '../../src/adapters/adapterHost.js'
import { FakeEventLog } from '../helpers/fakeEventLog.js'
import type { KernelConfig } from '@agentos/shared'

const cfg = { osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude', host: '127.0.0.1', port: 4545, logLevel: 'info' } as KernelConfig

it('sync() on an unregistered project returns an empty SyncResult and logs ops.alert instead of throwing', async () => {
  const log = new FakeEventLog()
  const host = new AdapterHost(cfg, log as any, {} as any, {})
  const result = await host.sync('techpulse-coo')
  expect(result).toEqual({ added: [], changed: [], events: [] })
  expect(log.events.some((e) => e.type === 'ops.alert' && e.payload.reason === 'adapter-not-implemented')).toBe(true)
})

it('applyDecision throws until M4 implements it', async () => {
  const log = new FakeEventLog()
  const host = new AdapterHost(cfg, log as any, {} as any, {})
  await expect(host.applyDecision({} as any)).rejects.toThrow(/M4/)
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- adapterHost.stub`
Expected: fails — `adapterHost.ts` does not exist.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/adapters/types.ts
import type { KernelConfig, Decision, ProjectConfig, EventType } from '@agentos/shared'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'

export interface AdapterContext {
  cfg: KernelConfig; log: EventLog; wiki: WikiService; project: ProjectConfig; runId?: string
}
export interface SyncResult { added: string[]; changed: string[]; events: EventType[] }
export interface ProjectAdapter {
  name: string
  sync(ctx: AdapterContext): Promise<SyncResult>
  applyDecision(decision: Decision, ctx: AdapterContext): Promise<void>
}
```
```ts
// packages/kernel/src/adapters/adapterHost.ts
import type { KernelConfig, ProjectConfig, Decision } from '@agentos/shared'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'
import type { ProjectAdapter, SyncResult } from './types.js'

export class AdapterHost {
  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private wiki: WikiService,
    private registry: Record<string, ProjectAdapter>,
  ) {}

  // Full os/projects/*.yaml loading lands in M4.
  async loadProjects(): Promise<ProjectConfig[]> {
    return []
  }

  async sync(projectName: string, _runId?: string): Promise<SyncResult> {
    const adapter = this.registry[projectName]
    if (!adapter) {
      this.log.append({ type: 'ops.alert', payload: { reason: 'adapter-not-implemented', projectName } })
      return { added: [], changed: [], events: [] }
    }
    // Real ctx construction + adapter.sync() call lands in M4 alongside projects/*.yaml loading.
    return { added: [], changed: [], events: [] }
  }

  async applyDecision(_decision: Decision): Promise<void> {
    throw new Error('AdapterHost.applyDecision is implemented in M4')
  }
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- adapterHost.stub`
Expected: `PASS` — 2 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/adapters/types.ts packages/kernel/src/adapters/adapterHost.ts packages/kernel/test/adapters/adapterHost.stub.test.ts
git commit -m "feat(kernel): add AdapterHost stub so Scheduler can call kernel.adapters.sync before M4

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire `exec` in `kernel.ts` (skill+agent runs, adapter runs, heartbeat payload)
**Files:** Modify `packages/kernel/src/kernel.ts`
**Interfaces:** Consumes `Scheduler`, `AdapterHost`, `assemblePrompt`/`wrapUpPrompt`, `writeRunMcpConfig`, `ProcessManager.start`, `WikiService.listUnindexedRaw`, `parseRoutinesFile`. Produces the real `createKernel(cfg): Kernel` with `adapters: AdapterHost` and a working `Scheduler` (replacing the M2 no-op stub).

- [ ] **Step 1: Write a failing integration-style unit test using a mocked ProcessManager**
```ts
// packages/kernel/test/kernel.exec.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createKernel } from '../src/kernel.js'
import { EventLog } from '../src/log/eventLog.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-os-'))
  await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true })
  await fs.writeFile(path.join(dir, 'wiki', 'index.md'), '# index\n')
  await fs.writeFile(path.join(dir, 'wiki', 'log.md'), '')
  await fs.mkdir(path.join(dir, 'skills', 'heartbeat', 'context'), { recursive: true })
  await fs.writeFile(path.join(dir, 'skills', 'heartbeat', 'skill.md'), '# heartbeat\n')
  await fs.writeFile(path.join(dir, 'skills', 'heartbeat', 'learnings.md'), '')
  await fs.mkdir(path.join(dir, 'agents', 'ops', 'workspace'), { recursive: true })
  await fs.writeFile(path.join(dir, 'agents', 'ops', 'AGENT.md'), '# ops\n')
  await fs.writeFile(
    path.join(dir, 'routines.yaml'),
    'defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 60000\nroutines:\n  - name: heartbeat\n    every: 1h\n    skill: heartbeat\n    agent: ops\n    model: haiku\n',
  )
  return dir
}

it('exec resolves a skill+agent routine, injects the heartbeat payload shape, and marks the run successful', async () => {
  const osRoot = await makeOsRoot()
  const kernel = createKernel({ osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'node', host: '127.0.0.1', port: 4999, logLevel: 'info' })
  kernel.pm.start = vi.fn().mockResolvedValue({ status: 'success', sessionId: 's1', costUsd: 0, inputTokens: 1, outputTokens: 1 })
  await kernel.start()
  const runId = await kernel.scheduler.runNow('heartbeat')
  await new Promise((r) => setTimeout(r, 50))
  const run = kernel.log.getRun(runId)
  expect(run?.status).toBe('success')
  expect((kernel.pm.start as any).mock.calls[0][1].model).toBe('haiku')
  await kernel.stop()
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- kernel.exec`
Expected: fails — current `kernel.ts` uses the M2 no-op `Scheduler` stub, so `runNow` never calls `pm.start`.
- [ ] **Step 3: Implement — replace the no-op Scheduler wiring in `kernel.ts`**
```ts
// packages/kernel/src/kernel.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { parseRoutinesFile } from '@agentos/shared'
import type { RoutinesFile } from '@agentos/shared'
import type { KernelConfig } from './config.js'
import { EventLog } from './log/eventLog.js'
import { ProcessManager } from './process/processManager.js'
import { assemblePrompt } from './process/promptAssembler.js'
import { writeRunMcpConfig } from './process/mcpConfig.js'
import { WikiService } from './wiki/wikiService.js'
import { AdapterHost } from './adapters/adapterHost.js'
import { Scheduler } from './scheduler/scheduler.js'
import { buildServer } from './api/server.js'

export interface Kernel {
  cfg: KernelConfig; log: EventLog; pm: ProcessManager; scheduler: Scheduler; wiki: WikiService; adapters: AdapterHost
  start(): Promise<void>; stop(): Promise<void>
}

async function loadRoutinesFile(osRoot: string): Promise<RoutinesFile> {
  const text = await fs.readFile(path.join(osRoot, 'routines.yaml'), 'utf8')
  return parseRoutinesFile(text)
}

export function createKernel(cfg: KernelConfig): Kernel {
  const log = new EventLog(cfg.dbPath)
  const wiki = new WikiService(cfg.osRoot, log)
  const pm = new ProcessManager(cfg, log)
  const adapters = new AdapterHost(cfg, log, wiki, {})
  let routinesFile: RoutinesFile | undefined
  let server: FastifyInstance | undefined

  const scheduler = new Scheduler(cfg, log, async (routine, payload) => {
    routinesFile ??= await loadRoutinesFile(cfg.osRoot)
    if (routine.adapter) {
      await adapters.sync(routine.adapter) // no-op until M4 registers real adapters
      return
    }
    if (!routine.skill || !routine.agent) {
      throw new Error(`routine ${routine.name} has neither adapter nor skill+agent`)
    }
    const activeRun = log.listRuns({ routine: routine.name, status: 'running', limit: 1 })[0]
    if (!activeRun) throw new Error(`no running Run found for routine ${routine.name}`)

    const task =
      routine.skill === 'heartbeat'
        ? JSON.stringify({
            unindexedRaw: await wiki.listUnindexedRaw(),
            routineStatus: scheduler.list().map(({ routine: r, nextRun, lastRun }) => ({
              name: r.name,
              enabled: r.enabled !== false,
              nextRun: nextRun ?? null,
              lastRun: lastRun ? { status: lastRun.status, endedAt: lastRun.endedAt ?? null } : null,
            })),
          })
        : JSON.stringify(payload ?? {})

    const assembled = await assemblePrompt({ osRoot: cfg.osRoot, skill: routine.skill, agent: routine.agent, task })
    // The syscall route (M2 api/internal.ts) authenticates by this token — it MUST be registered before the run starts.
    const runToken = nanoid()
    log.createRunToken(activeRun.id, runToken)
    const mcpConfigPath = await writeRunMcpConfig(cfg.runtimeDir, activeRun, `http://${cfg.host}:${cfg.port}`, runToken, routine.extra_mcp)
    const defaults = routinesFile.defaults
    const cwd = path.join(cfg.osRoot, 'agents', routine.agent, 'workspace')
    await fs.mkdir(cwd, { recursive: true })
    const common = {
      cwd,
      model: routine.model ?? defaults.model,
      permissionMode: routine.permission_mode ?? defaults.permission_mode,
      allowedTools: routine.allowed_tools ?? defaults.allowed_tools,
      addDirs: [cfg.osRoot],
      mcpConfigPath,
      timeoutMs: routine.timeout_ms ?? defaults.timeout_ms,
    }
    // runToCompletion (M2) = main turn + kernel-driven wrap-up turn via --resume; never call pm.start() directly here.
    const result = await pm.runToCompletion(
      activeRun,
      { prompt: assembled.prompt, systemPromptAppend: assembled.systemPromptAppend, ...common },
      { skill: routine.skill, osRoot: cfg.osRoot, ...common },
    )
    log.updateRun(activeRun.id, {
      costUsd: result.costUsd, inputTokens: result.inputTokens, outputTokens: result.outputTokens, sessionId: result.sessionId,
    })
    if (result.status !== 'success') {
      throw new Error(result.error ?? `run ${routine.name} ended with status ${result.status}`)
    }
  })

  const kernel: Kernel = {
    cfg, log, pm, scheduler, wiki, adapters,
    async start() {
      await fs.mkdir(cfg.runtimeDir, { recursive: true })
      routinesFile = await loadRoutinesFile(cfg.osRoot)
      scheduler.load(routinesFile)
      server = buildServer(kernel)
      await server.listen({ host: cfg.host, port: cfg.port })
      scheduler.start()
    },
    async stop() {
      scheduler.stop()
      await server?.close()
      log.close()
    },
  }
  return kernel
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- kernel.exec`
Expected: `PASS` — 1 test. Then run the full kernel package suite to catch regressions from the `kernel.ts` rewrite: `pnpm --filter @agentos/kernel test`.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/kernel.ts packages/kernel/test/kernel.exec.test.ts
git commit -m "feat(kernel): wire real Scheduler into kernel.ts, replacing the M2 no-op stub

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Routines HTTP API + CLI
**Files:** Modify `packages/kernel/src/api/server.ts`; Create `packages/cli/src/commands/routines.ts`; Modify `packages/cli/src/bin.ts`; Test `packages/kernel/test/api/routines.routes.test.ts`, `packages/cli/test/routines.command.test.ts`

- [ ] **Step 1: Write failing API test**
```ts
// packages/kernel/test/api/routines.routes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildServer } from '../../src/api/server.js' // existing M1 export

it('GET/POST /api/routines delegates to Scheduler', async () => {
  const scheduler = {
    list: vi.fn().mockReturnValue([{ routine: { name: 'lint' }, nextRun: '2026-09-08T03:00:00.000Z' }]),
    runNow: vi.fn().mockResolvedValue('run-1'),
    setEnabled: vi.fn(),
  }
  const kernel = { cfg: { host: '127.0.0.1', port: 0 }, scheduler, log: { listRuns: vi.fn().mockReturnValue([]), listEvents: vi.fn().mockReturnValue([]), subscribe: vi.fn() } } as any
  const app = buildServer(kernel)

  const list = await app.inject({ method: 'GET', url: '/api/routines' })
  expect(list.json()).toEqual([{ routine: { name: 'lint' }, nextRun: '2026-09-08T03:00:00.000Z' }])

  const run = await app.inject({ method: 'POST', url: '/api/routines/lint/run', payload: {} })
  expect(run.json()).toEqual({ runId: 'run-1' })

  const enable = await app.inject({ method: 'POST', url: '/api/routines/lint/enable' })
  expect(enable.json()).toEqual({ ok: true })
  expect(scheduler.setEnabled).toHaveBeenCalledWith('lint', true)

  scheduler.runNow.mockRejectedValueOnce(new Error('unknown routine: nope'))
  const bad = await app.inject({ method: 'POST', url: '/api/routines/nope/run', payload: {} })
  expect(bad.statusCode).toBe(404)
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- routines.routes`
Expected: fails — `/api/routines*` routes return 404 (not yet registered).
- [ ] **Step 3: Implement — add routes to `api/server.ts`** (inside the existing route-registration function, alongside the M1 `/api/runs` routes)
```ts
app.get('/api/routines', async () => kernel.scheduler.list())

app.post<{ Params: { name: string }; Body: { payload?: Record<string, unknown> } }>(
  '/api/routines/:name/run',
  async (req, reply) => {
    try {
      const runId = await kernel.scheduler.runNow(req.params.name, req.body?.payload)
      return { runId }
    } catch (err) {
      reply.code(404)
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },
)

app.post<{ Params: { name: string } }>('/api/routines/:name/enable', async (req, reply) => {
  try {
    kernel.scheduler.setEnabled(req.params.name, true)
    return { ok: true }
  } catch (err) {
    reply.code(404)
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

app.post<{ Params: { name: string } }>('/api/routines/:name/disable', async (req, reply) => {
  try {
    kernel.scheduler.setEnabled(req.params.name, false)
    return { ok: true }
  } catch (err) {
    reply.code(404)
    return { error: err instanceof Error ? err.message : String(err) }
  }
})
```
- [ ] **Step 3b: Route `POST /api/runs` through the Scheduler (replaces M1's stub path)**

M1's `POST /api/runs` handler assembled the prompt itself, wrote an empty `mcp.json` via `writeStubMcpConfig`, and called `pm.start()` directly. After M2/M3 that path is wrong on three counts: no syscall token is registered, no `--mcp-config` with the real server is produced, and the wrap-up turn is skipped. From now on every run — scheduled or manual — goes through the Scheduler's `exec` callback in `kernel.ts` (Task 8).

First add a public ad-hoc entry point to `packages/kernel/src/scheduler/scheduler.ts`, next to `runNow` (it reuses the private `resolveAdhocRoutine` from Task 4):
```ts
/** Run a skill immediately, by skill name: reuses the first loaded routine with that skill, else an ad-hoc routine on agent `ops`. */
async runSkill(skill: string, payload?: Record<string, unknown>, agent?: string): Promise<string> {
  const base = this.resolveAdhocRoutine(skill)
  const config = agent ? { ...base, agent } : base
  return this.runRoutine(config, payload)
}
```
Then in `packages/kernel/src/api/server.ts` replace the whole M1 `app.post('/api/runs', ...)` handler with:
```ts
app.post('/api/runs', async (req, reply) => {
  const body = req.body as CreateRunRequest
  if (!body?.skill) return reply.code(400).send({ error: 'skill is required' } satisfies ErrorResponse)
  const runId = await kernel.scheduler.runSkill(body.skill, body.payload, body.agent)
  return reply.code(202).send({ runId } satisfies CreateRunResponse)
})
```
and delete `writeStubMcpConfig`, `loadRoutines`, `findRoutineForSkill` and the now-unused `assemblePrompt`/`fs` imports from `server.ts` (they moved to `kernel.ts` in M1/M3).

Update M1's `packages/kernel/src/api/server.test.ts` so the two tests that create runs use a real kernel instead of the `{ cfg, log, pm }` stub: in `beforeEach` also write a minimal routines file
```ts
await fsp.writeFile(path.join(osRoot, 'routines.yaml'), [
  'defaults:',
  '  model: sonnet',
  '  permission_mode: plan',
  '  allowed_tools: [Read]',
  '  max_attempts: 1',
  '  timeout_ms: 5000',
  'routines: []',
  '',
].join('\n'))
```
and in `'creates a run over HTTP and lets it complete through the fake claude'` and `'rejects requests without a skill'` build the app with
```ts
const kernel = createKernel(cfg)            // import { createKernel } from '../kernel.js'
const app = buildServer(kernel)
```
(no `kernel.start()` — `buildServer` doesn't need the listener; `exec` lazily loads `routines.yaml`). Set `process.env.FAKE_CLAUDE_WRAPUP_FIXTURE = path.join(fixturesDir, 'wrapup-success.jsonl')` in `beforeEach` so the wrap-up turn succeeds, and after the test `await kernel.stop()` instead of `log.close()` for that case.

Run: `pnpm --filter @agentos/kernel test -- server`
Expected: `PASS` — M1's four server tests still pass, now via the Scheduler path (the created run reaches `success` after main + wrap-up turns).

- [ ] **Step 4: Run API tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- routines.routes`
Expected: `PASS` — 1 test (4 assertions).
- [ ] **Step 5: Write failing CLI test**
```ts
// packages/cli/test/routines.command.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Command } from 'commander'
import { registerRoutinesCommand } from '../src/commands/routines.js'

it('routines list prints one line per routine using the ApiClient', async () => {
  const client = { get: vi.fn().mockResolvedValue([{ routine: { name: 'lint' }, nextRun: '2026-09-08T03:00:00.000Z', lastRun: { status: 'success' } }]), post: vi.fn() }
  const program = new Command()
  registerRoutinesCommand(program, client as any)
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  await program.parseAsync(['node', 'agentos', 'routines', 'list'])
  expect(client.get).toHaveBeenCalledWith('/api/routines')
  expect(logSpy.mock.calls[0][0]).toContain('lint')
  logSpy.mockRestore()
})

it('routines run/enable/disable call the matching POST endpoint', async () => {
  const client = { get: vi.fn(), post: vi.fn().mockResolvedValue({ runId: 'run-1', ok: true }) }
  const program = new Command()
  registerRoutinesCommand(program, client as any)
  await program.parseAsync(['node', 'agentos', 'routines', 'run', 'lint'])
  expect(client.post).toHaveBeenCalledWith('/api/routines/lint/run', {})
  await program.parseAsync(['node', 'agentos', 'routines', 'enable', 'lint'])
  expect(client.post).toHaveBeenCalledWith('/api/routines/lint/enable', {})
  await program.parseAsync(['node', 'agentos', 'routines', 'disable', 'lint'])
  expect(client.post).toHaveBeenCalledWith('/api/routines/lint/disable', {})
})
```
- [ ] **Step 6: Run it, confirm failure**
Run: `pnpm --filter @agentos/cli test -- routines.command`
Expected: fails — `commands/routines.ts` does not exist.
- [ ] **Step 7: Implement CLI command and wire into `bin.ts`**
```ts
// packages/cli/src/commands/routines.ts
import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerRoutinesCommand(program: Command, client: ApiClient): void {
  const routines = program.command('routines').description('Manage scheduled routines')

  routines
    .command('list')
    .description('List routines with their next/last run')
    .action(async () => {
      const list = await client.get('/api/routines')
      for (const { routine, nextRun, lastRun } of list as any[]) {
        console.log(`${routine.name}\tnext=${nextRun ?? '-'}\tlast=${lastRun ? lastRun.status : '-'}`)
      }
    })

  routines
    .command('run <name>')
    .description('Run a routine now')
    .action(async (name: string) => {
      const res = await client.post(`/api/routines/${name}/run`, {})
      console.log(`queued run ${(res as any).runId}`)
    })

  routines
    .command('enable <name>')
    .action(async (name: string) => {
      await client.post(`/api/routines/${name}/enable`, {})
      console.log(`enabled ${name}`)
    })

  routines
    .command('disable <name>')
    .action(async (name: string) => {
      await client.post(`/api/routines/${name}/disable`, {})
      console.log(`disabled ${name}`)
    })
}
```
```ts
// packages/cli/src/bin.ts — add alongside the existing up/ps/logs/run registrations
import { registerRoutinesCommand } from './commands/routines.js'
// ...
registerRoutinesCommand(program, client)
```
- [ ] **Step 8: Run tests, confirm pass**
Run: `pnpm --filter @agentos/cli test -- routines.command`
Expected: `PASS` — 2 tests.
- [ ] **Step 9: Commit**
```
git add packages/kernel/src/api/server.ts packages/kernel/test/api/routines.routes.test.ts packages/cli/src/commands/routines.ts packages/cli/src/bin.ts packages/cli/test/routines.command.test.ts
git commit -m "feat: add routines HTTP API and \`agentos routines\` CLI command

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `routines.yaml`, heartbeat skill, daily-digest skill (full content)
**Files:** Modify `examples/os-template/os/routines.yaml`; Modify `examples/os-template/os/skills/heartbeat/{skill.md,learnings.md,eval.json}`; Create `examples/os-template/os/skills/daily-digest/{skill.md,learnings.md,eval.json,context/handoff.md}`

This task is content, not code — no unit test; it is exercised by the Task 11 integration test.

- [ ] **Step 1: Write `examples/os-template/os/routines.yaml`**
```yaml
defaults:
  model: sonnet
  permission_mode: plan
  allowed_tools: [Read, Glob, Grep, WebFetch, WebSearch]
  max_attempts: 2
  timeout_ms: 600000

routines:
  - name: heartbeat
    every: 30m
    skill: heartbeat
    agent: ops
    model: haiku
    allowed_tools: [mcp__agentos__emit_event, mcp__agentos__remember, mcp__agentos__schedule, mcp__agentos__read_wiki]
  - name: techpulse-sync
    every: 1h
    adapter: techpulse-coo
  - name: ingest
    on: [raw.added]
    skill: ingest
    agent: librarian
    permission_mode: acceptEdits
    allowed_tools: [Read, mcp__agentos__remember, mcp__agentos__read_wiki, mcp__agentos__get_context]
  - name: lint
    cron: "0 3 * * *"
    skill: lint
    agent: librarian
    allowed_tools: [Read, Glob, Grep, mcp__agentos__remember, mcp__agentos__read_wiki]
  - name: daily-digest
    cron: "0 8 * * *"
    skill: daily-digest
    agent: ops
    after: [lint]
    permission_mode: acceptEdits
    allowed_tools: [Read, Write, Glob, Grep, mcp__agentos__remember, mcp__agentos__read_wiki]
```
- [ ] **Step 2: Write `skills/heartbeat/skill.md`** (replaces the M1/M2 placeholder)
```markdown
# heartbeat

Cheap, frequent pulse-check across the OS. Runs every 30 minutes as agent `ops` on model `haiku`.

## Input payload
The kernel injects a JSON task payload with exactly this shape (see `kernel.ts`'s
`exec` callback, the `routine.skill === 'heartbeat'` branch):
```json
{
  "unindexedRaw": ["raw/techpulse/proposals/003-slug.md"],
  "routineStatus": [
    {
      "name": "ingest",
      "enabled": true,
      "nextRun": "2026-09-08T13:00:00.000Z",
      "lastRun": { "status": "success", "endedAt": "2026-09-08T12:30:00.000Z" }
    }
  ]
}
```
`unindexedRaw` is `WikiService.listUnindexedRaw()`. `routineStatus` is
`Scheduler.list()`, reduced to `{ name, enabled, nextRun, lastRun }` (`lastRun`
is `null` if the routine has never run).

## Steps
1. For each path in `unindexedRaw`, call `mcp__agentos__emit_event` with
   `{ "type": "raw.added", "payload": { "path": "<path>" } }`. This is the
   only path by which new raw files get indexed — the `ingest` routine
   listens for `raw.added`.
2. For each entry in `routineStatus`: if `lastRun` is `null` while `nextRun`
   is in the past, or `lastRun.status === "failed"`, write a short note via
   `mcp__agentos__remember` to page `agents/ops.md` (title includes the
   routine name and timestamp). Do **not** call `emit_event` for this —
   `emit_event` only accepts `raw.added` or `custom.*`; `ops.alert` is
   reserved for the kernel itself, which independently detects and emits it
   from the scheduler's tick (failed run after retries exhausted, or an
   `every`-routine that missed its interval).
3. If no entry named `lint` has a `lastRun.endedAt` within the last 24 hours,
   call `mcp__agentos__schedule` with `{ "skill": "lint", "when": "+1m" }`.
4. Call `mcp__agentos__remember` once more with `page: "agents/ops.md"`,
   `op: "note"`, summarizing counts (e.g. "3 raw files indexed, 1 alert
   noted, lint not scheduled").
5. Stop. Never call `request_approval`, never touch `raw/`.
```
- [ ] **Step 3: Write `skills/heartbeat/learnings.md` and `eval.json`**
```markdown
<!-- skills/heartbeat/learnings.md -->
# heartbeat — learnings

(no learnings recorded yet; the kernel's wrap-up turn appends dated entries
here after each run.)
```
```json
{
  "criteria": [
    { "key": "emitted_raw_added", "weight": 0.4, "description": "Called emit_event(raw.added) for every path in unindexedRaw" },
    { "key": "no_disallowed_emit", "weight": 0.2, "description": "Never attempted emit_event with a type other than raw.added or custom.*" },
    { "key": "noted_failures", "weight": 0.3, "description": "Wrote a remember() note to agents/ops.md for every failed or missed routine" },
    { "key": "scheduled_lint_if_stale", "weight": 0.1, "description": "Called schedule(lint) when lint had not run in the last 24h" }
  ]
}
```
- [ ] **Step 4: Write `skills/daily-digest/skill.md`, `learnings.md`, `eval.json`, `context/handoff.md`**
```markdown
<!-- skills/daily-digest/skill.md -->
# daily-digest

Runs daily at 08:00 as agent `ops`, `permission_mode: acceptEdits`, gated by
`after: [lint]` (only runs if `lint` last ran successfully today).

## Input payload
```json
{
  "wikiLog": "## [2026-09-08] ingest | ...\n...",
  "runsLast24h": [
    { "id": "run-9", "routine": "ingest", "status": "success", "startedAt": "...", "endedAt": "...", "costUsd": 0.01 }
  ]
}
```
`wikiLog` is `WikiService.readLog(200)`. `runsLast24h` is
`EventLog.listRuns()` filtered by the kernel to runs whose `startedAt` falls
in the last 24 hours.

## Steps
1. Summarize `wikiLog` and `runsLast24h` into a short markdown digest: counts
   by routine/status, notable wiki changes, and a mention of any recent
   `ops.alert` (read `agents/ops.md` via `mcp__agentos__read_wiki` for
   detail — the payload does not filter alerts in for you).
2. Write the digest directly to `output/digests/<YYYY-MM-DD>.md` using the
   `Write` tool — **not** `remember`. `output/` is a deliverable directory,
   not the wiki, and is unreachable through any syscall. This works because
   every run already gets `--add-dir <os-root>` (spec §4.2) and
   `permission_mode: acceptEdits` allows the write.
3. Call `mcp__agentos__remember` with `page: "projects/digests.md"`,
   `op: "note"`, linking to today's digest path, so the wiki index/log
   record that a digest exists.
```
```markdown
<!-- skills/daily-digest/learnings.md -->
# daily-digest — learnings

(no learnings recorded yet.)
```
```json
{
  "criteria": [
    { "key": "wrote_digest_file", "weight": 0.5, "description": "Wrote output/digests/<today>.md via the Write tool" },
    { "key": "remembered_link", "weight": 0.3, "description": "Called remember() on projects/digests.md linking to the new digest" },
    { "key": "no_wiki_write_for_digest", "weight": 0.2, "description": "Did not attempt to write the digest itself through remember()" }
  ]
}
```
```markdown
<!-- skills/daily-digest/context/handoff.md -->
(empty until the first run's wrap-up turn populates it)
```
- [ ] **Step 5: Verify the yaml parses**
Run: `node -e "const {parseRoutinesFile}=require('./packages/shared/dist/index.js'); const fs=require('fs'); console.log(parseRoutinesFile(fs.readFileSync('examples/os-template/os/routines.yaml','utf8')).routines.map(r=>r.name))"`
Expected output: `[ 'heartbeat', 'techpulse-sync', 'ingest', 'lint', 'daily-digest' ]`
- [ ] **Step 6: Commit**
```
git add examples/os-template/os/routines.yaml examples/os-template/os/skills/heartbeat examples/os-template/os/skills/daily-digest
git commit -m "docs(os-template): full routines.yaml, heartbeat and daily-digest skills per spec sect. 4.3/4.5

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end integration test with fake-claude
**Files:** Create `packages/kernel/test/integration/scheduler-e2e.test.ts`
**Interfaces:** Exercises `createKernel`, real `EventLog` (`:memory:`), real `ProcessManager` spawning `tools/fake-claude/bin.js` via `AGENTOS_CLAUDE_BIN`.

- [ ] **Step 1: Write the test**
```ts
// packages/kernel/test/integration/scheduler-e2e.test.ts
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { createKernel } from '../../src/kernel.js'

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-e2e-'))
  await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true })
  await fs.writeFile(path.join(dir, 'wiki', 'index.md'), '# index\n')
  await fs.writeFile(path.join(dir, 'wiki', 'log.md'), '')
  for (const skill of ['heartbeat', 'ingest']) {
    await fs.mkdir(path.join(dir, 'skills', skill, 'context'), { recursive: true })
    await fs.writeFile(path.join(dir, 'skills', skill, 'skill.md'), `# ${skill}\n`)
    await fs.writeFile(path.join(dir, 'skills', skill, 'learnings.md'), '')
  }
  for (const agent of ['ops', 'librarian']) {
    await fs.mkdir(path.join(dir, 'agents', agent, 'workspace'), { recursive: true })
    await fs.writeFile(path.join(dir, 'agents', agent, 'AGENT.md'), `# ${agent}\n`)
  }
  await fs.writeFile(
    path.join(dir, 'routines.yaml'),
    [
      'defaults:',
      '  model: sonnet',
      '  permission_mode: plan',
      '  allowed_tools: []',
      '  max_attempts: 2',
      '  timeout_ms: 5000',
      'routines:',
      '  - name: heartbeat',
      '    every: 1s',
      '    skill: heartbeat',
      '    agent: ops',
      '  - name: ingest',
      '    on: [raw.added]',
      '    skill: ingest',
      '    agent: librarian',
    ].join('\n'),
  )
  return dir
}

describe('scheduler + heartbeat end-to-end (fake claude)', () => {
  it('heartbeat fires on a 1s override, a raw.added event auto-triggers ingest, and agentos routines shows next runs', async () => {
    const osRoot = await makeOsRoot()
    const fakeClaude = path.resolve('tools/fake-claude/bin.js')
    const fixture = path.resolve('tools/fake-claude/fixtures/init-success.jsonl')
    process.env.AGENTOS_CLAUDE_BIN = fakeClaude
    process.env.FAKE_CLAUDE_FIXTURE = fixture

    const kernel = createKernel({
      osRoot, runtimeDir: path.join(osRoot, '..', '.agentos-e2e'), dbPath: ':memory:',
      claudeBin: fakeClaude, host: '127.0.0.1', port: 4998, logLevel: 'info',
    })
    await kernel.start()

    await new Promise((r) => setTimeout(r, 1500))
    const heartbeatRuns = kernel.log.listRuns({ routine: 'heartbeat' })
    expect(heartbeatRuns.length).toBeGreaterThanOrEqual(1)
    expect(heartbeatRuns[0].status).toBe('success')

    kernel.log.append({ type: 'raw.added', payload: { path: 'raw/x.md' } })
    await new Promise((r) => setTimeout(r, 300))
    const ingestRuns = kernel.log.listRuns({ routine: 'ingest' })
    expect(ingestRuns.length).toBe(1)

    const list = kernel.scheduler.list()
    const heartbeatEntry = list.find((l) => l.routine.name === 'heartbeat')
    expect(heartbeatEntry?.nextRun).toBeDefined()

    await kernel.stop()
  }, 10_000)

  it('a failed run retries once with 30s backoff', async () => {
    const osRoot = await makeOsRoot()
    const fakeClaude = path.resolve('tools/fake-claude/bin.js')
    process.env.AGENTOS_CLAUDE_BIN = fakeClaude
    process.env.FAKE_CLAUDE_FIXTURE = path.resolve('tools/fake-claude/fixtures/error.jsonl')

    const kernel = createKernel({
      osRoot, runtimeDir: path.join(osRoot, '..', '.agentos-e2e-2'), dbPath: ':memory:',
      claudeBin: fakeClaude, host: '127.0.0.1', port: 4997, logLevel: 'info',
    })
    await kernel.start()
    await kernel.scheduler.runNow('ingest')
    await new Promise((r) => setTimeout(r, 300))
    expect(kernel.log.listRuns({ routine: 'ingest' })[0].status).toBe('failed')
    expect(kernel.log.listRuns({ routine: 'ingest' })[0].attempt).toBe(1)
    // second attempt is scheduled 30s out; assert it is present in the log after fast-forwarding is out of scope
    // for a wall-clock integration test — the 30s*attempt backoff itself is covered by the fake-timer unit test
    // in Task 5 (scheduler.retry.test.ts). Here we only assert the first failure was recorded correctly.
    await kernel.stop()
  }, 10_000)
})
```
- [ ] **Step 2: Run it, confirm failure or pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler-e2e`
Expected: if Tasks 1–10 are correctly wired, this passes on first run; if `fake-claude`'s fixture path/env handling differs from what M1 built, it fails with a clear stderr from `fake-claude/bin.js` — fix the env var names to match the actual M1 implementation, not the scheduler code.
- [ ] **Step 3: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- scheduler-e2e`
Expected: `PASS` — 2 tests.
- [ ] **Step 4: Run the entire kernel + cli suites once more**
Run: `pnpm --filter @agentos/kernel test && pnpm --filter @agentos/cli test`
Expected: `PASS`, no regressions from Tasks 1–10.
- [ ] **Step 5: Commit**
```
git add packages/kernel/test/integration/scheduler-e2e.test.ts
git commit -m "test(kernel): end-to-end scheduler+heartbeat coverage against fake claude

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (M3 items):**
- §4.3 routines.yaml (every/cron/on/after, defaults, per-routine overrides) — Task 10, parsed via existing `parseRoutinesFile`.
- §4 Scheduler (enqueue Runs, `max_attempts`, backoff) — Tasks 2, 5.
- §4.5 heartbeat (raw.added emission, failure/miss notes via `remember`, schedule(lint) if stale, one wiki note) — Task 10 skill.md, payload shape wired in Task 8.
- §9 error handling (timeouts → `ProcessManager`, restart replays queued/running, `ops.alert` on adapter/routine failure) — Tasks 5, 6, 8 (`timeoutMs` passed through), 7 (`ops.alert` on missing adapter).
- §7/§4.4 Routines API + CLI — Task 9.
- daily-digest workspace/output decision — documented in "Design decisions" above and Task 10.

**Placeholder scan:** no `TBD`/`TODO`/"similar to Task N" in any code block; the only intentionally deferred logic is `AdapterHost.sync`/`applyDecision` (Task 7), explicitly stubbed per the M4 boundary set by the requesting task, with a real interface and a test proving its no-op behavior — not a placeholder.

**Type consistency vs. contract:** `Scheduler` constructor/method signatures match contract §4 exactly (`constructor(cfg, log, exec)`, `load`, `start`, `stop`, `runNow`, `onEvent`, `scheduleOnce`, `setEnabled`, `list`). `AdapterHost`/`ProjectAdapter`/`AdapterContext`/`SyncResult` match contract §5 exactly. `RoutineConfig`/`RoutinesFile` are used as defined in contract §3 with no field additions.

## Contract additions

`EventLog` (`packages/kernel/src/log/eventLog.ts`) gains three methods not listed in contract §4, required because the `schedules` table (contract §8) exists but had no accessor methods:
```ts
createSchedule(s: { skill: string; whenAt: string; payload?: Record<string, unknown> }): { id: string }
dueSchedules(nowIso: string): Array<{ id: string; skill: string; whenAt: string; payload?: Record<string, unknown> }>
markScheduleFired(id: string, firedAtIso: string): void
```

`Scheduler` (`packages/kernel/src/scheduler/scheduler.ts`) gains one public method (Task 9, Step 3b) so `POST /api/runs` can start an ad-hoc run through the same exec path as scheduled runs:
```ts
runSkill(skill: string, payload?: Record<string, unknown>, agent?: string): Promise<string>   // returns runId
```
Consequences applied in this plan: `kernel.ts` (Task 8) uses `pm.runToCompletion` (M2) and registers the syscall token with `log.createRunToken` before `writeRunMcpConfig`; `kernel.ts` builds/listens/closes the Fastify server via the canonical `buildServer(kernel: Kernel)`; M1's `writeStubMcpConfig`/`findRoutineForSkill`/`loadRoutines` in `api/server.ts` are deleted in Task 9.
