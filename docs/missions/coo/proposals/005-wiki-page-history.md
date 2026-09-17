---
status: proposed
attempts: 0
branch: null
---
# Wiki page history: see what changed, and undo it

## What you get
Every wiki page agent-os writes now keeps its past versions, not just its
current text. Opening a page in the dashboard shows a timeline of every
time an agent changed it — when, from which run, and what actually
changed, line by line — plus a one-click way to bring back an older
version if a change turns out to be wrong.

## Why start this now
agent-os's whole pitch is a memory an LLM builds up over time, but that
memory has no undo today: every write silently replaces a page's old
content, so one bad ingest run or one hallucinated fact permanently
erases whatever was there before, and the operator has no way to see what
changed or get it back. The two visibility gaps we closed earlier
(the agent mailbox, the skill score trend) were about seeing what agents
*do*; this is about being able to trust what they *leave behind* — the
one artifact this whole system exists to build up. It is a small, additive
change (one table written on every save that already happens, plus one
dashboard tab), and every day without it is a day a bad write to the
wiki is both invisible and unrecoverable.

## Problem / opportunity
- `WikiService.writePage()` (`packages/kernel/src/wiki/wikiService.ts:65-125`)
  is the *only* way anything durably changes `wiki/*.md`
  (`docs/SECURITY.md`'s "what an agent cannot do": no direct file writes
  to wiki content, ever). But it writes with `fs.writeFile(full, body,
  'utf8')` (line 100) — a plain overwrite. There is no snapshot of what
  the page looked like a moment before.
- The one trace of the change is `wiki.written` (line 118-122), an event
  with `path`, `result` (`created`/`updated`) and `runId` — real, but it's
  a needle in the flat `events` table, has no content, and is never read
  back anywhere (`grep -rn "wiki.written" packages/kernel/src/api`
  confirms only `wikiService.ts` writes it; nothing reads it).
- `wiki/log.md` (`appendLog`, line 116) is the human-readable trail, but
  `formatLogLine` (`packages/kernel/src/wiki/index.ts:58-60`) only ever
  emits `## [date] op | title` — a title string, not a path, a diff, or a
  link back to the run. It cannot answer "what did this page say before
  today's ingest run touched it," let alone restore it.
- `packages/kernel/src/api/wiki.ts:14-54` exposes exactly four read-only
  routes (`/index`, `/log`, `/pages`, `/page`), all returning only current
  content. `WikiPanel.tsx` (`packages/dashboard/src/panels/WikiPanel.tsx`)
  has exactly two tabs, "pages" and "log" — no per-page history, no diff,
  no restore. Confirmed: `grep -rniE "revision|version|history|diff"`
  across the wiki service, its API routes, `WikiPanel.tsx`, and
  `packages/kernel/src/log/schema.sql` returns zero matches.
- Net effect: the wiki is the one place this whole daemon is built to
  make trustworthy over time (`README.md`'s "wiki/ compounding" framing),
  and it is also the one durable store in agent-os with no audit trail
  and no undo — everywhere else (git commits for proposals, the event
  log for runs, the new `daemon_state` for pause) the "OS" framing holds;
  here it quietly doesn't.

## Proposed solution
- **`packages/kernel/src/log/schema.sql`**: add `wiki_revisions` (`id`
  autoincrement, `path`, `content` [the plain markdown body passed to
  `remember`, not the frontmatter-wrapped file], `links` [JSON array],
  `op`, `run_id`, `created_at`), indexed on `path`. Additive migration,
  same pattern as `workflows`/`workflow_steps`.
- **`WikiService.writePage()`**: after the existing `fs.writeFile` +
  index/log updates succeed, insert one row into `wiki_revisions` with
  the content/links/op/runId it just wrote. Every call — create or
  update — adds one entry, so the very first version is captured too,
  not just the diffs after it. No change to the existing write contract,
  redaction, or containment checks; this is additive logging alongside
  what already happens.
- **`packages/kernel/src/api/wiki.ts`**: two new routes —
  `GET /api/wiki/page/history?path=` (revision list: id, `created_at`,
  `run_id`, `op`, byte length — newest first, capped at 50) and
  `POST /api/wiki/page/restore` (`{ path, revisionId }`, operator-only,
  same auth as the existing write-affecting routes like
  `/api/system/pause`): loads that revision's `content`/`links`, calls
  `WikiService.writePage()` again with them (`runId` unset so it reads as
  operator-initiated, `op: 'note'`) — this *adds* a new revision matching
  the old content rather than mutating history, keeping `wiki_revisions`
  append-only like the event log. Emits `wiki.restored` (`path`,
  `revisionId`) through the same `EventLog.append` used elsewhere, so it
  shows in the activity feed.
- **`packages/dashboard/src/panels/WikiPanel.tsx`**: a third tab,
  "History," on the page viewer — a revision timeline (time, run id if
  present, "you" for operator restores, op) and, when two revisions are
  selected (or a revision and its predecessor, by default), a line-level
  diff of their content. No new dependency: a small line-diff utility
  (classic LCS-based, plain-text in/out) lives in `packages/shared` next
  to the existing schema types, unit-tested directly, so both the
  dashboard and any future CLI command can reuse it. A "Restore this
  version" button on each row calls the new restore route behind a
  confirm, mirroring the click-to-confirm pattern the pause switch and
  Decisions panel already use.
- **`packages/cli`**: no new command needed for MVP; the dashboard is the
  primary surface, consistent with how Wiki content is browsed today.

## Effort estimate
M — one migration, one additive write in an existing well-tested method,
two small API routes reusing existing auth, one shared diff utility, one
dashboard tab. No new dependencies, no changes to the containment model,
no touches to `packages/adapters`. A few days including tests.

## Validation contract
- Functional assertions:
  - Every successful `WikiService.writePage()` call inserts exactly one
    `wiki_revisions` row with the content/links/op/runId it wrote,
    including the very first write to a new page.
  - `GET /api/wiki/page/history?path=` returns that page's revisions,
    newest first, capped at 50, and 404s for a path with no revisions.
  - `POST /api/wiki/page/restore` writes a *new* revision equal to the
    requested old one, leaves every prior revision row unmodified, and
    emits one `wiki.restored` event.
  - The shared diff utility, given two content strings, returns a
    correct line-level added/removed/unchanged sequence (covered by unit
    tests with hand-checked fixtures, including empty-to-content and
    identical-content edge cases).
- Behavioral assertions:
  - The dashboard's History tab renders a page's revisions and a diff
    between two selected revisions, and updates live when a new
    `wiki.written`/`wiki.restored` event arrives over the existing
    websocket — no polling.
  - Restoring a version is only reachable from an explicit confirm click,
    never automatic.
- Negative assertions (should NOT happen):
  - Restoring a revision must never bypass `findSecrets` redaction —
    a revision containing what now matches a secret pattern (e.g. the
    ruleset changed since it was written) is refused exactly like any
    other `writePage` call, with the same `security.redacted` event.
  - Restore must never touch `raw/` or accept a path outside `wiki/`
    (reuses `resolveWikiPath`'s existing guard unchanged).
  - `wiki_revisions` rows are never updated or deleted by any code path
    added here — append-only, matching the event log's own invariant.
  - No new dependency is added to any `package.json`.
- Test commands the build will need to pass (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- Unbounded growth: a page rewritten very often (e.g. `index.md` on a
  chatty ingest cadence) accumulates one row per write forever. MVP caps
  what the API *returns* (50 newest) but doesn't prune the table; worth
  a follow-up (e.g. keep N per page, or age out after M days) once real
  usage shows whether it matters — deliberately deferred to keep this
  proposal small.
- `index.md`/`log.md` themselves go through `writePage`-adjacent paths
  too (`upsertIndexEntry`/`appendLog` write those files directly, not via
  a second `writePage` call) — this proposal only versions pages written
  through `writePage` itself (the `remember` syscall's target), which is
  every LLM-authored page; `index.md`/`log.md` stay as they are today,
  since they're derived summaries, not primary content.
- Restore re-uses `writePage`, so a restored page's `updated` frontmatter
  timestamp becomes "now," not the original time — intentional (it *is*
  a new write), but worth calling out in the History tab's copy so an
  operator isn't confused about which timestamp means what.
