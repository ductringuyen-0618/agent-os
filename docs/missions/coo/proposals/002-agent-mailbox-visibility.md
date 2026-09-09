---
status: in_progress
attempts: 0
branch: coo/agent-mailbox-visibility
---
# Surface the agent-to-agent mailbox in the API and dashboard

## What you get
A Messages panel in the dashboard and a `GET /api/messages` route, so every
note one agent sends another (`send_message` / `read_inbox`) is visible: who
sent it, to whom, when, and whether it was read. Each send also emits a
`message.sent` event, so it shows in the live activity feed and the pulse strip.

## Why start this now
Agent-to-agent messaging already works in the kernel, but it is the one
channel the operator cannot see. If `ops` tells `librarian` something today,
the only way to know is to open the SQLite file. As more routines and agents are
added, coordination you cannot observe is coordination you cannot debug or trust.
The messages table, both syscalls and the event type already exist, so this is a
small change that closes a real blind spot in the command centre.

## Problem / opportunity
`send_message`/`read_inbox` are two of the eight syscalls in
`docs/SECURITY.md`'s "what an agent can do" list, and
`packages/kernel/src/log/eventLog.ts` already has a working `messages`
table (`sendMessage`, `readInbox`) with round-trip tests
(`eventLog.test.ts`, `handler.test.ts`). `EventType` even already declares
a `'message.sent'` variant in `packages/shared/src/types/event.ts`. But
nothing ever emits that event, no HTTP route reads the `messages` table,
and no dashboard panel renders it — grep confirms zero references to
`message.sent`, `/api/messages`, or a "Messages"/"Mailbox" panel anywhere
in `packages/kernel/src/api` or `packages/dashboard/src`. Agent-to-agent
coordination is a real, working feature of the kernel that is completely
invisible to the human operating the dashboard: if `ops` sends `librarian`
a note today, the only way to know it happened is to open the SQLite file
directly. For an "OS" whose whole pitch is a legible command centre for a
team of agents, the one channel by which agents actually coordinate with
each other has no window onto it at all.

## What we learned from research
- Coverage of 2026 multi-agent observability platforms (AgentOps, Langfuse,
  LangSmith — see [Top 6 Agent Observability Platforms](https://laminar.sh/article/top-6-agent-observability-platforms)
  and the CrewAI/AutoGen/LangGraph comparison in [10 AI Agent Frameworks You
  Should Know in 2026](https://medium.com/@atnoforgenai/10-ai-agent-frameworks-you-should-know-in-2026-langgraph-crewai-autogen-more-2e0be4055556))
  converges on one specific point: the thing worth tracing in a multi-agent
  system isn't just each agent's own LLM calls, it's the **handoffs and
  inter-agent messages** — state mutations and tool I/O *between* agents,
  not only within one. AgentOps in particular is described as tracking
  "multi-step session traces... and agent-level cost attribution" across
  a *team*, not a single agent's transcript.
- The concrete mechanism being borrowed is narrow and doesn't need a
  tracing vendor or OpenTelemetry export: it's "the inter-agent channel
  gets its own read surface in the same observability plane as everything
  else" — agent-os already has that plane (`EventLog` → WebSocket →
  dashboard panels for Runs/Decisions/Wiki); the mailbox is the one
  syscall-backed data source that was left out of it.
- This also closes a small internal inconsistency: `message.sent` already
  exists in the `EventType` union (dead code today, since nothing appends
  one), and the dashboard's existing per-panel pattern (`RunsPanel`,
  `DecisionsPanel`) already assumes "every kernel-mediated action shows up
  as a row somewhere" — the mailbox is the one syscall that breaks that
  assumption today.

## Proposed solution
- `packages/kernel/src/log/eventLog.ts`: `sendMessage()` additionally calls
  `this.append({ type: 'message.sent', payload: { id: m.id, from: m.from,
  to: m.to } })` (body excluded from the event payload — the event is a
  liveness signal for the WebSocket feed; the message body itself is read
  from the `messages` table by the new route below, not duplicated into
  the event log). Add a read-only `listMessages(limit = 100):
  Message[]` method (all messages, newest first, no `read_at` mutation —
  unlike `readInbox`, this must not have the side effect of marking
  anything read, since it's for operator viewing, not agent consumption).
- `packages/kernel/src/api/server.ts`: add `GET /api/messages?limit=`
  returning `listMessages`'s rows shaped like the existing `/api/costs`
  route (flat JSON array, `{ id, from, to, body, ts, readAt }`).
- `packages/shared`: add the `Message`-shaped API type alongside the
  existing `CostEntry`-style exported types so the dashboard's API client
  gets it for free.
- `packages/dashboard/src/api/client.ts`: add a `messages(limit?)` method
  matching the existing `costs(days)` method's shape.
- `packages/dashboard/src/panels/MessagesPanel.tsx` (new, following
  `RunsPanel.tsx`'s structure): a table of `from → to`, `body` (truncated,
  full text on hover/expand), relative timestamp, and a read/unread dot
  driven by `readAt`. Subscribes to the existing WebSocket feed the way
  `RunsPanel` already does and prepends new rows on `message.sent` events
  without a full refetch. Empty state: "No messages yet — agents talk to
  each other via `send_message`; the first one will show up here."
- Add a **Messages** entry to the dashboard's panel navigation (wherever
  Agents/Runs/Decisions/Wiki/Skills/Routines/Costs are currently listed —
  same list, same styling, no new nav pattern).
- No new runtime dependency, no schema change (the `messages` table
  already exists), no change to `send_message`/`read_inbox`'s existing
  behavior or containment — this only adds a read path and one event
  emission on an existing write path.

## Effort estimate
S — the `messages` table and both syscalls already exist and are tested;
this is one new event-append call, one new read-only query method, one
new route mirroring `/api/costs`, one new panel mirroring `RunsPanel`, and
one nav entry.

## Proposed solution notes on scope
Read-only for this pass: no dashboard-side "send a message as the
operator" compose box. Agents already coordinate autonomously via the
syscall; the goal here is visibility into that coordination, not a new
human-in-the-loop input surface (which would also raise the question of
which agent "the operator" is posing as — out of scope, and not something
the validation contract below should need to answer).

## Validation contract
- Functional assertions:
  - Calling the `send_message` syscall now results in exactly one
    `message.sent` event appended to the log with `{ id, from, to }` in
    its payload, in addition to the existing `messages` table insert.
  - `GET /api/messages` returns the `messages` table's rows (newest
    first, respecting `limit`), including messages that have never been
    read via `read_inbox`.
  - Calling `GET /api/messages` does not change any row's `read_at` —
    `read_inbox`'s mark-as-read side effect is unaffected and remains the
    only writer of `read_at`.
- Behavioral assertions:
  - `MessagesPanel` renders a new row live (via the WebSocket
    `message.sent` event) without a manual refresh, matching
    `RunsPanel`'s existing live-update behavior.
  - The empty state renders correctly on a fresh instance with zero
    messages ever sent.
- Negative assertions (should NOT happen):
  - `read_inbox`'s existing behavior (returns and marks read only the
    calling agent's messages) must not change — verified by the existing
    `handler.test.ts`/`eventLog.test.ts` cases continuing to pass
    unmodified.
  - The new `message.sent` event payload must not include the message
    `body` (keeps the event log itself lighter and avoids duplicating the
    one piece of mailbox content that might legitimately need redaction
    review later — the `messages` table stays the single source of truth
    for body text).
  - No new MCP tool and no new `allowed_tools` entry — this is pure
    kernel/API/dashboard, nothing a `claude -p` run touches differently.
- Containment assertions:
  - No absolute paths, hostnames, or secrets introduced in any changed
    file.
  - `remember`'s redaction path is untouched; this proposal does not add
    any new way for agent-authored text to reach a committed file — the
    mailbox already existed as a syscall, this only exposes it for
    reading via the same loopback-bound API the rest of the dashboard
    uses.
- Test commands the build will need to pass: `pnpm -r --if-present
  typecheck`, `pnpm lint`, `pnpm -r --if-present test` (new
  `eventLog.test.ts` case asserting the `message.sent` append and the new
  `listMessages` method; new `server.test.ts` case for `GET
  /api/messages`; new `MessagesPanel.test.tsx`), `pnpm build`, and the
  dashboard Playwright e2e (a dashboard panel and route are added).

## Risks / open questions
- Message volume: if agents chatter heavily, an unbounded "all messages"
  table scan could get slow; the `limit` parameter and an index on `ts`
  (check whether the `messages` table already has one — `eventLog.ts`'s
  existing `readInbox` query suggests it does, since it already sorts by
  `ts`) should cover this at the scale a single-daemon instance runs at,
  but worth a second look if the table indexing turns out to only cover
  `to_agent`.
- Whether the message body should be truncated/redacted through the same
  `findSecrets` check `remember` uses, given the mailbox is now
  operator-visible rather than purely inter-agent — leaving as an open
  question rather than in scope, since `send_message` payloads are
  agent-authored (from a bounded, allowlisted skill), not raw external
  input, and this proposal doesn't change what an agent is allowed to put
  in a message body.
