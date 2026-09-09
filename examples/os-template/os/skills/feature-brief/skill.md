---
description: Turns a plain-words feature request into a proposal (what you get, why now, validation contract) ready for approval.
---
# Skill: feature-brief

Trigger: workflow `feature-request`, step `brief`. Agent: `ops`. Runs
`permission_mode: default` (read-only through its tool list) with `allowedTools: mcp__agentos__get_context,
mcp__agentos__read_wiki, mcp__agentos__remember` only — no file tools.

You turn an operator's plain-words feature request into a proposal
written the way a human COO proposal is written, so it can go straight
into `docs/missions/coo/proposals/` unedited.

Your task payload is JSON: `{ project, title, description, proposalPath }`.
`proposalPath` is the exact wiki page path you must write to — do not
invent a different one.

## Steps
1. Call `mcp__agentos__get_context`. Read `businessBrain` and `index` for
   everything already known about `payload.project` — prior proposals,
   the project's tech stack, its conventions.
2. For any `index` entry under `projects/<payload.project>/` that looks
   relevant to `payload.title`/`payload.description`, call
   `mcp__agentos__read_wiki` on it.
3. Write the proposal as Markdown with exactly these `##` sections, in
   this order:
   - **What you get** — one paragraph, plain language, what ships.
   - **Why start this now** — why this increases value/engagement/
     reliability today, not eventually.
   - **Problem** — the concrete problem `payload.description` describes,
     restated precisely.
   - **Proposed solution** — the approach, specific enough that a builder
     with no other context could implement it: what changes, where,
     roughly how.
   - **Effort estimate** — small / medium / large, with a one-line reason.
   - **Validation contract** — the checks that must pass before this
     ships (typecheck, lint, tests, a manual behavior to verify) — this
     section is what the `feature-validate` and `feature-review` steps
     hold the build to, so be concrete and check-able.
   - **Risks** — what could go wrong, what's explicitly out of scope.
4. Call `mcp__agentos__remember` with `page: payload.proposalPath`,
   `content` set to the Markdown from step 3 (starting at the `# <title>`
   H1 — do not repeat frontmatter, `remember` adds that), `op: 'note'`.
   This is your only write. Do not call `remember` again.
5. End your final message with a one-line confirmation that you wrote
   `payload.proposalPath`. The workflow reads the page itself; it does
   not parse your final message for content.

## Hard rules (see os/CLAUDE.md)
No file tools — Markdown only via `remember`. Never write to `raw/`.
Never invent facts about the project absent from `get_context`/`read_wiki`
— say "unknown" and proceed rather than guessing. Never write secrets.
