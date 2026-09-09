---
description: Implements an approved feature request on its own branch in the project's clone, tests included.
---
# Skill: feature-build

Trigger: workflow `feature-request`, step `build` (or `build-fix` on a
retry). Agent: `ops`. Runs **in the project's clone**, not
`agents/ops/workspace/` — `cwd` and every tool grant here come from the
project's `build:` block in `os/projects/<name>.yaml`, not from this
agent's normal defaults (see `os/agents/ops/AGENT.md`).

Your task payload is JSON: `{ branch, slug, title, description,
proposalPath, priorFailure? }`. You have no `mcp__agentos__*` tools here,
so `proposalPath` is informational only (it names the wiki page the
proposal came from) — `title`/`description` plus your own reading of the
repository are your source of truth for what to build. If
`payload.priorFailure` is present, this is a retry: `feature-validate`,
`feature-review`, or the pull request's CI rejected the previous attempt
for exactly this reason — fix that, specifically, before doing anything
else. A CI failure includes the tail of the failing job's log; the fix
must make that exact job pass, because nothing is shipped until the PR's
checks are green.

`payload.branch` always follows the `req/<slug>` naming convention the
`feature-request` workflow computes (e.g. `req/add-dark-mode-toggle`) —
never invent a different branch name.

## Steps
1. Before anything else, check whether `payload.branch` already exists:
   `git rev-parse --verify payload.branch`. If it does, `git checkout
   payload.branch` and `git log --oneline -20` to see what a prior
   (possibly killed-mid-run) attempt already committed — resume from
   there, do not restart from scratch or you will redo or conflict with
   real work. If it does not exist, create it from the current
   `base_branch` HEAD: `git checkout -b payload.branch`.
2. If `payload.priorFailure` is present, read it fully first — it is the
   validate/review output that rejected the previous attempt. Your job
   this run is specifically to fix that.
3. Implement `payload.title`/`payload.description`, following this
   repo's existing conventions (check `CLAUDE.md`/`AGENTS.md` at the repo
   root if present, and match existing code style — do not introduce a
   new pattern where one already exists).
4. Commit as you go, in small conventional-commit-style commits, so a
   `feature-validate` restart after a kill can see incremental progress
   in `git log`. Never commit generated build output, `node_modules/`,
   or anything the repo's `.gitignore` already excludes.
5. **Never push.** Do not run `git push`. Do not open a pull request. Do
   not touch `docs/missions/coo/` — that is written by the adapter, not
   by you, in a later workflow step.
6. End your final message with a short list of files changed and a
   one-line summary of what you implemented.

## Hard rules
Never push to any remote — opening the pull request is a kernel-side
workflow step, not your job. Never edit anything under
`docs/missions/coo/`. Stay on `payload.branch` — never commit to
`base_branch`. Never write secrets into the repo.
