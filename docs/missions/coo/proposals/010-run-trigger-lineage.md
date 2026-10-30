---
status: expired
attempts: 0
branch: null
---
# Show what caused every run, not just what it did

## What you get
Every run in the dashboard's Runs panel gets a small "triggered by" chip:
cron, an interval, a manual run-now click, a retry of an earlier attempt,
or — the useful one — an event, naming the exact upstream run that emitted
it. Click that chip and the panel jumps straight to the run that caused
this one. A chain like "techpulse-sync fired on its hourly interval → it
emitted `raw.added` → that triggered this `ingest` run" becomes three
clicks instead of a manual cross-reference of timestamps in the Runs list.

## Why start this now
A 2026 survey on LLM agent observability (arXiv:2606.04990, "From Agent
Traces to Trust") argues that trust and debuggability come from treating
execution as a provenance graph — causal links between actions, not just
a log of what happened — and a practitioner guide on 2026 agent tracing
(bump.arahi.ai's "AI Agent Observability Guide") lists a parent-run
reference as one of the minimum fields a trace needs, while noting most
tooling still doesn't record *what triggered* a run at all; a separate
guide on multi-agent tracing (openlayer.com) warns that without a
propagated cause id, root-cause attribution becomes guesswork. agent-os
already has the data this needs sitting unused: `Event` has carried an
optional `runId` (the run that emitted it) since the kernel's event log
was built, and `routines.yaml`'s `after:` gates and `on:` event triggers
already create real causal chains today (`lint` → `daily-digest`,
`techpulse-sync`'s `raw.added` → `ingest`) — `Run` just never records which
mechanism or upstream run caused it to fire. That makes this a read-side,
additive feature exactly like the shipped mailbox-visibility and
skill-score-trend proposals: no new infrastructure, just surfacing a causal
link the kernel already has access to at the moment it creates each run.

## Problem / opportunity
`packages/shared/src/types/run.ts`'s `Run` interface has no field for why a
run started. `Scheduler.trigger()`
(`packages/kernel/src/scheduler/scheduler.ts`) is called from a cron job,
an `every:` interval timer, and `onEvent()` (for `on:` triggers) with no
distinction once it reaches `createRun`; retries in `handleFailure` and
restart-requeues in `recoverFromRestart` create a fresh run with no pointer
back to the attempt that failed. The Runs panel
(`packages/dashboard/src/panels/RunsPanel.tsx`) therefore shows every run as
an unconnected row — an operator watching `ingest` fire has to notice a
`raw.added` event at roughly the same timestamp and guess it was the cause.
`onEvent(e: Event)` already receives `e.runId`, the id of the run that
called `emit_event` to produce it (set wherever the kernel appends events on
a run's behalf) — the exact upstream run id is one assignment away from
being thrown away.

## Proposed solution
- `packages/shared/src/types/run.ts`: add
  ```ts
  export type RunTrigger =
    | { kind: 'cron' | 'interval' | 'manual' | 'schedule' }
    | { kind: 'event'; eventType: string; sourceRunId?: string }
    | { kind: 'retry'; parentRunId: string }
  ```
  and `triggeredBy?: RunTrigger` on `Run`.
- `packages/kernel/src/log/eventLog.ts`: add a `triggered_by TEXT` column to
  `schema.sql`'s `runs` table and an additive migration for existing
  databases (same pattern `migrate()` already uses for `decisions.project`);
  `createRun` persists `JSON.stringify(r.triggeredBy)`; `rowToRun` parses it
  back.
- `packages/kernel/src/scheduler/scheduler.ts`: thread a `triggeredBy`
  through to every `createRun` call —
  `{ kind: 'cron' }`/`{ kind: 'interval' }` from `scheduleRoutine`'s timers,
  `{ kind: 'event', eventType: e.type, sourceRunId: e.runId }` from
  `onEvent`, `{ kind: 'manual' }` from `runNow`/`runSkill`,
  `{ kind: 'retry', parentRunId: run.id }` from `handleFailure`'s retry and
  `recoverFromRestart`'s requeue, `{ kind: 'schedule' }` from
  `processDueSchedules`.
- `packages/kernel/src/api/server.ts`: no shape change expected (`Run` already
  serializes whole); add a test confirming `triggeredBy` round-trips through
  `GET /api/runs`.
- `packages/dashboard/src/panels/RunsPanel.tsx`: a small chip per run
  (⏰ cron / 🔁 interval / ▶ manual / ↻ retry / the event name for
  event-triggered runs); when `sourceRunId` or `parentRunId` is present the
  chip is a button that selects that run in the same list.
- No change to any skill, `routines.yaml` shape, or syscall — `emit_event`'s
  signature and every existing caller of the scheduler's public methods stay
  the same; this only adds a field.

## Effort estimate
S/M — one shared type, one additive DB column + migration (an established
pattern in this file), a handful of call sites in `scheduler.ts` that already
funnel through `createRun`, and one dashboard component. No new routine, no
new syscall, no schema migration tool.

## Validation contract
- Functional assertions:
  - A run created from a cron-fired routine has
    `triggeredBy: { kind: 'cron' }`; an `every:` routine gets
    `{ kind: 'interval' }`.
  - A run created from `onEvent` for an `on: [raw.added]` routine has
    `triggeredBy: { kind: 'event', eventType: 'raw.added', sourceRunId }`
    equal to the emitting run's id when that event carried one.
  - `runNow`/`runSkill` produce `{ kind: 'manual' }`; a retry from
    `handleFailure` produces `{ kind: 'retry', parentRunId: <failed run id> }`.
  - `EventLog.createRun`/`getRun` round-trip `triggeredBy` through SQLite
    unchanged; a database created before this change still opens (migration
    adds the column without data loss).
- Behavioral assertions:
  - `RunsPanel` renders a trigger chip on every run row; clicking a chip
    with a `sourceRunId`/`parentRunId` selects that run.
  - A run with no resolvable upstream run (e.g. an event with no `runId`)
    still renders its event-name chip, just without a click target.
- Negative assertions (should NOT happen):
  - No skill's `skill.md`, no `routines.yaml` shape, and no syscall
    signature (`emit_event`, `get_context`, etc.) changes.
  - An older on-disk database without the new column still loads without
    manual intervention.
  - No new dependency, no new config file, no absolute paths.
- Test commands the build will need to pass (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm -r --if-present typecheck`
  - `pnpm lint`
  - `pnpm -r --if-present test`
  - `pnpm build`

## Risks / open questions
- `onEvent`'s `e.runId` is only populated when the emitting code path passes
  one to `EventLog.append` — worth auditing at implementation time that every
  routine-relevant event type (`raw.added`, `proposal.changed`, custom
  events) actually sets it; where it doesn't, the chip degrades to the event
  name with no click target rather than a wrong link.
- A chain that spans more than one hop (sync → ingest → a custom event ingest
  emits) is still just one `sourceRunId` per run; following it back more than
  one step means clicking through each chip in turn rather than seeing the
  whole chain at once — acceptable for a first, S/M-sized cut, and a natural
  follow-up if it turns out to matter.

Sources: arXiv:2606.04990, "From Agent Traces to Trust: A Survey of
Evidence Tracing and Execution Provenance in LLM Agents" (June 2026);
bump.arahi.ai, "AI Agent Observability in 2026: Tools, Traces & Practice";
openlayer.com, "AI Agent Observability Guide: Tracing Actions & Tool Calls"
(July 2026).
