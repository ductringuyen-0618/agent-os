# Shipped: Per-routine daily cost budgets with a circuit breaker

Proposal: `docs/missions/coo/proposals/001-routine-cost-budgets.md`
Branch: `coo/routine-cost-budgets`
PR: https://github.com/ductringuyen-0618/agent-os/pull/7

## What shipped

- `RoutineDefaults`/`RoutineConfig` gained an optional `daily_budget_usd`
  (global default and per-routine override).
- `EventLog.costForRoutineToday(routine)` sums a routine's `cost_usd` for
  runs whose `started_at` is on or after UTC midnight today.
- `Scheduler` checks the effective cap before spawning a run in three
  places: `runRoutine` (covers `runNow`, `runSkill`, `on:`-triggered
  routines, and scheduled one-shots — they all funnel through it), the
  `every:`-interval path (`runTrackedEveryRoutine`), and the
  failure-retry backoff timer inside `handleFailure` (so a retried attempt
  counts toward, and respects, the same day's spend). When the cap is
  met or exceeded, the scheduler skips spawning the run and emits one
  `ops.alert` (`reason: 'budget_exceeded'`) per routine per UTC day —
  deduped via an in-memory `Map<routineName, lastAlertUtcDate>`, so a
  tight `every: 1s` interval doesn't spam alerts every tick. The cap
  resets on its own at UTC midnight since the spend query is always
  windowed to "today" — no stored "tripped" flag to clear.
- `Scheduler.list()` (backing `GET /api/routines`) now reports
  `dailyBudgetUsd`, `spentTodayUsd`, and `budgetTripped` per routine.
- Dashboard: `RoutinesPanel` shows a `$spent / $cap` chip next to any
  routine with a cap configured, and a `budget hit` chip once its alert
  has fired for the day. `CostsPanel` adds a "Budgets" row listing every
  capped routine's spend-vs-cap (with the same `budget hit` chip) so the
  cap is visible without opening Routines.
- `examples/os-template/os/routines.yaml` documents the new key with a
  commented example at both the global-default and per-routine level.
- README's Concepts section explains the new behavior.

## Commits

- `feat: per-routine daily cost budgets with a circuit breaker` (88a695a)
  — implementation, tests, docs in one commit (kept to a single logical
  change; no fixup commits were needed).

## Validator findings

Ran the full contract, not partial:
- `pnpm -r --if-present typecheck` — pass (after `pnpm install
  --frozen-lockfile` and a full `pnpm build`, which the workspace needed
  for cross-package `.d.ts` resolution — pre-existing repo characteristic,
  unrelated to this change).
- `pnpm lint` (Biome) — pass. One formatting fix needed in the new
  `scheduler.budget.test.ts` (multi-line object literals), applied via
  `biome format --write` before commit.
- `pnpm -r --if-present test` — pass, 152/152 kernel tests (was 149 before
  this proposal — 3 new scheduler tests plus 3 new `EventLog` tests, minus
  the ones folded into existing files), 62/62 dashboard tests (4 new:
  chip and Budgets-row cases), 16/16 adapters, 11/11 CLI, 12/12 shared.
  No regressions.
- `pnpm build` — pass, all five packages.
- Dashboard e2e (`playwright test`, dashboard files changed) — 1/1 pass.
- Guard check: manually diffed `main...HEAD` for absolute local paths
  (`/home/`, `/Users/`, `C:\Users`) and common secret patterns
  (`sk-ant-`, AWS/GitHub token shapes) — clean. (CI's gitleaks step isn't
  runnable from this sandbox; this diff introduces no config, tokens, or
  hardcoded hosts of any kind, only application code, tests, and docs.)

## Product review

- **Observable**: yes — a chip in Routines, a Budgets row in Costs, and
  an `ops.alert` event in the log, all driven by the same
  `spentTodayUsd`/`dailyBudgetUsd`/`budgetTripped` fields the API now
  returns.
- **Config-driven**: yes — `daily_budget_usd` is a routines.yaml key with
  no hardcoded cap; unset by default, so every existing instance is
  unaffected until an operator opts in.
- **Containment**: no new MCP tool, no new `allowed_tools`, no new
  file-write surface — the guard only reads the existing `runs.cost_usd`
  column and writes through the existing `ops.alert` event type. Doesn't
  touch `applyDecision`, permission modes, or any allowlist.
  `enabled`/pause semantics are untouched — a tripped routine is skipped
  per-trigger, never disabled.
  `on:`-triggered fires that land while the cap is tripped are simply
  missed, not queued, so there is no burst-fire once the cap resets.
  Retries during `max_attempts` backoff go through the same guard.
- **Docs**: README's Concepts section and a commented example in
  `routines.yaml` both explain the knob; no README/CLI mention needed
  beyond that since the CLI's routine listing predates this proposal's
  scope (it wasn't asked for and adding it would have widened the
  change).
- **Empty/error states**: no cap configured → no chip, no Budgets row,
  identical to today. Cap configured but not tripped → spend-vs-cap chip
  only. Tripped → both chips, one alert per day. All three read clearly
  in the panels.

One deliberate implementation choice worth flagging: the proposal's
validation contract describes the "budget hit" chip as appearing "when
the day's most recent `ops.alert`...has `reason: 'budget_exceeded'`". The
scheduler already had to track "did I alert this routine today" in memory
to dedupe the alert itself (`budgetAlertDates: Map<name, utcDateKey>`), so
`budgetTripped` in `list()` reuses that same map rather than adding a
second code path that queries the events table — same observable
behavior (the chip only appears once an alert has actually fired that
day), one fewer mechanism.

Both validator and product review pass. Marked `shipped`; `Shipped: 2/3`.
