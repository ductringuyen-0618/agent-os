---
status: proposed
attempts: 0
branch: null
---
# Flag stale wiki pages instead of trusting them silently

## What you get
Every wiki page already carries an `updated` timestamp that nobody reads.
From now on, any page older than a configurable threshold shows up as
stale everywhere it matters: a "Stale" badge and filter in the dashboard's
Wiki panel, a stale-page count on the Overview pulse strip, and — the part
that actually changes agent behavior — a "Stale pages" section appended to
what `get_context()` hands every single run, so the model reading its own
memory before acting is told which of it hasn't been checked in a while
instead of restating an old fact with the same confidence as a fresh one.

## Why start this now
2026 write-ups on agent memory (Hindsight's "Staleness-Aware Memory",
Mem0's library notes, a Tianpan post surveying Mem0/Zep/Letta/LangMem/MemOS)
converge on the same gap: stale memory is a confidence problem, not a
missing-data problem, because an agent restates an outdated fact as fluently
as a true one, and staleness handling is, in Mem0's own words, still
"unresolved" across most memory frameworks. An arXiv study of VLM agents
(2608.04574) found trusting raw stale memory made an agent die more than
twice as often as giving it no memory at all. agent-os's `lint` skill
already claims to hunt "stale claims" per the design spec, but today that's
just a sentence in `skills/lint/skill.md` — there is no structured signal
anywhere (not in `WikiPageMeta`, not in `get_context()`, not in the
dashboard) for a page's age, so lint can only catch staleness if the model
happens to notice during a nightly run, and the operator can only find out
by opening a raw `wiki/lint-report.md` page by hand. A page's `updated`
field already exists in every page's frontmatter and in `index.md` — this
is a read-side feature that turns data already being written into a signal
every consumer (model, lint, operator) gets for free.

## Problem / opportunity
`WikiService.listPages()` (`packages/kernel/src/wiki/wikiService.ts`)
returns `updated` on every `WikiPageMeta` but nothing downstream uses its
age. `get_context()` (`packages/kernel/src/syscall/handler.ts`, case
`'get_context'`) hands every run `business-brain.md` + `index.md` verbatim,
with no indication that an entry describing `projects/techpulse/overview.md`
might be three weeks stale while the project has since shipped four more
proposals. The dashboard's `WikiPanel`
(`packages/dashboard/src/panels/WikiPanel.tsx`) lists pages with a
`relativeTime` stamp but nothing flags "this is old enough to doubt," and
`OverviewPanel`'s pulse strip has no memory-health signal at all. The
research above is consistent that the fix isn't deleting old facts (the
"verify, don't discard" framing) — it's surfacing age as a first-class
signal everywhere a page gets read.

## Proposed solution
- `packages/shared/src/types/wiki.ts` (or wherever `WikiPageMeta` is
  defined): add `staleDays: number` and `stale: boolean`.
- `packages/kernel/src/wiki/wikiService.ts`: `listPages()` computes
  `staleDays` from `updated` vs. now, and `stale` against a single exported
  `STALE_AFTER_DAYS` constant (default 14, matching the "linear decay
  threshold" shape the Hindsight posts describe) — one constant, no new
  config surface, to keep this scoped.
- Add a `WikiService.staleSummary()` helper returning the stale pages
  (path, title, staleDays), sorted oldest-first.
- `packages/kernel/src/syscall/handler.ts`'s `get_context` case: append a
  `## Stale pages` section to the returned context (page path + days since
  verified) when `staleSummary()` is non-empty; omit the section entirely
  when nothing is stale, so a healthy wiki reads exactly as it does today.
- `packages/dashboard/src/panels/WikiPanel.tsx`: an amber "Stale (Nd)"
  badge per row past the threshold, plus a filter chip ("Stale only")
  next to the existing group filter.
- `packages/dashboard/src/panels/OverviewPanel.tsx`: a pulse-strip tick
  showing the stale-page count when it's greater than zero (no tick when
  everything's fresh — an explicit empty state, not a "0" chip sitting
  there every day).
- No change to any skill prompt, routine, or syscall signature beyond the
  additive `get_context()` return shape — `remember`/`read_wiki` and every
  existing caller of `get_context()` keep working unchanged.

## Effort estimate
S — one shared type, one kernel computation plus one syscall-handler
change, two dashboard components, all additive. No new routine, no new
config file, no schema migration (frontmatter already has `updated`).

## Validation contract
- Functional assertions:
  - `WikiPageMeta` has `staleDays: number` and `stale: boolean`; a page
    written "now" has `staleDays === 0` and `stale === false`.
  - A page whose frontmatter `updated` is more than `STALE_AFTER_DAYS` old
    has `stale === true`.
  - `WikiService.staleSummary()` returns only stale pages, sorted oldest
    `staleDays` first, and an empty array when none are stale.
  - `get_context()`'s returned context string contains a `## Stale pages`
    section listing each stale page's path and age when
    `staleSummary()` is non-empty.
- Behavioral assertions:
  - `get_context()`'s output is byte-identical to today's (no `## Stale
    pages` section at all) when no page is stale — the feature is additive,
    not a format change for the common case.
  - `WikiPanel` renders a stale badge only on pages past the threshold, and
    the "Stale only" filter shows exactly those pages.
  - `OverviewPanel`'s pulse strip shows no stale tick when the stale count
    is 0.
- Negative assertions (should NOT happen):
  - No skill's `skill.md`, no routine in `routines.yaml`, and no syscall
    other than `get_context()`'s return shape changes.
  - Nothing is deleted, hidden, or blocked from being read because it's
    stale — `read_wiki`/`remember` behave exactly as before; staleness is
    informational only (per the "verify, don't discard" framing the
    research above argues for).
  - No new dependency, no new config file, no absolute paths.
- Test commands the build will need to pass (from `.github/workflows/ci.yml`):
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm -r run typecheck`
  - `pnpm test`

## Risks / open questions
- A single global threshold (14 days) treats a fast-moving `projects/*`
  page the same as a stable `concepts/*` page; a per-`type` threshold map
  is a natural follow-up but is left out here to keep this an S-sized,
  single-constant change.
- `get_context()`'s payload growing by a bounded list of paths is cheap,
  but if a wiki ever accumulates hundreds of stale pages the section should
  cap at, say, the 20 oldest rather than list everything — worth deciding
  during implementation, not blocking the proposal.

Sources: Hindsight, "Staleness-Aware Memory: When Your Agent Should Verify
Before It Trusts" (hindsight.vectorize.io, 2026-06-17); Hindsight, "The
Consolidation Problem in Agent Memory" (2026-05-21); Mem0, "Memory
Staleness" library note (mem0.ai); Tianpan, "Agent Memory Cache Without an
Invalidation Policy" (2026-05-16); arXiv:2608.04574 (VLM agent memory
study).
