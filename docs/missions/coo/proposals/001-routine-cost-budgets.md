---
status: approved
attempts: 0
branch: null
---
# Per-routine daily cost budgets with a circuit breaker

## What you get
A `daily_budget_usd` setting, global and per routine, that the scheduler checks
before every run. When a routine has already spent its cap today, the run is
skipped, one `ops.alert` event explains why (routine, cap, spent), and the
Routines panel shows a "budget tripped" chip next to it. The cap resets by
itself at UTC midnight; nothing to clear by hand.

## Why start this now
Today the only cost control is looking at the Costs chart after the money is
gone. One routine on a tight interval, or one skill whose prompt grows with the
wiki, can spend all day unattended. The heartbeat already costs about $0.34 per
run with nothing to stop it. This is the same kind of gap `max_attempts` closes
for failures, and it is small: one query, one guard clause, one chip. Every day
without it is a day the daemon can surprise you on the bill.

## Problem / opportunity
`packages/kernel`'s `Scheduler` already tracks per-run cost (`Run.costUsd`,
persisted in SQLite and shown in the dashboard's **Costs** panel), and it
already has one budget-shaped primitive: `max_attempts` + exponential
backoff for *failures*. But there is no cap on *spend*. A routine on a
tight `every: 5m` interval, or a `lint`/`daily-digest` skill whose prompt
balloons after a wiki grows, can burn budget all day with nothing to stop
it — the operator only finds out by eyeballing the Costs chart after the
fact. For a daemon meant to run unattended, "notice tomorrow" is not
containment; it's the same class of gap `max_attempts` closes for
failures, just for money instead of retries.

## What we learned from research
- [AI Agent Rate Limiting: Quota Control, Circuit Breakers, and Budget
  Caps](https://www.openlegion.ai/en/learn/ai-agent-rate-limiting) and
  [How to Stop AI Agent Cost Blowups Before They Happen](https://dev.to/sapph1re/how-to-stop-ai-agent-cost-blowups-before-they-happen-1ehp)
  describe the same layered pattern converging across 2026 agent-runtime
  write-ups: per-request ceilings, session/day budgets, and a **circuit
  breaker** that trips on a cap and refuses further spend until the window
  resets, plus an alert at trip time rather than a silent skip. One
  write-up notes a flat "$10/day hard cap at the gateway layer catches
  ~95% of runaway incidents" — the mechanism doesn't need to be clever to
  be useful, it needs to exist and fire before the day is over.
- [AI Agent Budget Guards](https://www.nexgismo.com/blog/ai-agent-budget-guards-stop-runaway-api-costs)
  frames the guard as living at the *dispatch* boundary (before a call is
  issued), not as a post-hoc report — the same place agent-os's
  `Scheduler.executeRoutine` already sits, right before it calls `exec()`.
- The mechanism being borrowed here is specifically "cap check happens at
  trigger time, tripped state is visible, and it resets on its own" — not
  any specific vendor's SDK (agent-os has no dependency on
  AgentBudget/SupraWall-style third-party services and this proposal adds
  none).

## Proposed solution
- `packages/shared/src/types/routine.ts`: add optional
  `daily_budget_usd?: number` to both `RoutineDefaults` (global default,
  `undefined`/absent = no cap, preserving today's behavior) and
  `RoutineConfig` (per-routine override).
- `packages/kernel/src/scheduler/scheduler.ts`: in `runRoutine`/`trigger`,
  before creating a new `Run`, compute today's spend for that routine name
  (sum `Run.costUsd` for rows with `routine === config.name` and
  `startedAt` within the current UTC day — a new small `EventLog` helper,
  e.g. `costForRoutineToday(routine: string): number`, reusing the same
  `runs` table the `/api/costs` route already reads). If the effective cap
  (`config.daily_budget_usd ?? defaults.daily_budget_usd`) is set and
  today's spend already meets or exceeds it, skip creating the run, emit
  one `ops.alert` event per trip (`{ routine, reason: 'budget_exceeded',
  capUsd, spentUsd }`, deduped per UTC day so a 5-minute interval doesn't
  spam an alert every tick), and return without calling `exec()`. The
  circuit resets automatically at UTC midnight because the spend query is
  windowed to "today" — no extra state to persist or a human to clear.
  `on:`-triggered and ad-hoc (`schedule()`/"Run now") routines get the same
  check since they funnel through `runRoutine` too.
- `packages/kernel/src/api/server.ts`: extend `GET /api/routines`'s
  per-routine payload with `dailyBudgetUsd` (effective cap, if any) and
  `spentTodayUsd`, both computed from the same helper, so the dashboard
  doesn't need a second round trip.
- `packages/dashboard/src/panels/RoutinesPanel.tsx`: when a cap is
  configured, render a small `spentTodayUsd / dailyBudgetUsd` chip next to
  the routine name (e.g. `$0.42 / $1.00`); when the day's most recent
  `ops.alert` for that routine has `reason: 'budget_exceeded'`, render a
  `budget hit` chip in the same slot the existing `paused` chip uses today
  — same visual language, different cause, so the operator can tell "I
  paused this" from "the cap stopped this" at a glance.
- `packages/dashboard/src/panels/CostsPanel.tsx`: if any routine has a
  budget configured, add a small "Budgets" row under the existing summary
  cards listing each capped routine's spend-vs-cap so the cap is visible
  even without opening Routines.
- `examples/os-template/os/routines.yaml`: document the new key with one
  commented example (`# daily_budget_usd: 2.0`) so a new instance
  discovers the knob without reading source.
- No new runtime dependency, no schema migration (reads the existing
  `runs.cost_usd` column), no change to `applyDecision`/containment
  surfaces.

## Effort estimate
S — one new EventLog query method, one guard clause in the scheduler
placed before an existing call, one additive API field, two panel diffs
that follow an existing chip pattern already in `RoutinesPanel.tsx`.

## Validation contract
- Functional assertions:
  - A routine with `daily_budget_usd: 0` (or any cap already met by prior
    runs today) does not spawn a new run when triggered; `exec()` is not
    called.
  - A routine with no `daily_budget_usd` configured (the current default)
    behaves identically to today — no behavior change for existing
    instances that don't opt in.
  - The cap resets naturally after a UTC day boundary without any manual
    intervention or stored "tripped" flag.
- Behavioral assertions:
  - Tripping the cap emits exactly one `ops.alert` (`reason:
    'budget_exceeded'`) per routine per UTC day, not one per skipped
    trigger.
  - `GET /api/routines` reports `spentTodayUsd` that matches the sum of
    `costUsd` for that routine's runs started today, verified against a
    seeded `EventLog`.
  - `RoutinesPanel` renders the `budget hit` chip only after such an alert
    exists for the current day, and the spend-vs-cap chip only when a cap
    is configured.
- Negative assertions (should NOT happen):
  - A capped routine must never be silently disabled (`enabled` stays
    `true`; this is a per-trigger skip, not a pause) — `toggle`/Resume
    semantics in `RoutinesPanel` are untouched.
  - No change to `max_attempts`/backoff/failure handling paths.
  - `on:`-triggered routines whose upstream event fires while the cap is
    tripped must not queue up and burst-fire once the cap resets — they
    simply miss that trigger, same as any other skipped fire.
- Containment assertions:
  - No new MCP tool, no new `allowed_tools`, no new file-write surface —
    this only reads `runs.cost_usd` and writes one `ops.alert` event,
    both already-existing mechanisms.
  - No absolute paths, no secrets, in any changed file.
- Test commands the build will need to pass: `pnpm -r --if-present
  typecheck`, `pnpm lint`, `pnpm -r --if-present test` (new
  `scheduler.test.ts` and `eventLog.test.ts` cases for the budget guard;
  new `RoutinesPanel.test.tsx`/`CostsPanel.test.tsx` cases for the chips),
  `pnpm build`.

## Risks / open questions
- UTC-day windowing is simple but means the cap resets at a fixed clock
  time regardless of the operator's timezone; a rolling 24h window was
  considered but rejected for this pass — it needs a "when did we last
  trip" timestamp instead of a pure query, which is more state for little
  practical benefit at S effort.
- Retried attempts after a failure (existing `max_attempts` backoff) should
  probably count toward the same day's spend rather than bypass the check;
  worth confirming in review that `handleFailure`'s retry path also goes
  through `runRoutine` (it currently calls `executeRoutine` directly with a
  pre-built `Run`, so the worker will need to route retries through the
  same guard, not just first attempts).
