# Report: Warn before a run's context window fills, not after it degrades

- Proposal: `docs/missions/coo/proposals/011-context-window-budget.md`
- Decision issue: #27 (approved via `agentos:approve` label)
- Branch: `coo/context-window-budget`
- PR: https://github.com/ductringuyen-0618/agent-os/pull/28
- CI run (green, head `3d9c505`): https://github.com/ductringuyen-0618/agent-os/actions/runs/41496543953

## What shipped
- `packages/shared`: a `CONTEXT_WINDOWS` table + `contextWindowFor(model)`
  (known aliases/ids, `[1m]` long-context variants, 200k fallback), an
  optional `context_warn_pct` on `RoutineDefaults`/`RoutineConfig`
  (mirroring `daily_budget_usd`), and a `contextWindow` field on `Run`.
- `packages/kernel`: `kernel.ts` stores each run's `contextWindow` and
  raises a `context_budget_warning` `ops.alert` (same shape as
  `budgetTripped`'s) once `inputTokens / contextWindow` crosses the
  threshold (default 0.85). The heartbeat payload carries the same
  signal as `lastRun.contextBudgetWarning` so the heartbeat skill can
  note it with no new syscall. `eventLog.ts` persists the new column
  additively, migrating a pre-existing database.
- `packages/dashboard`: `RunsPanel` shows a per-run context-fullness
  chip ("NN% ctx"), styled like the existing budget-hit chip once a run
  is at or above its warn threshold; no chip (never `NaN%`) when a run
  has no token data yet.
- `examples/os-template`: documents `context_warn_pct` in
  `routines.yaml`'s defaults, and extends the heartbeat skill's
  contract/payload docs to note a context-budget warning the same way
  it already notes a failed run.

## Commits
- `chore(coo): approve context-window-budget`
- `chore(coo): start building context-window-budget`
- `feat(kernel,dashboard): warn when a run's context window fills`
- `test(shared,kernel,dashboard): cover context-window-budget validation contract`
- `merge main into coo/context-window-budget`

## Validator findings (scrutiny pass)
Ran the CI-equivalent commands locally from a clean state
(`rm -rf packages/*/dist` first), in this order:
`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`,
`pnpm -r run typecheck`, `pnpm test`. All green for
`@agentos/shared`, `@agentos/kernel` (311 tests), and
`@agentos/dashboard` (121 tests). `@agentos/adapters` (20 tests, a
`GIT_ASKPASS`/`allowUnsafeAskPass` restriction) and one
`@agentos/cli` integration-test file (an undefined temp path) failed
identically with and without this diff (confirmed via `git stash`) --
a sandbox-only restriction, not real in GitHub's own runner: the PR's
actual CI (`pnpm test` step, run 41496543953) passed in full,
confirming the local failures were sandbox artifacts. Root
`vitest run` (`test/no-secrets-no-paths.test.ts`, 565 assertions)
passed -- no secrets or absolute paths introduced.

New tests cover every assertion in the proposal's validation contract:
`contextWindowFor` on known/`[1m]`/fallback ids; `contextWindow`/
`inputTokens` round-tripping through `createRun`/`getRun`/`updateRun`;
a pre-migration database (missing the column) opening and migrating
additively; `context_warn_pct` surviving `parseRoutinesFile` on both
defaults and a routine override; a run's `ops.alert` firing exactly
when the threshold is crossed and not otherwise; `RunsPanel` rendering
the chip once over threshold and rendering nothing (no `NaN%`) when
token data is missing.

## Product reviewer notes
- Observable in the dashboard without digging into logs (Runs panel
  chip), config-driven via `context_warn_pct` with a sensible default,
  no containment changes, no new dependency/config file/secret.
- Known simplification: the dashboard chip's color threshold uses the
  shared default (0.85) rather than each routine's own override, since
  the Runs list isn't routine-scoped -- a cosmetic-only gap already
  called out in the proposal's risk section; the kernel's actual alert
  always uses the routine's real effective threshold.

## Outcome
CI went green on the first real run (`pnpm test` step, run
41496543953) with no fix needed -- the local-only sandbox failures were
confirmed unrelated before the PR was even opened. PR #28 is mergeable
(`mergeable_state: clean`), left for the human to merge.
