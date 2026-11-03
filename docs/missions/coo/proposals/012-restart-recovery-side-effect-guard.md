---
status: proposed
attempts: 0
branch: null
---
# Stop restart recovery from silently re-running work that already wrote to memory

## What you get
When the daemon restarts in the middle of a run, agent-os stops blindly
re-running that run from scratch. If the run had already written to the
wiki, created a decision, or pushed a git commit before the crash, it is
left failed with a clear alert instead of being retried — so you never end
up with a duplicated wiki log line, a doubled decision, or a confusing
double commit from one real event. Runs that crashed before doing anything
durable still retry automatically, exactly as today.

## Why start this now
This is a real gap in the already-shipped restart logic, not a
hypothetical: `recoverFromRestart()` in the scheduler today treats every
run still marked "running" the same way — mark it failed, then
unconditionally spin up a fresh retry with the same payload
(`packages/kernel/src/scheduler/scheduler.ts`). That is correct for a run
that crashed before doing anything, but an ingest or adapter run can crash
*after* it has already called `remember` (which appends to the wiki's
append-only `log.md`) or already pushed a decision/commit, and *before*
its wrap-up turn finishes — the run status stays "running" the whole time
(`packages/kernel/src/process/processManager.ts`), so restart recovery
can't currently tell "never started" apart from "already did real,
hard-to-undo work." Current agent-memory practice treats exactly this as
the main failure mode to guard against: 2026 write-ups on production agent
memory call out that most agent failures come from memory architecture
gaps rather than the model itself, and recommend not re-running work whose
effects already landed (mem0.ai, "Context window is RAM, not storage: why
most agent failures happen"; DEV Community, "Make your agent idempotent:
run it twice, get the same result" — reuse/skip rather than blindly
re-executing once a side effect is recorded). The cost of waiting is that
every daemon crash or redeploy during an ingest/adapter run is a live
chance at a duplicated wiki entry or decision, and nothing in the system
would tell you it happened.

## Problem / opportunity
`Scheduler.recoverFromRestart()` (`packages/kernel/src/scheduler/scheduler.ts`)
currently does this for every run found with `status: 'running'`:
1. Mark it `failed` with `error: 'daemon restarted'`.
2. If `attempt < max_attempts`, immediately create a brand-new run with
   `attempt + 1` and the *same payload*, and execute it — re-running the
   skill's main turn from scratch.

For a cron/`every` routine with no side effects yet (e.g. `heartbeat` that
crashed before calling any syscall), this is exactly right. But an
event-triggered run (`on: raw.added` → `ingest`) or an adapter `sync()` run
can have already called `remember()` (wiki + `log.md`, see
`packages/kernel/src/wiki/wikiService.ts`), created a `Decision`, or pushed
a git commit (`packages/adapters/src/techpulseCoo/adapter.ts`) *before* the
crash — all of that is recorded as `wiki.written` / `decision.created` /
`git.commit` / `git.push` events already in the event log, keyed by
`runId`. The existing restart test
(`packages/kernel/test/scheduler/scheduler.restart.test.ts`) only covers
the "crashed before doing anything" case; there is no coverage, and no
code, for "crashed after already writing to memory." Retrying blindly in
that case means the retry's main turn runs the skill again against the
same `raw.added` payload and calls `remember` again, which appends a
second `log.md` line and can re-derive a slightly different wiki page for
the same event — a duplicate that nothing flags.

## Proposed solution
In `packages/kernel/src/scheduler/scheduler.ts`, before
`recoverFromRestart()` creates a retry for a `running` run, check whether
that run already produced a durable side effect:
```ts
const sideEffects = this.log.listEvents({
  runId: run.id,
  types: ['wiki.written', 'decision.created', 'git.commit', 'git.push'],
})
```
- If `sideEffects.length === 0`: keep today's behavior exactly — mark
  failed, retry with `attempt + 1` if attempts remain.
- If `sideEffects.length > 0`: mark the run `failed` as today, but do
  **not** create a retry. Instead append one `ops.alert` event:
  `{ type: 'ops.alert', payload: { routine: run.routine, runId: run.id,
  reason: 'restart_with_side_effects', effects: sideEffects.map(e => e.type) } }`.

No dashboard code changes are required to see this: `ops.alert` already
renders in the event feed with its `reason` shown inline
(`packages/dashboard/src/lib/events.ts`), the same way `missed`,
`overlap_skipped` and `budget_exceeded` alerts do today, so the new
`restart_with_side_effects` reason and its `effects` list show up in the
Runs/Overview event stream the moment it fires — an operator sees which
run stopped and what it had already written, and can check the wiki/log
before deciding whether to `agentos run` it again by hand. `queued` runs
are untouched: they never started, so they cannot have produced a side
effect, and keep retrying exactly as today.

## Effort estimate
S — a single new branch inside one existing function
(`recoverFromRestart`), reusing the event log's existing
`listEvents({ runId, types })` query (no schema change), one new
`ops.alert` reason string, and a few new cases in the existing
`scheduler.restart.test.ts`. No dashboard code change needed.

## Validation contract
- Functional assertions:
  - A `running` run with zero `wiki.written`/`decision.created`/
    `git.commit`/`git.push` events for its `runId` is retried exactly as
    today (`attempt + 1`, same payload) — the existing restart test keeps
    passing unchanged.
  - A `running` run with at least one of those events for its `runId` is
    marked `failed` but is **not** retried, and an `ops.alert` with
    `reason: 'restart_with_side_effects'` is appended, carrying the
    run's `routine`, `runId`, and the list of effect types found.
  - `queued` runs continue to execute unconditionally on restart, unchanged.
- Behavioral assertions:
  - The new alert needs no new dashboard component: it must render through
    the existing generic `ops.alert` event-feed path
    (`packages/dashboard/src/lib/events.ts`), the same as `missed` /
    `overlap_skipped` / `budget_exceeded`.
  - Attempt counting and `max_attempts`/budget-circuit-breaker behavior for
    the *next* normal (non-restart) trigger of that routine must be
    unaffected by this change.
- Negative assertions (should NOT happen):
  - No second run is ever created for a `running` run that already logged
    a `wiki.written`, `decision.created`, `git.commit`, or `git.push`
    event under its `runId`.
  - No change to `packages/kernel/src/process/processManager.ts`'s run
    lifecycle or to the kernel/adapters dependency direction — this is
    scoped entirely to the scheduler's restart-recovery path.
  - No new npm dependency.
- Test commands (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- This only looks at events already flushed to the event log by the time
  of the crash; a side effect whose write was itself interrupted
  mid-flight (e.g. `remember` partway through updating `log.md`) is a
  separate, lower-level durability question already owned by
  `WikiService`, not something this proposal changes.
- v1 does nothing automatic beyond alerting — no attempt to diff or
  reconcile what the interrupted run already wrote versus what a human
  re-run would produce. That's deliberately left to the operator for now
  rather than guessing at a merge/undo policy.
- Should this same guard also apply the first time a *budget-tripped* or
  *overlap-skipped* run is skipped, for consistency? Out of scope here;
  this proposal only touches the restart-recovery path.
