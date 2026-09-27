# Report: Stop routines from overlapping themselves

Proposal: `docs/missions/coo/proposals/006-routine-overlap-guard.md`
PR: https://github.com/ductringuyen-0618/agent-os/pull/22
CI run (green): https://github.com/ductringuyen-0618/agent-os/actions/runs/36336181482

## What shipped
- `packages/kernel/src/scheduler/scheduler.ts`: `trigger()` and `runRoutine()`
  now gate on a new `overlapTripped()` check before spawning a run — busy if
  the routine name, or its configured `project`, already has a run in
  flight. In-flight state is tracked in two new `Set<string>`s
  (`inFlightRoutines`, `inFlightProjects`), set by `markInFlight()` and
  cleared by `clearInFlight()` around every run path: the `every:` timer,
  `on:`-event triggers, and manual `runNow`/`runSkill`. A skip emits one
  deduped `ops.alert` (`reason: 'overlap_skipped'`, naming the routine and,
  when set, the project) per routine per UTC day — the same shape as the
  existing `budgetTripped` alert. Manual `runNow`/`runSkill` on a busy
  routine/project now reject with a clear "already in flight" error instead
  of silently starting a second concurrent run.
- `list()` reports `overlapSkipped: true` for a routine alerted today, same
  dedup rule as `budgetTripped`.
- Wire-shape types: `overlapSkipped?: boolean` added to `RoutineListItem` in
  `packages/dashboard/src/api/client.ts` and `packages/cli/src/client.ts`.
- `packages/dashboard/src/panels/RoutinesPanel.tsx`: renders an "overlap
  skipped" chip next to the existing "budget hit" chip.

## Commits
- `feat(scheduler): gate routines and projects against overlapping runs`
- `fix(adapters): stop decisions.test.ts fixtures drifting stale with
  wall-clock time` — an unrelated, pre-existing CI failure ported into this
  branch to get CI green (see below).

## Validator findings
Ran the exact CI sequence locally (`pnpm install --frozen-lockfile`,
`pnpm lint`, `pnpm build` from a clean `dist`, `pnpm -r run typecheck`,
`pnpm test`). The scheduler change itself was clean throughout: all 307
kernel tests (including 7 new overlap-guard cases) and all 119 dashboard
tests passed on every run.

The first CI run on GitHub Actions (run 36335888962) failed on 3 unrelated
`packages/adapters/src/techpulseCoo/decisions.test.ts` assertions that
omitted `reconcileGithubDecisions`'s optional `now` parameter and so
silently depended on wall-clock time staying close to a fixture's
hardcoded `createdAt: '2026-09-10T00:00:00Z'`. Confirmed pre-existing and
unrelated by checking CI on `main` itself (run 36335406964, a docs-only
commit, red for the identical reason) and by stashing this branch's diff
locally and re-running. Ported a minimal fix (explicit `now` via the
file's own `daysLater()` helper, matching every other date-sensitive test
in the file) onto this branch, verified `decisions.test.ts` 15/15 green
plus lint/typecheck/build clean, pushed, and CI re-ran green (run
36336181482).

## Reviewer notes
Observable in the dashboard (new chip, same visual style as the budget
chip), no new dependency, no schema change (`ops.alert` payload stays
free-form `Record<string, unknown>`), doesn't touch containment or
permission modes. The proposal's negative assertions are covered by
tests: a skip never flips `enabled`, never touches budget bookkeeping, and
never creates a `failed` run or a retry timer. The guard never wedges a
routine permanently — once the in-flight run settles, the next legitimate
fire proceeds normally (covered by a dedicated test).
