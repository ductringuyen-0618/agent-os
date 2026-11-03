# agent-os COO -- State

Shipped: 6/6


## Log
- 2026-09-09: proposed 001-routine-cost-budgets, 002-agent-mailbox-visibility
- 2026-09-09: shipped 002-agent-mailbox-visibility (PR #6, branch coo/agent-mailbox-visibility)
- 2026-09-09: shipped 001-routine-cost-budgets (PR #7, branch coo/routine-cost-budgets)
- 2026-09-10: proposed 003-skill-score-trend
- 2026-09-12: approved 003-skill-score-trend via GitHub issue #14
- 2026-09-12: shipped 003-skill-score-trend (PR #17, branch coo/skill-score-trend)
- 2026-09-12: proposed 004-global-pause-switch (decision issue #18)
- 2026-09-14: 004-global-pause-switch PR #19 blocked on an unrelated
  pre-existing CI failure in packages/adapters/decisions.test.ts (dated
  test fixture, unrelated to this PR); root cause + proposed patch posted
  on the PR, proposal left in_progress
- 2026-09-16: shipped 004-global-pause-switch (PR #19, branch
  coo/global-pause-switch) -- the unrelated CI blocker was fixed on the
  branch by porting the proposed patch, then CI went green
- 2026-09-17: proposed 005-wiki-page-history (decision issue pending)
- 2026-09-25: 005-wiki-page-history expired (no decision in 7 days,
  issue #20 closed)
- 2026-09-25: proposed 006-routine-overlap-guard (decision issue pending)
- 2026-09-27: 006-routine-overlap-guard approved via GitHub issue #21
  (owner commented "Approve"); built and opened PR #22 (branch
  coo/routine-overlap-guard); local CI-equivalent checks (install, lint,
  build, typecheck, test) all green except pre-existing packages/adapters
  failures confirmed unrelated (reproduce identically on the base commit;
  one set is a sandbox-only GIT_ASKPASS restriction, the other is
  decisions.test.ts's hardcoded 2026-09-10 fixture date now past its own
  7-day expiry window) -- proposal left in_progress pending real CI
- 2026-09-27: PR #22's first CI run failed on the pre-existing
  decisions.test.ts dated-fixture bug (confirmed red on main too); ported
  a minimal fix (explicit `now` via the file's own daysLater() helper) onto
  the branch and pushed -- CI went green
- 2026-09-27: shipped 006-routine-overlap-guard (PR #22, branch
  coo/routine-overlap-guard)
- 2026-09-28: proposed 007-permission-denial-audit-trail (decision issue
  #23)
- 2026-10-06: 007-permission-denial-audit-trail expired (no decision in 7
  days after two nudges, issue #23 closed)
- 2026-10-06: proposed 008-skill-scaffold-and-lint (decision issue pending)
- 2026-10-14: 008-skill-scaffold-and-lint expired (no decision in 7 days
  after two nudges, issue #24 closed)
- 2026-10-14: proposed 009-wiki-staleness-signal (decision issue pending)
- 2026-10-22: 009-wiki-staleness-signal expired (no decision in 7 days
  after two nudges, issue #25 closed)
- 2026-10-22: proposed 010-run-trigger-lineage
- 2026-10-30: 010-run-trigger-lineage expired (no decision in 7 days
  after two nudges, issue #26 closed)
- 2026-10-30: proposed 011-context-window-budget (decision issue #27)
- 2026-11-02: 011-context-window-budget approved via GitHub issue #27
  (label agentos:approve); built and opened PR #28 (branch
  coo/context-window-budget); local CI-equivalent checks (install, lint,
  build, typecheck, test) all green except pre-existing packages/adapters
  and one packages/cli integration-test failure confirmed unrelated
  (identical with and without this diff via git stash; a sandbox-only
  GIT_ASKPASS/temp-path restriction) -- proposal left in_progress pending
  real CI
- 2026-11-02: shipped 011-context-window-budget (PR #28, branch
  coo/context-window-budget) -- PR's real CI (run 41496543953) passed
  in full on the first attempt, including `pnpm test`, confirming the
  local sandbox failures were unrelated as suspected
- 2026-11-03: proposed 012-restart-recovery-side-effect-guard (decision
  issue pending)
