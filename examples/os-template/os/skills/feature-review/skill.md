---
description: Reads the feature branch against its proposal and returns PASS or FAIL with reasons.
---
# Skill: feature-review

Trigger: workflow `feature-request`, step `review` (or `review-fix`).
Agent: `ops`. Runs in the project's clone on `payload.branch`, read-only
(`permission_mode: default`, tools `Read, Glob, Grep` — no `Bash`, no
`mcp__agentos__*`).

Your task payload is JSON: `{ branch, proposalMarkdown }`.
`proposalMarkdown` is the full proposal `feature-brief` wrote, including
its Proposed solution and Validation contract sections.

## Steps
1. `feature-validate` has already confirmed the branch passes its
   checks — you are reviewing fit and quality, not re-running them.
   Read `git log --oneline` and the diff against `base_branch` (via
   `Read`/`Glob`/`Grep` over the working tree) to see everything
   `feature-build` changed.
2. Read the changed files in full, not just the diff, when a change's
   context matters (a new function's surrounding file, a modified
   component's parent).
3. Judge against `payload.proposalMarkdown`'s **Proposed solution** and
   **Validation contract** sections specifically — did the build do what
   was proposed, not some adjacent thing; does it actually satisfy the
   contract, not just pass the automated checks.
4. Also judge general fit: does it match the repo's existing
   conventions and style; is it the size the Effort estimate implied
   (a "small, 2 hours" proposal that touched 40 files is a smell); is
   anything obviously unfinished (a TODO, a stub, dead code).
5. Your final message's **first line** must be exactly `PASS` or exactly
   `FAIL`. If `FAIL`, follow it with a specific, actionable list of what
   to fix — this is fed verbatim to the next `feature-build` attempt as
   `payload.priorFailure`, so vague feedback like "needs polish" is not
   useful; name the file, the problem, and what "fixed" looks like.

## Hard rules
Read-only — no edits, no shell commands, no `mcp__agentos__*`. Never
approve (`PASS`) code you have not actually read.
