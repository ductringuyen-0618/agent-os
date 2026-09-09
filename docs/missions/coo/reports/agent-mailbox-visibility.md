# Report: Surface the agent-to-agent mailbox in the API and dashboard

Proposal: `docs/missions/coo/proposals/002-agent-mailbox-visibility.md`
Branch: `coo/agent-mailbox-visibility`
PR: https://github.com/ductringuyen-0618/agent-os/pull/6

## What shipped

- `packages/kernel/src/log/eventLog.ts`: `sendMessage()` now appends a
  `message.sent` event (`{ id, from, to }`, body deliberately excluded)
  alongside its existing `messages` table insert. New read-only
  `listMessages(limit = 100)`: all messages newest first (`ts DESC`, with
  `rowid DESC` as a tie-break for same-millisecond sends), never mutates
  `read_at` — unlike `readInbox`, this is for operator viewing, not agent
  consumption.
- `packages/kernel/src/api/server.ts`: new `GET /api/messages?limit=`
  route.
- `packages/shared`: no new types needed — `Message` already existed and
  is now consumed by the dashboard client.
- `packages/dashboard/src/api/client.ts`: new `messages(limit?)` method.
- `packages/dashboard/src/panels/MessagesPanel.tsx` (new): a table of
  from → to, the message body (truncated with a title tooltip), and
  relative sent time, with a read/unread dot. Subscribes to the existing
  WebSocket feed for `message.sent` and refetches live, matching
  `RunsPanel`'s pattern. Empty state explains how messages get created.
- `packages/dashboard/src/App.tsx` + `components/Icon.tsx`: new
  **Messages** nav entry (key `8`); the "Press 1–N" hint is now derived
  from the nav list length instead of a hardcoded `7`.
- `README.md`: added Messages to the dashboard panel list in the
  architecture diagram.

## Commits

- `feat: surface the agent-to-agent mailbox in the API and dashboard`
- `style: satisfy biome formatting for MessagesPanel`

## Validator findings (Scrutiny pass)

Ran against `git diff main...HEAD` without reading the worker's reasoning:

- `pnpm -r --if-present typecheck` — pass (after building `shared` and
  `kernel` first, per the existing cross-package build order; not a
  regression, pre-existing behavior for a fresh checkout).
- `pnpm lint` (Biome) — initially failed on 3 formatting issues in the new
  `MessagesPanel.tsx` (a wrapped generic, a wrapped ternary, a wrapped JSX
  tag); fixed with `biome check --write` and re-verified clean.
- `pnpm -r --if-present test` — 145 kernel + 58 dashboard + 16 adapters +
  11 cli tests, all pass, including 3 new kernel tests (`message.sent`
  emission, `listMessages` ordering/read-state) and 2 new dashboard tests
  (`MessagesPanel` renders a message; empty state).
- `pnpm build` — pass, all 5 packages.
- `pnpm --filter @agentos/dashboard exec playwright test` — pass (1 test,
  dashboard files changed so this was required).
- `vitest run test/no-secrets-no-paths.test.ts` (repo guard test) — 377
  assertions pass; no absolute paths or secrets introduced.
- No new runtime dependency added, confirmed by `git diff` on both
  `package.json` files touched (neither was touched).

## Reviewer notes (Product pass)

- **Observable**: yes, in both the dashboard (new Messages panel, live
  updating) and the event log (`message.sent` now actually fires, closing
  a piece of dead code in `EventType`).
- **Config-driven vs. hardcoded**: N/A for this proposal — it's a pure
  read-surface addition over an existing table and syscall; no new
  behavior needed a config knob.
- **Containment**: no new MCP tool, no new `allowed_tools` entry, no
  schema migration, no change to `send_message`/`read_inbox`'s existing
  behavior. The `message.sent` event payload deliberately excludes the
  message body, keeping the event log lighter and leaving the `messages`
  table as the single source of truth for body text (matching the
  proposal's negative assertion).
- **Docs**: README's panel list now mentions Messages.
- **Empty/error states**: empty state names the mechanism (`send_message`)
  rather than just saying "nothing here"; error state matches the
  existing `ErrorState` component used by every other panel.
- Verdict: **pass**.

## Outcome

Both validator and reviewer passed. Status set to `shipped`.
