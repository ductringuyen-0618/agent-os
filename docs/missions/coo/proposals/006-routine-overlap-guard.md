---
status: proposed
attempts: 0
branch: null
---
# Stop routines from overlapping themselves

## What you get
A routine (or a group of routines sharing a project) can no longer spawn
a second `claude -p` run on top of one that is still going. If a fire
would overlap, agent-os skips it, logs why, and shows an "overlap
skipped" chip on the Routines panel next to a "budget hit" chip that
already exists there today — so a slow run is finally visible instead of
silently doubling up.

## Why start this now
Today nothing stops it: an `every:` routine whose run takes longer than
its own interval gets re-triggered on the next tick anyway, and an
`on:`-triggered routine gets triggered once per matching event with zero
throttling, however fast the events arrive. Two overlapping runs that
share a project both call `simple-git` against the *same* clone directory
— checkout, pull, commit, push — from two Node processes at once, which
is exactly the kind of interleaving that corrupts a git index or produces
a push nobody intended. Recent write-ups on running LLM-agent runtimes
converge on the same fix: treat concurrency as a first-class scheduler
control, not something the model or the OS's own file locking happens to
prevent — a global or per-resource concurrency semaphore around each
unit of work (Agentuity's "AI Agent Runtime" overview and the "Parallel
AI Agents: Which Resource Limits Still Apply?" piece both name this as
the baseline safeguard; DEV Community's "Measuring the real concurrency
ceiling of an LLM agent runner" shows what breaks without it). agent-os
already has the identical pattern for cost — the daily-budget circuit
breaker skips a fire and alerts instead of crashing something — so this
proposal is that same shape of fix applied to concurrency, which is the
one containment gap of that kind left unaddressed. It's cheap now (a
guard around an existing, already-half-built flag) and gets more likely
to bite as more routines and adapters share projects.

## Problem / opportunity
- `Scheduler` (`packages/kernel/src/scheduler/scheduler.ts`) already has an
  `inFlight` flag on `LoadedRoutine` (line 28), but it is a lie about what
  it does: the doc comment says it "tracks whether the previous
  execution has settled," yet the `every:` interval callback
  (lines 101-111) calls `this.trigger(lr)` unconditionally on every tick
  regardless of `inFlight`, and `trigger()` (lines 114-125) never checks
  `inFlight` before starting a new `runTrackedEveryRoutine`. The flag only
  gates whether `nextRunAt` advances (for missed-run detection) — it does
  not stop a second run from starting while the first is still mid-flight.
- Event-triggered routines have no equivalent flag at all: `onEvent`
  (line 279) calls `trigger(lr, ...)` for every matching event with no
  in-flight check, so a burst of matching events (plausible — `raw.added`
  fires once per mirrored file in `techpulseCooAdapter.sync()`,
  `packages/adapters/src/techpulseCoo/adapter.ts:200-214`) can spawn one
  concurrent run per event.
- `RoutineConfig.project` (`packages/shared/src/types/routine.ts:27`) lets
  more than one routine target the same project, and every project-scoped
  adapter action in this repo's own adapter
  (`packages/adapters/src/techpulseCoo/adapter.ts`) operates on one shared
  `project.clone` working directory via `simple-git`
  (`ensureClone`, line 75; `applyDecision`, line 296) — `checkout`,
  `pull --ff-only`, `add`, `commit`, `push`, all against the same `.git`.
  Two routines sharing a project (e.g. a `sync` on `every:` and an
  `on: raw.added` ingest) racing those calls is not hypothetical; nothing
  in the kernel or the adapter prevents it today.
- The only existing precedent for "skip a fire and say why" is
  `budgetTripped` (scheduler.ts:219-238): checks a condition, and if
  tripped, emits one deduped `ops.alert` and returns true so the caller
  skips spawning. There is no equivalent for overlap.

## Proposed solution
- **`packages/kernel/src/scheduler/scheduler.ts`**: make `trigger()` the
  single gate for overlap, for both `every:` and `on:`-triggered
  routines. Track in-flight state per routine name and, when a routine
  config has a `project`, also per project (a `Set<string>` of
  currently-running project names is enough — no new dependency). Before
  starting a run, if the routine itself is in flight, or its project is in
  flight from *any* routine, skip the fire, emit one `ops.alert`
  (`reason: 'overlap_skipped'`, `routine`, `project` when set) mirroring
  `budgetTripped`'s shape, and return without spawning. Clear the flag(s)
  in the existing `.finally()` alongside `inFlight = false`. This replaces
  the current dead half of the `inFlight` mechanism rather than adding a
  parallel one.
- **`runRoutine`/`runNow`/`runSkill`** (manually- or API-triggered runs):
  go through the same gate, so a person clicking "run now" on a routine
  that's mid-run, or on a routine sharing a busy project, gets the same
  skip-and-alert instead of a second concurrent process.
- **`list()`** (scheduler.ts, near `budgetTripped` in the returned shape):
  add an `overlapSkipped` flag next to the existing `budgetTripped` one,
  true only for the current UTC day's most recent alert per routine, same
  dedup rule already used for budget alerts.
- **Wire-shape types**: extend `RoutineListItem` in
  `packages/dashboard/src/api/client.ts` and `packages/cli/src/client.ts`
  (both already duplicate this shape per the comment at
  `packages/shared/src/types/api.ts:77`) with `overlapSkipped?: boolean`.
- **`packages/dashboard/src/panels/RoutinesPanel.tsx`**: render an
  "overlap skipped" chip next to the existing "budget hit" chip
  (lines 108-110), same style, when `overlapSkipped` is true.
- **`packages/cli`**: no new command; `agentos routines` already prints
  whatever `list()` returns.

## Effort estimate
S — the flag already half-exists; this finishes wiring it, adds a
project-level set, one alert shape copied from `budgetTripped`, one
dashboard chip, and matching tests. No new dependency, no schema change
(`ops.alert` payloads are already free-form `Record<string, unknown>`),
no touch to `packages/adapters` beyond what the scheduler already gates.

## Validation contract
- Functional assertions:
  - An `every:` routine whose run has not yet settled, re-triggered by
    its own timer before finishing, is skipped: no second `Run` row is
    created, and exactly one `ops.alert` with `reason: 'overlap_skipped'`
    is emitted for that tick.
  - An `on:`-triggered routine matching two events in quick succession
    while its first run is still executing produces one run and one
    `overlap_skipped` alert for the second event, not two runs.
  - Two different routines configured with the same `project`: starting
    the second while the first is still running is skipped with an
    `overlap_skipped` alert naming both the routine and the project.
  - `runNow`/`runSkill` on a routine (or a project) already in flight
    skip and alert the same way instead of throwing an unrelated error.
  - `list()` reports `overlapSkipped: true` for a routine alerted on
    today (UTC), `false`/`undefined` otherwise — same dedup rule as
    `budgetTripped`.
- Behavioral assertions:
  - Once the in-flight run finishes (success or failure), the next
    legitimate fire (timer tick, matching event, or manual run) proceeds
    normally — the guard never permanently wedges a routine.
  - The Routines panel shows the "overlap skipped" chip immediately after
    the alert (existing websocket-driven refresh, no polling), and it
    clears when a later successful fire is not skipped.
- Negative assertions (should NOT happen):
  - A routine or project with nothing else running must never be skipped
    — the guard only fires on genuine overlap.
  - Skipping a fire must never mark the routine `enabled: false` or touch
    its daily budget bookkeeping — overlap and budget stay independent
    circuit breakers.
  - No routine's `max_attempts`/retry logic is invoked by a skip — a skip
    is not a failure and must not create a `failed` run or a retry timer.
- Test commands the build will need to pass (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- Skip-and-alert (not queue) means a fire that lands mid-overlap is lost,
  not deferred — identical tradeoff to the existing budget breaker, and
  the right default for `every:`/cron routines since the next tick picks
  it back up. An `on:`-triggered routine's event is not automatically
  redelivered, so a truly must-not-drop event stream would want a queue
  later; deliberately deferred to keep this proposal small, since nothing
  in the current routine set needs at-least-once event delivery today.
- Per-project tracking only helps routines that declare `project` in
  `routines.yaml`; an adapter's own internal concurrency (if a single
  `sync()` call somehow re-entered itself) is out of scope here — this
  proposal is about the scheduler never starting two runs on top of each
  other, not about auditing every adapter's internals.
