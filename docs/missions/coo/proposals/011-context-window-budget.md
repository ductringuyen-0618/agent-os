---
status: in_progress
attempts: 0
branch: coo/context-window-budget
---
# Warn before a run's context window fills, not after it degrades

## What you get
Every completed run already reports its token usage, but nothing in
agent-os ever compares that number to the model's actual context window —
so an operator has no way to tell a run that used 20,000 tokens from one
that used 180,000 of a 200,000-token window, right before the one that
quietly produced a worse result. After this ships, the Runs panel shows
each run's context usage as a percentage of its model's window, and a run
that crosses a configurable warning threshold (default 85%, overridable
per routine like `daily_budget_usd` already is) raises the same kind of
`ops.alert` the budget breaker raises today — visible in the dashboard and
noted on `agents/<agent>.md` by the heartbeat skill.

## Why start this now
Several practitioner write-ups from this year converge on the same
finding: LLM agents don't fail cleanly when a context window fills, they
degrade quietly well before it's full ("context rot"), and the fix isn't
a hard cutoff but visibility — tracking fullness and warning in bands
(one guide puts the zones at roughly 50/75/90% of the window) before
quality erosion sets in (getunblocked.com, "What Is Context Rot? Why AI
Agents Degrade Mid-Session"; a forum field note, "seeing your agent's
token budget before a run, not after", makes the same before-not-after
point this proposal is named for). A developer case study measured a
200K-token window reaching 87% full in about 33 minutes of agent work,
driven by accumulated history rather than the task itself (dev.to, "My AI
Agent Ate 178,000 Tokens in 30 Minutes") — exactly the kind of run
agent-os schedules unattended, overnight, with no one watching it happen.
agent-os already captures every run's `input_tokens` for cost accounting
and already has the exact mechanism this needs, proven out by
`daily_budget_usd`: a per-routine threshold, a deduped `ops.alert` when
it's crossed, a chip in the dashboard. Nothing here is new infrastructure;
it's the same breaker pattern pointed at a different number the kernel
already has in hand and currently throws away.

## Problem / opportunity
`ProcessManager.start()` (`packages/kernel/src/process/processManager.ts`)
reads `usage.input_tokens`/`usage.output_tokens` off the `claude -p`
result message and `kernel.ts`'s `exec()` persists them via
`this.log.updateRun(...)` (`packages/kernel/src/kernel.ts:190-195`) purely
for `costUsd` math. There is no table anywhere in the repo mapping a model
id to its context window size, so no code path can ever ask "how full was
this run?" The dashboard's `CostsPanel`/`RunsPanel` show dollars, never
tokens. An operator who schedules a long-running skill on a routine with a
growing `--resume` history (the wrap-up turn, multi-step workflows) has no
signal that a run is approaching the point where quality degrades — they
find out only after a bad output or an outright failure, by which point
the run already burned the budget `daily_budget_usd` tracks.

## Proposed solution
- `packages/shared/src/types/model.ts` (new): a small
  `CONTEXT_WINDOWS: Record<string, number>` table for the model ids this
  repo actually uses (`claude-sonnet-5`, `claude-opus-5-5`,
  `claude-haiku-5-5`, their `[1m]`-suffixed variants at 1,000,000, etc.)
  and `contextWindowFor(model: string): number`, falling back to 200,000
  for an unrecognized id so the check degrades safely instead of
  throwing.
- `packages/shared/src/types/routine.ts`: add
  `context_warn_pct?: number` to both `RoutineDefaults` (required, with a
  repo default of `0.85` set in the example `routines.yaml`) and
  `RoutineConfig` (optional override), the same shape
  `daily_budget_usd` already uses.
- `packages/kernel/src/kernel.ts`: right after the existing
  `this.log.updateRun(activeRun.id, { costUsd, inputTokens, ... })` call
  in `exec()`, compute `contextWindowFor(common.model)`, store it as a new
  `contextWindow` field on the run (so the dashboard never has to
  resolve a model id itself), and when
  `inputTokens / contextWindow >= (routine.context_warn_pct ?? defaults.context_warn_pct)`
  append one `ops.alert` with
  `{ routine: routine.name, reason: 'context_budget_warning', model, inputTokens, contextWindow, pct }`
  — mirroring `Scheduler.budgetTripped()`'s alert shape exactly.
- `packages/kernel/src/log/eventLog.ts`: an additive `context_window
  INTEGER` column on `runs` (same migration pattern used for
  `decisions.project` and the trigger-lineage-style columns already in
  this file), read back on `rowToRun`.
- `packages/dashboard/src/panels/RunsPanel.tsx`: next to each run's cost,
  a small fullness chip (e.g. "62% ctx") computed from
  `inputTokens / contextWindow`, styled like the existing budget-hit chip
  once the run crosses its warn threshold.
- `examples/os-template/os/skills/heartbeat/skill.md`: extend step 2 (it
  already writes a note to `agents/<agent>.md` for a failed or missed
  run) to do the same for any run whose `routineStatus` entry carries a
  context-budget `ops.alert` — no new syscall, it reuses the alert the
  kernel already emits.

## Effort estimate
S/M — one new shared constants file, one additive routine-config field
with a sensible default, one additive DB column following an established
migration pattern, a handful of lines in `kernel.ts`'s existing `exec()`
path, and one dashboard chip. No new syscall, no new routine type, no
change to any skill's contract beyond heartbeat reading one more alert
reason it's already built to surface.

## Validation contract
- Functional assertions:
  - `contextWindowFor('claude-sonnet-5')` and known model ids return their
    documented window size; an unrecognized model id returns the 200,000
    fallback instead of throwing.
  - A completed run's `contextWindow` and `inputTokens` round-trip through
    `EventLog.createRun`/`getRun`/`updateRun` unchanged; a database created
    before this change still opens (additive column, no data loss).
  - A run whose `inputTokens / contextWindow` crosses
    `context_warn_pct` (default 0.85, overridable per routine) appends
    exactly one `ops.alert` with `reason: 'context_budget_warning'`; one
    that doesn't cross it appends none.
- Behavioral assertions:
  - `RunsPanel` renders a context-fullness chip on every run row with a
    known `contextWindow`; the chip's style changes once the run is at or
    above its warn threshold.
  - A run with no `inputTokens` (e.g. `killed` before any result message)
    renders no fullness chip rather than `NaN%`.
- Negative assertions (should NOT happen):
  - No hard stop or run cancellation — this is a warning signal only,
    never a circuit breaker like `daily_budget_usd`'s `budgetTripped`.
  - No change to any skill's `skill.md` contract, `routines.yaml` shape
    beyond the one new optional field, or syscall signature.
  - No new dependency, no new config file, no absolute paths.
- Test commands the build will need to pass (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- The model-to-window table is a static, hand-maintained list; a new
  model id not yet added falls back to the conservative 200,000-token
  default rather than silently under-warning, but it should still be kept
  current as models change.
- `claude -p`'s result-message `usage.input_tokens` reflects the final
  turn's reported input, not necessarily a perfect running total across
  every internal tool-call turn inside one run — worth confirming at
  implementation time against a real multi-tool-call run's stream-json
  output before trusting the number for anything beyond a warning signal.

Sources: getunblocked.com, "What Is Context Rot? Why AI Agents Degrade
Mid-Session"; forum.cursor.com, "Field note: seeing your agent's token
budget before a run, not after"; dev.to, "My AI Agent Ate 178,000 Tokens
in 30 Minutes — Here's Why (and How to Prevent It)".
