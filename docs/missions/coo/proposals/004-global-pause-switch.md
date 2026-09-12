---
status: proposed
attempts: 0
branch: null
---
# A global pause switch for the whole daemon

## What you get
One button, visible from any panel in the dashboard, that stops agent-os
from starting any new work — every cron, interval, and event-triggered
routine, everywhere — until you press Resume. It survives a daemon
restart, it says who paused it and why, and it offers a second step to
also stop whatever is already mid-run. The same two actions are available
from the terminal.

## Why start this now
Today, stopping agent-os during an incident means opening the Routines
panel and clicking every routine's toggle one at a time, hoping you didn't
miss one — there is no single control, and nothing recorded why you
stopped it. 2026 write-ups on agent operations are converging hard on this
exact gap: kill-switch design is now urgent enough that an open
convention for it, KILLSWITCH.md, has emerged this year defining
triggers, a throttle-pause-full-stop escalation, and audit requirements
as baseline practice; TechTarget's "Why businesses need an AI agent kill
switch" and Straiker's write-up on agentic kill switches both frame a
single control point with an audit trail as the first thing an agent
operator should have, not an advanced feature. agent-os already ships the
"throttle" tier (`daily_budget_usd`'s circuit breaker) and the "stop one
thing" tier (`POST /api/runs/:id/kill`) — the one tier missing is "stop
everything, right now," which is exactly the control an operator reaches
for first when something looks wrong and there's no time to reason about
which routine is the culprit.

## Problem / opportunity
- `packages/kernel/src/scheduler/scheduler.ts`'s `trigger()` and
  `runRoutine()` already gate every fire on two things: `lr.enabled`
  (per-routine, set via `setEnabled()`) and `budgetTripped(config)`
  (per-routine, from 001-routine-cost-budgets). Both are per-routine.
  There is no daemon-wide gate at all — an operator can only stop routines
  one name at a time, via `RoutinesPanel`'s per-row toggle or
  `agentos routines disable <name>`.
- Both existing gates are also intentionally in-memory: `setEnabled()`
  mutates the in-process `Map`, and `budgetAlertDates` resets on restart.
  That's the right call for "pause this one routine for a while," but it
  is the wrong call for an emergency stop — a daemon crash or a `agentos
  up` restart five minutes after an operator paused everything must not
  silently wake every routine back up.
- `packages/kernel/src/process/processManager.ts` already has `kill(runId):
  boolean` and a private `children: Map<string, ResultPromise>` of
  in-flight processes, and `POST /api/runs/:id/kill` already exposes it —
  but only one run at a time; there's no "stop everything that's running
  right now" call.
- Net effect: the daemon has every piece needed to build a real stop
  control (a scheduler choke point pattern from the budget guard, a kill
  primitive from `ProcessManager`, an alert/event channel already wired
  into the dashboard's activity feed since 001) and simply never
  assembled them into the one thing an operator reaches for first during
  an incident.

## What we learned from research
- KILLSWITCH.md (2026), an open file-convention spec for AI agent
  emergency shutdown, defines the shape being borrowed here: named
  triggers, a three-level escalation (throttle → pause → full stop), and
  a hard requirement that a stop be logged and that resuming needs an
  explicit human action — not a silent timeout or restart. agent-os
  already has the "throttle" tier; this proposal adds "pause" (no new
  runs) and gives "full stop" (kill what's running too) as an explicit
  second step at the same control, rather than two different features.
- TechTarget's "Why businesses need an AI agent kill switch" and
  Straiker's "The Agentic Kill Switch" both describe the same practical
  requirement independent of vendor: one control point an operator can
  find under pressure, not a per-agent or per-routine setting they have
  to remember to repeat, plus a durable record of who stopped things and
  why for the post-incident review.
- The mechanism borrowed is specifically "one gate, checked at the same
  place existing gates are checked, persisted so a crash can't silently
  clear it, paired with an existing kill primitive for the in-flight
  case" — no new vendor, no new service, no credential-revocation or
  tool-access-stripping machinery (agent-os's containment is already
  per-run via `--strict-mcp-config`/`allowed_tools`, which a paused
  daemon simply never invokes in the first place).

## Proposed solution
- `packages/kernel/src/log/schema.sql`: add a tiny
  `CREATE TABLE IF NOT EXISTS daemon_state (key TEXT PRIMARY KEY, value
  TEXT NOT NULL)` — one row, key `'paused'`, value a JSON blob `{ at,
  reason, by }` when paused, absent when not. This is the only schema
  change; every other existing table is untouched.
- `packages/kernel/src/log/eventLog.ts`: add `getPause(): PauseState |
  null` and `setPause(state: PauseState | null): void` reading/writing
  that row, mirroring the existing small getter/setter methods already on
  `EventLog` (e.g. `listMessages`).
- `packages/kernel/src/scheduler/scheduler.ts`: load `daemon_state` once
  at startup into a `private paused: PauseState | null`. `trigger()` and
  `runRoutine()` each gain the same one-line guard already used for
  `budgetTripped` (`if (this.paused) return` / `throw`), checked *before*
  the per-routine `enabled`/budget checks so a paused daemon short-circuits
  every trigger path — cron, interval, event (`on:`), and
  `processDueSchedules()`'s one-shot `schedule()` runs alike. Add
  `pause(reason?: string, by?: string): void` and `resume(): void`
  methods that call `EventLog.setPause`/`getPause`, update the in-memory
  field, and `emit_event`-equivalent an `ops.alert` (`reason:
  'daemon_paused'` / `'daemon_resumed'`, carrying `by`/`reason`) through
  the same `EventLog.append` the budget guard already uses — so it shows
  in the dashboard's activity feed for free, exactly like a budget trip
  does today.
- `packages/kernel/src/process/processManager.ts`: add `killAll(): number`
  that calls the existing `kill(id)` for every key in `children` and
  returns the count stopped — no new process-management logic, just a
  loop over what's already there.
- `packages/kernel/src/api/server.ts`: three routes mirroring the existing
  `/api/routines/:name/enable|disable` shape —
  `GET /api/system/pause` (current `PauseState | null`),
  `POST /api/system/pause` (`{ reason?, stopRunning?: boolean }` body;
  calls `scheduler.pause()`, and when `stopRunning` is true also calls
  `pm.killAll()`), `POST /api/system/resume` (calls `scheduler.resume()`).
- `packages/dashboard/src/api/client.ts` and `packages/cli/src/client.ts`:
  add matching `getPause()` / `pause(reason?, stopRunning?)` / `resume()`
  methods, following `setRoutineEnabled`'s existing pattern.
- `packages/dashboard/src/App.tsx` (or wherever the panel nav/shell lives):
  a persistent header control — "Pause all" when running, or, when
  paused, a red banner across the top ("Paused since <time> by <who>:
  <reason>" with a "Resume" button) visible no matter which panel is
  open, not scoped to `RoutinesPanel`. Clicking "Pause all" opens a small
  confirm with an optional reason field and a "also stop runs in
  progress" checkbox (`stopRunning`); an empty reason still pauses, shown
  as "no reason given" rather than blocking the action.
- `packages/cli/src/commands/routines.ts` (or a new `system.ts` command
  file, following the existing one-file-per-noun layout): `agentos pause
  [--reason <text>] [--stop-running]` and `agentos resume`.
- `docs/SECURITY.md`: one new paragraph under "What an agent cannot do"
  noting that no syscall or agent action can pause or resume the daemon —
  same shape as the existing note that no syscall can resolve its own
  approval — since this control is operator-only, reachable only through
  the dashboard/CLI/API, never through anything a `claude -p` run can
  call.
- No new MCP tool, no new `allowed_tools` entry, no new runtime
  dependency.

## Effort estimate
M — one new single-row table and two small `EventLog` methods, a guard
added at the same point `budgetTripped` already sits (twice: `trigger`
and `runRoutine`), one small loop added to `ProcessManager`, three new
API routes following an existing pattern, two API clients, one CLI
command file, and a dashboard-shell banner (new, since it must be visible
outside any single panel) plus a confirm dialog. Larger than the S
proposals so far because it touches the dashboard shell rather than one
panel, and needs a real persisted table instead of reusing an existing
column.

## Validation contract
- Functional assertions:
  - After `POST /api/system/pause`, no routine fires on its `cron`,
    `every`, or `on:` trigger, and `processDueSchedules()` does not run a
    due one-shot `schedule()` — verified in `scheduler.test.ts` by
    advancing the fake clock/emitting a matching event post-pause and
    asserting `exec` was never called.
  - `POST /api/system/pause` with `stopRunning: true` also causes every
    currently-tracked `ProcessManager` child to receive `kill()`.
  - Pause state loaded from `daemon_state` at `Scheduler` construction
    means a freshly constructed `Scheduler` (simulating a daemon restart)
    over a DB with a pause row still blocks triggers — the pause is not
    silently cleared by a restart.
  - `POST /api/system/resume` clears the row and restores normal
    triggering immediately.
- Behavioral assertions:
  - Pausing emits exactly one `ops.alert` (`reason: 'daemon_paused'`)
    carrying `reason`/`by`; resuming emits one `ops.alert` (`reason:
    'daemon_resumed'`) — both appear in the Overview activity feed via
    the existing `classifyEvent`/`ops.alert` path, unmodified.
  - The dashboard shows the pause banner on every panel, not only
    Routines, and it reflects `GET /api/system/pause`'s state on load
    (not only on a live WebSocket event), so opening the dashboard fresh
    while paused still shows the banner.
  - `RoutinesPanel`'s existing per-routine `enabled` toggle and
    `budgetTripped` chip are unaffected in either code path or rendering
    when the daemon is not paused.
- Negative assertions (should NOT happen):
  - Pausing must never mutate any routine's own `enabled` flag — resuming
    must bring every routine back to exactly the enabled/disabled state
    it had before the pause, not force everything back on.
  - A paused daemon must still serve read-only API routes (`GET
    /api/routines`, `/api/runs`, `/api/decisions`, etc.) and must still
    let a human resolve an existing pending `Decision` — pausing stops
    new *agent* work, not the operator's own dashboard/CLI actions.
  - No change to `max_attempts`/retry/backoff or to `daily_budget_usd`
    behavior when unpaused — both existing guards run exactly as before.
  - No new MCP tool, no new `allowed_tools` entry — nothing about what a
    `claude -p` run itself can do changes.
- Containment assertions:
  - No syscall exposes `pause`/`resume`/`killAll` — grep confirms neither
    appears in `packages/kernel/src/syscall/`.
  - No absolute paths, hostnames, or secrets in any changed file.
- Test commands the build will need to pass (from `.github/workflows/
  ci.yml`): `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`,
  `pnpm -r run typecheck`, `pnpm test` (new `eventLog.test.ts` cases for
  `getPause`/`setPause`; new `scheduler.test.ts` cases for the pause guard
  across `trigger`/`runRoutine`/`processDueSchedules` and restart
  persistence; a `processManager.test.ts` case for `killAll`; `server.test.ts`
  cases for the three routes; a dashboard shell test for the banner's
  presence/absence and its load-time state).

## Risks / open questions
- This is the one place agent-os deliberately breaks with its own
  in-memory precedent for per-routine `enabled`/budget state, by
  persisting the pause flag. That asymmetry is intentional (a safety
  control that silently clears itself on crash defeats the point) but is
  worth flagging in review since it's the first piece of scheduler state
  backed by a table instead of memory.
- Whether `stopRunning` should be the default rather than an opt-in
  checkbox is a genuine judgment call: killing a run mid-write is safer
  for "something is clearly wrong" but could leave a half-written
  `workspace/` file behind for a run that was actually fine. Defaulting
  to "pause new work only," with a plainly-labeled second step for "also
  stop what's running," was chosen to avoid the more destructive action
  being one accidental click, but this is worth a second look in review.
- No `WebSocket` push was designed for the pause state itself beyond the
  existing `ops.alert` event; the banner also fetches `GET
  /api/system/pause` on load specifically so a dashboard opened after the
  event already fired still shows it, but a second reviewer should
  confirm that covers a dashboard left open through the pause (it does,
  via the same `ops.alert` the activity feed already subscribes to).
