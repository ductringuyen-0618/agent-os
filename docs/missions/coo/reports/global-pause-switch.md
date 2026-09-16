# Shipped: A global pause switch for the whole daemon

Proposal: `docs/missions/coo/proposals/004-global-pause-switch.md`
Branch: `coo/global-pause-switch`
PR: https://github.com/ductringuyen-0618/agent-os/pull/19
CI run: https://github.com/ductringuyen-0618/agent-os/actions/runs/35126952666

## What shipped

- `packages/kernel/src/log/schema.sql` + `eventLog.ts` — a `daemon_state`
  table with `getPause()`/`setPause()`, mirroring the existing small
  getter/setter pattern (e.g. `listMessages`).
- `packages/kernel/src/scheduler/scheduler.ts` — `paused: PauseState |
  null` loaded once at construction from `EventLog.getPause()` so a fresh
  `Scheduler` after a daemon restart still honors a pause set before the
  crash. `trigger()` and `runRoutine()` each gain a one-line guard ahead
  of the existing `enabled`/budget checks, covering cron, `every`, `on:`
  events, and one-shot `schedule()` runs alike (`runNow`/`runSkill`/
  `processDueSchedules` all route through `runRoutine`). `pause(reason?,
  by?)`/`resume()`/`getPause()` methods persist to `EventLog` and emit a
  matching `ops.alert` (`daemon_paused`/`daemon_resumed`) through the same
  `EventLog.append` the budget guard already uses.
- `packages/kernel/src/process/processManager.ts` — `killAll(): number`
  loops the existing `kill(id)` over every tracked run.
- `packages/kernel/src/api/server.ts` — `GET/POST /api/system/pause` and
  `POST /api/system/resume`, following the existing
  `/api/routines/:name/enable|disable` route shape and bearer-token auth.
- `packages/dashboard` — a new `SystemPauseBar` sitting above the
  nav/main split in `App.tsx`, visible on every panel: a slim "Pause all"
  button when running, or a full-width red "Paused since… by…: reason"
  banner with a Resume button when paused. Loads state on mount (so a
  fresh page load while paused still shows the banner) and refreshes live
  off the same `ops.alert` the activity feed already subscribes to.
- `packages/cli` — `agentos pause [--reason <text>] [--stop-running]` and
  `agentos resume`, in a new `commands/system.ts`.
- `docs/SECURITY.md` + `README.md` — pause/resume/killAll are
  operator-only; no syscall exposes them (grep over
  `packages/kernel/src/syscall/` confirms it), same containment shape as
  "no syscall can resolve its own approval."

## Commits

- `feat(kernel,dashboard,cli): add a global pause switch for the daemon`
  (c250747) — the feature itself.
- `docs: mention the global pause switch alongside the budget circuit
  breaker` (f65f67c) — README bullet.
- `Merge remote-tracking branch 'origin/main' into
  coo/global-pause-switch` (64ce8f5) — picked up an unrelated `main`
  advance.
- `fix(adapters): pin now in the decisions reconcile default-flow test`
  (9ac9991) — ported the fix for the unrelated CI blocker described
  below.

## Validator findings

Ran the exact commands from `.github/workflows/ci.yml`
(`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build` from a clean
`dist/`, `pnpm -r run typecheck`, `pnpm test`), all clean for `shared`,
`kernel`, `dashboard`, and `cli`:
- kernel: 60 files / 318 tests passed, including new
  `scheduler.pause.test.ts` (pause blocks every trigger path — `every`,
  `on:`, one-shot `scheduleOnce`, `runNow`/`runSkill`; a pause row set
  before construction still blocks, simulating a restart; resume restores
  triggering; pausing/resuming each emit exactly one matching `ops.alert`;
  routine `enabled` flags are untouched across a pause/resume cycle),
  `eventLog.test.ts`'s new `getPause`/`setPause` round-trip cases, and
  `processManager.test.ts`'s new `killAll()` cases.
- dashboard: 32 files / 124 tests passed, including new
  `SystemPauseBar.test.tsx` (slim control when running, banner + "by
  <who>"/"no reason given" on load when already paused, pause via the
  confirm dialog, resume, and a live refresh off a `daemon_paused`
  `ops.alert`).
- cli: new `system.command.test.ts` (pause passes `reason`/`by: 'cli'`/
  `stopRunning` through, reports a stopped-run count, resume calls
  through).

**CI blocker, not this PR's own:** GitHub Actions first ran this PR's
head (`f65f67c`) red on `packages/adapters/src/techpulseCoo/
decisions.test.ts` — a pre-existing, unrelated test whose fixture hard-
coded `createdAt: '2026-09-10'` without pinning `now`, so the assertion
went stale once real wall-clock time crossed the 3-day nudge threshold on
2026-09-13, independent of this PR's diff (reproduced identically on a
clean `main` checkout). Diagnosed and posted as a PR comment with a
proposed patch rather than widening this PR to fix unrelated code. A
later commit (`9ac9991`) ported that exact patch — pinning `now` via the
file's own `daysLater(1)` helper, matching every other test in the file —
after merging `main` in. CI on the new head (`9ac9911`) ran green:
`ci` conclusion `success`, `mergeable_state: clean`, no open review
threads.

## Product review

- **Observable**: yes — a persistent dashboard header control on every
  panel (not just Routines), a red banner stating who paused it, when,
  and why, and `daemon_paused`/`daemon_resumed` entries in the Overview
  activity feed for free via the existing `ops.alert`/`classifyEvent`
  path.
- **Config-driven vs. hardcoded**: N/A for an operator control; it reuses
  the existing bearer-token auth and route-registration conventions
  rather than inventing new plumbing.
- **Containment**: no new MCP tool, no new `allowed_tools` entry, no new
  syscall — `pause`/`resume`/`killAll` are reachable only through the
  dashboard, CLI, and `/api/system/*`, documented as such in
  `docs/SECURITY.md`.
- **Docs**: README's Routines section gets a new "Pause" bullet
  alongside the budget circuit breaker; SECURITY.md gets a containment
  note.
- **Empty/error states**: an empty reason still pauses, shown as "no
  reason given" rather than blocking the action; a transient `GET
  /api/system/pause` fetch failure leaves the last known banner state
  instead of flashing to "not paused."

One deliberate scope call worth flagging: `by` defaults to the calling
surface's name (`'cli'` or `'dashboard'`) rather than an actual operator
identity, since agent-os has no login/identity system to draw from — the
proposal's own "says who paused it" bar is met without inventing one.

Both validator and product review pass, and PR #19's CI ran green with a
clean, conflict-free merge state and no open review threads. Marked
`shipped`; `Shipped: 4/4`.
