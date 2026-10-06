# agent-os COO -- State

Shipped: 5/5


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
