# Shipped: Skill eval-score trend in the dashboard

Proposal: `docs/missions/coo/proposals/003-skill-score-trend.md`
Branch: `coo/skill-score-trend`
PR: https://github.com/ductringuyen-0618/agent-os/pull/17
CI run: https://github.com/ductringuyen-0618/agent-os/actions/runs/34707924872

## What shipped

- `packages/kernel/src/process/promptAssembler.ts` — `wrapUpPrompt()` now
  also instructs the wrap-up turn to `emit_event` a `custom.skill_scored`
  event (`skill`, `score`, `criteria`) through the syscall that already
  permits `custom.*` payloads. No new MCP tool, no syscall change.
- `packages/kernel/src/api/skills.ts` — a new `parseSkillScored` helper
  treats a malformed or missing payload as absent rather than throwing
  (the payload is agent-authored). `GET /api/skills` sets
  `SkillMeta.lastScore` from the most recent `custom.skill_scored` event
  per skill (already-unused field since milestone 5). `GET
  /api/skills/:name` adds `scoreHistory`, oldest first, scoped to that
  skill.
- `packages/dashboard/src/panels/SkillsPanel.tsx` — a score badge next to
  the existing runs bar (using the same `rateColor` threshold convention
  as the success-rate bar), and a new "Score" tab showing the rubric
  criteria from `eval.json`, a plain inline-SVG sparkline of
  `scoreHistory` (no new charting dependency), the last self-review
  (`lastOutputMd`), and an empty state for a skill that has run but never
  been scored.
- `README.md` — one line in the Skills concept section documenting the
  new event.

## Commits

- `feat(skills): trend eval-score in the dashboard` (90af488) — one
  commit; implementation, tests, and docs together.

## Validator findings

Ran the exact commands from `.github/workflows/ci.yml`:
- `pnpm install --frozen-lockfile` — clean.
- `pnpm lint` (Biome) — clean. One fix needed during the pass: a
  `noArrayIndexKey` finding on the sparkline's `<rect>` key, resolved by
  keying on `${ts}-${runId ?? index}` instead of the bare index.
- `pnpm build` from a clean `dist` in every package — clean, all five
  packages.
- `pnpm -r run typecheck` — clean across all five packages. One fix
  needed: the first `skillScoreEvents` draft used `.map().filter()` with
  a type predicate that TS rejected over an optional vs. explicit-
  `undefined` `runId` mismatch; rewritten as a plain accumulating loop,
  which is also simpler to read.
- `pnpm test`:
  - kernel: 58 files / 300 tests passed (5 new — `parseSkillScored`
    accept/reject cases including empty skill, non-finite score, and
    wrong types; a route test asserting the malformed-event-skip path
    and oldest-first `scoreHistory` ordering; `wrapUpPrompt` asserting it
    mentions `emit_event`/`custom.skill_scored`/the skill name).
  - dashboard: 31 files / 118 tests passed (3 new/extended — score badge
    text, the Score tab rendering rubric + sparkline via its `role="img"`
    accessible name, and the never-scored empty state on a fixture with
    an empty `scoreHistory`).
  - root `vitest run` (`test/no-secrets-no-paths.test.ts`,
    `tools/fake-claude/bin.test.js`): 561 tests passed — no secrets or
    absolute paths introduced.
- **Pre-existing, unrelated failures**, confirmed identical with this
  diff stashed out (i.e. on `main` before this proposal): `packages/
  adapters` (20 tests) and `packages/cli`'s `featureRequest.integration.
  test.ts` (11 tests) fail in this sandbox — `GIT_ASKPASS` blocked by
  simple-git's safety plugin, and an unrelated `verifyDir` path issue.
  Neither package is touched by this change, and GitHub Actions CI for
  PR #17 ran green (the `ci` check completed with conclusion `success`),
  confirming these are sandbox-only, not real regressions.
- PR #17: `ci` check green, no merge conflict (`mergeable_state: clean`),
  no review comments or requested changes.

## Product review

- **Observable**: yes — a score badge in the list row and a full trend +
  rubric + self-review in the Score tab, not just pass/fail like the
  existing status badge.
- **Config-driven**: N/A for this feature; it reuses the existing
  `rateColor` threshold convention rather than inventing a new one.
- **Containment**: no new MCP tool, no new `allowed_tools` entry, no new
  file-write surface. The score is agent-authored `custom.*` payload
  through the `emit_event` syscall that already allows it, read back
  through the HTTP API the dashboard already calls. Doesn't touch
  `remember`, `raw/`, `wiki/`, or any permission mode.
- **Docs**: README's Skills concept bullet now names the event and what
  it feeds.
- **Empty/error states**: a skill that has never emitted a score shows
  the documented empty-state copy instead of a blank tab; a malformed
  event (bad type, missing field, non-finite score) is silently skipped
  rather than corrupting `lastScore`/`scoreHistory` for that skill.

One deliberate implementation choice worth flagging: `GET /api/skills`
recomputes `lastScore` for every skill on every request by scanning up to
5000 recent `custom.skill_scored` events rather than querying per skill
name (the `EventLog.listEvents` API has no payload-field filter). The
proposal's own risk section flagged this limit as something that "may
need tuning once real event volume exists" — left as-is since no
instance yet has anywhere near that many scored runs.

Both validator and product review pass, and PR #17's CI ran green with a
clean, conflict-free merge state and no open review threads. Marked
`shipped`; `Shipped: 3/3`.
