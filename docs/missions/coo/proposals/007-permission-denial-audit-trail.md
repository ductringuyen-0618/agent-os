---
status: expired
attempts: 0
branch: null
---
# Surface denied tool-call attempts as a containment audit trail

## What you get
Every time a run's model tries to call a tool, MCP server, or command its
routine didn't grant it — and Claude Code's own permission system blocks
it — agent-os now records that attempt as a first-class
`security.permission_denied` event (which run, which agent/routine, which
tool, what it tried to pass) instead of burying it inside the raw
stream-json blob nobody reads. The Runs panel flags the run and the
Agents panel shows a small "containment: N denied" badge next to any
agent that has ever tripped it, the same way a "budget tripped" or
"overlap skipped" chip already shows other guardrails firing.

## Why start this now
Containment — `allowed_tools` plus `--strict-mcp-config` — is the entire
security story in `docs/SECURITY.md`: it's the one thing standing between
an agent and anything outside its sandbox. But today the system only ever
records what an agent *did*, never a moment where it tried to do more and
was stopped. Claude Code's own stream-json already reports this: the
`result` event carries a `permission_denials` array (`tool_name`,
`tool_use_id`, `tool_input`) whenever a call is blocked, and
`processManager.ts` already reads that exact `result` message for cost
and error fields — it just doesn't look at this one field. 2026 write-ups
on agent governance are converging on the same requirement: an attempt to
invoke an unapproved tool should itself generate an audit alert, not just
fail silently ("Agent Runtime Guardrails in 2026", FutureAGI; "Runtime
Verification for AI Agents in 2026", The Backend Developers). agent-os
already has this exact pattern for two narrower boundaries — `remember`
rejecting a secret emits `security.redacted`, a routine outrunning its
own interval emits `ops.alert` — this closes the same gap for the
boundary the whole security model actually rests on. If a compromised
skill, a poisoned `raw/` document, or an unexpected model behavior ever
tries to step outside its allowlist, today there is no way to know short
of grepping SQLite JSON payloads by hand; every day without this is a day
that attempt would go unnoticed.

## Problem / opportunity
`ProcessManager.run()` in `packages/kernel/src/process/processManager.ts`
parses every stream-json `result` message twice (once per stdout chunk
loop, once for a trailing partial line) and already destructures
`total_cost_usd`, `usage`, `result`, and `is_error` off it. It never reads
`permission_denials`, so a blocked tool call is indistinguishable in the
event log from every other line of the run's `run.stream` payload — the
one signal that containment actually fired is the one signal nobody
surfaces.

## Proposed solution
- `packages/shared/src/types/event.ts` and `schemas.ts`: add
  `'security.permission_denied'` to `EventType` / `BUILTIN_EVENT_TYPES`.
- `packages/kernel/src/process/processManager.ts`: factor the duplicated
  `msg.type === 'result'` handling (currently copy-pasted for the
  streaming-chunk loop and the trailing-buffer flush) into one helper, and
  in it, for each entry in `msg.permission_denials ?? []`, append one
  `security.permission_denied` event carrying `runId`, the run's
  `agentName`/`routineName`, `toolName`, `toolUseId`, and `toolInput`.
- `packages/dashboard/src/lib/events.ts`: label/format the new event type
  the way `security.redacted` already is.
- `packages/dashboard/src/panels/RunsPanel.tsx`: flag a run that has at
  least one `security.permission_denied` event in its stream.
- `packages/dashboard/src/panels/AgentsPanel.tsx` (or wherever the
  existing "budget tripped"/"overlap skipped" chips render): add a
  "containment: N denied" chip, counting `security.permission_denied`
  events per agent.
- `tools/fake-claude/fixtures/`: add a fixture whose `result` message
  includes a `permission_denials` entry, for kernel and dashboard tests.

## Effort estimate
S — one new event type following an existing pattern (`security.redacted`,
`ops.alert`), one field the kernel already has in hand but doesn't read,
one dashboard chip next to two that already exist. No new dependency, no
schema migration, no paid service.

## Validation contract
- Functional assertions:
  - A `result` stream-json message with a non-empty `permission_denials`
    array causes `ProcessManager.run()` to append one
    `security.permission_denied` event per denial, each carrying the
    run id, agent/routine name, `toolName`, `toolUseId`, and `toolInput`.
  - A `result` message with no `permission_denials` field (or an empty
    array) emits zero `security.permission_denied` events — the existing
    fixtures' event counts do not change.
  - The trailing-buffer-flush code path (the last unterminated stream
    line) is covered exactly like the main chunk loop — no duplicated,
    diverging logic.
- Behavioral assertions:
  - The Runs panel visibly flags a run that has a
    `security.permission_denied` event in its stream.
  - The Agents (or Routines) panel shows a "containment: N denied" chip
    for an agent whose runs have tripped this, and shows nothing extra
    for an agent that never has.
- Negative assertions (should NOT happen):
  - No existing event type, route, or panel behavior changes for runs
    with zero permission denials.
  - `toolInput` is stored the same way other `run.stream` tool payloads
    already are today — this does not introduce a new secret-redaction
    requirement beyond what `remember`/`wiki/redact.ts` already covers,
    and does not claim to add one.
- Test commands the build will need to pass (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- The exact shape of `permission_denials` (field names, whether it can
  appear on a `subtype: 'success'` result) should be pinned down against
  the installed Claude Code CLI's actual stream-json output before
  relying on it in tests, not just this proposal's description of it.
- Whether to also flag this on the **Overview** panel's pulse strip (like
  other alerts) or keep it scoped to Runs/Agents is a judgment call for
  whoever builds this — either is a small, additive choice that doesn't
  change the core event.
