---
status: proposed
attempts: 0
branch: null
---
# Skill eval-score trend in the dashboard

## What you get
The Skills panel starts showing whether each skill is actually getting
better or worse at its job, not just whether its last run crashed. Every
skill's card gets a score badge and a small trend strip built from its
last several runs, plus a new "Score" tab that shows the rubric it is
graded against and the reasoning from its most recent self-review — both
of which the daemon already produces today but never shows anyone.

## Why start this now
Every run's wrap-up turn is already instructed to score itself against the
skill's `eval.json` rubric, and the API endpoint for a skill's detail
already reads that rubric plus the run's self-review file back out — but
that score is never written anywhere durable, and the panel never renders
either piece it already fetches. The original dashboard design for this
panel even names the missing feature outright ("Skills — learnings,
**eval-score trend**") and shipped with a `lastScore` field sitting unused
in the shared types since milestone 5. Closing this costs one line in an
existing prompt and two dead reads getting rendered; leaving it open means
the daemon keeps grading its own homework into a file nobody reads.

## Problem / opportunity
- `packages/kernel/src/process/promptAssembler.ts`'s `wrapUpPrompt()`
  already tells every run: "Score this run against
  `skills/<skill>/eval.json` and write `skills/<skill>/last-output.md`."
  But that instruction only asks for prose in a file that gets overwritten
  next run — there is no durable, structured record of the score, so
  nothing can be trended, and nothing regresses loudly when a skill's
  quality drifts.
- `packages/kernel/src/api/skills.ts`'s `GET /api/skills/:name` already
  parses `eval.json` (the rubric) and reads `last-output.md` (the
  self-review) into the `SkillDetail` response — but
  `packages/dashboard/src/panels/SkillsPanel.tsx` only ever renders
  `detail.skillMd` and `detail.learningsMd`; `detail.eval` and
  `detail.lastOutputMd` are fetched and then dropped on the floor.
  `grep` confirms zero references to either field in the panel.
- `packages/shared/src/types/skill.ts` already declares `lastScore?:
  number` on `SkillMeta`, and `docs/superpowers/plans/2026-09-08-agent-os-
  m5-dashboard.md` (the original milestone-5 plan) shows the panel was
  designed to render it (`s.lastScore.toFixed(2)`) — but
  `GET /api/skills` never sets the field, so it is permanently
  `undefined` in every response today. The dashboard's own README-level
  pitch for this panel ("Skills — learnings, eval-score trend") describes
  a feature that was scoped, typed, and then never wired end to end.
- Net effect: agent-os already pays for a self-grading step on every run
  and already built half the plumbing to show it, and still gives the
  operator no way to see whether a skill is improving, flat, or quietly
  getting worse over time — exactly the kind of operator insight the
  dashboard's other panels (Costs, Routines) exist to provide for spend
  and schedule.

## What we learned from research
- 2026 write-ups on agent evaluation (see "LLM Agent Evaluation Metrics in
  2026" and "The Definitive Guide to AI Agent Evaluation (2026)",
  found via search on confident-ai.com and futureagi.com) converge on
  scoring an agent's work *per skill* against a rubric rather than only
  grading a final answer — which is exactly the shape `eval.json`'s
  weighted `criteria` array already is; agent-os doesn't need a new
  scoring model, only to stop discarding the score it already computes.
- The same coverage notes that a single rubric score is not a signal by
  itself — "if agents routinely scored 95%, there would be no signal for
  optimization" — the value comes from the *trend*: production evaluation
  write-ups (Galileo's LLM drift-monitoring coverage, the "Agent
  Observability 2026" guide found via search) describe bucketing scores
  by time window and watching for movement, so a regression is visible
  before someone stops trusting the skill's output. This proposal borrows
  exactly that mechanism at a scale that fits a single daemon: no new
  service, just windowed scores already sitting in `EventLog`.
- No new dependency or vendor is introduced — the mechanism borrowed is
  "grade per skill, persist the grade, show it moving over time," not any
  specific eval SaaS.

## Proposed solution
- `packages/kernel/src/process/promptAssembler.ts`: extend
  `wrapUpPrompt()` with one more instruction: call
  `emit_event('custom.skill_scored', { skill, score, criteria })` where
  `score` is the weighted 0–1 total against `eval.json`'s criteria and
  `criteria` is a `{ key, met }[]` breakdown — using the `emit_event`
  syscall that already exists and already allows arbitrary `custom.*`
  payloads, so no new MCP tool and no schema change to the syscall
  server.
- `packages/kernel/src/api/skills.ts`:
  - `GET /api/skills`: pull recent `custom.skill_scored` events via the
    existing `EventLog.listEvents({ types: ['custom.skill_scored'],
    limit })`, reduce to the latest one per skill name from its payload,
    and set `SkillMeta.lastScore` (the field already exists in
    `packages/shared/src/types/skill.ts` — this is the only place that
    needs to start populating it).
  - `GET /api/skills/:name`: same `listEvents` call filtered to that
    skill, mapped ascending to `{ ts, runId, score }[]`, added to the
    response as `scoreHistory`.
  - Any malformed or missing `custom.skill_scored` payload (wrong types,
    missing `skill`/`score`) is skipped, not thrown — a run that forgets
    to emit the event just leaves that point out of the trend, same as
    today's silence.
- `packages/dashboard/src/api/client.ts`: add `scoreHistory:
  { ts: string; runId?: string; score: number }[]` to `SkillDetail`.
- `packages/dashboard/src/panels/SkillsPanel.tsx`:
  - List row: render a small score badge next to the existing runs bar
    when `lastScore` is defined (e.g. `92%`), colored with the same
    `rateColor` thresholds already used for the success-rate bar.
  - Detail view: add a third tab, "Score", next to the existing
    Learnings/Instructions tabs. It renders `detail.eval.criteria` (key,
    weight, description — the rubric itself, currently invisible),
    `detail.lastOutputMd` (the self-review, currently fetched and
    discarded), and a plain inline SVG bar/sparkline of `scoreHistory`
    (no new charting dependency — a handful of `<rect>`s sized by score,
    same approach the Costs panel's existing bars use).
  - Empty state for the Score tab when `scoreHistory` is empty: "No
    scored runs yet — after each run, the wrap-up turn grades itself
    against eval.json; the first score will show up here."
- No new dependency, no new MCP tool or `allowed_tools` entry, no schema
  migration (reuses the existing `events` table and `listEvents` query),
  no change to `raw/`, `wiki/`, or any containment surface.

## Effort estimate
S — one added line in an existing prompt, one existing EventLog query
reused (no new query method), two additive fields on already-fetched API
responses, one new panel tab following the existing Learnings/Instructions
tab pattern, and one list-row badge following the existing success-rate
bar pattern.

## Validation contract
- Functional assertions:
  - After a run's wrap-up turn completes, a `custom.skill_scored` event
    with a numeric `score` and the run's `skill` appears in the event
    log (verified against a seeded `EventLog` in a kernel test, not a
    live `claude -p` call).
  - `GET /api/skills` returns `lastScore` for a skill with at least one
    `custom.skill_scored` event, and leaves it `undefined` for a skill
    with none.
  - `GET /api/skills/:name` returns `scoreHistory` sorted oldest-first,
    limited to that skill's own events.
- Behavioral assertions:
  - `SkillsPanel`'s new Score tab renders the rubric criteria and the
    self-review text that `GET /api/skills/:name` already returns today.
  - The score badge on the list row uses the same color thresholds as the
    existing success-rate bar (`rateColor`), so a struggling skill reads
    the same way at a glance as a failing one.
  - The empty state renders correctly for a skill that has run but never
    emitted a score (e.g. an older run from before this change).
- Negative assertions (should NOT happen):
  - A malformed or missing `custom.skill_scored` payload must not throw
    in the API route — it is skipped, and `lastScore`/`scoreHistory`
    behave as if that run never scored itself.
  - No change to `emit_event`'s existing validation (`raw.added` or
    `custom.*` only) — this proposal is a *consumer* of that syscall, not
    a change to it.
  - No change to `read_inbox`, `remember`, or any other syscall's
    existing behavior; existing `handler.test.ts` cases continue to pass
    unmodified.
- Containment assertions:
  - No new MCP tool, no new `allowed_tools` entry, no new file-write
    surface — the score event is agent-authored `custom.*` payload
    through the syscall that already permits it, read back through the
    HTTP API the dashboard already uses.
  - No absolute paths, hostnames, or secrets in any changed file.
- Test commands the build will need to pass (from `.github/workflows/
  ci.yml`): `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build`,
  `pnpm -r run typecheck`, `pnpm test` (new cases: `promptAssembler.test.ts`
  asserting the wrap-up prompt includes the `emit_event`/`skill_scored`
  instruction; `skills.ts`'s route tests for `lastScore` and
  `scoreHistory`, including the malformed-payload skip path;
  `SkillsPanel.test.tsx` for the Score tab, the badge, and the empty
  state).

## Risks / open questions
- Trusting the model to compute its own weighted score means the number
  is only as honest as the run that produced it — same trust level
  agent-os already places in `learnings.md` and `last-output.md`, both
  self-authored today. This proposal does not add a second, independent
  verifier; that would be a follow-up, not part of this pass.
- Auto-alerting when a skill's score drops sharply (the "regression
  detection" half of what the research above describes) is deliberately
  left out of scope here — it would need a threshold/notification design
  of its own, similar in shape to `daily_budget_usd`'s circuit breaker
  (shipped in 001-routine-cost-budgets), and deserves its own proposal
  once there is enough real score history to know what a normal swing
  looks like.
- `listEvents` has no upper bound on how far back "recent" events reach
  today; the `limit` passed when reducing to `lastScore`/`scoreHistory`
  should be generous enough to find a skill's last score even for a
  lightly-used skill, but this may need tuning once real event volume
  exists across many skills.
