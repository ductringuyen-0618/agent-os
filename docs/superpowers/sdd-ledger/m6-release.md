# SDD ledger — plan: docs/superpowers/plans/2026-09-08-agent-os-m6-release.md

Spec: docs/superpowers/specs/2026-09-08-agent-os-design.md. Contract: docs/superpowers/plans/2026-09-08-agent-os-00-contract.md (§10a).
Execution model: parallel worktrees (see M1 ledger rulings). M6 docs-only tasks were pulled forward because they depend on no code.

## Task log
- Batch docs (T6, T9, T11, T12): implementer DONE on branch m6-docs (base 1f0c99d): 87c8967 T6 gitleaks, d11a3de T9 SECURITY.md, ae8e401 T11 README+LICENSE, 3254951 T12 DEMO+PRIVATE_INSTANCE. gitleaks/vitest verification skipped (tools absent). docs/demo.gif intentionally absent (placeholder).
- Batch docs: review dispatched (package 1f0c99d..3254951).
- Batch docs: review — T6/T9/T11/T12 all ✅ byte-identical, no Critical/Important. ⚠️ (resolved by controller): repo rule `gh[pousr]_` doesn't match `github_pat_`; gitleaks default ruleset (`[extend] useDefault = true`) includes `github-fine-grained-pat`, so coverage holds. ⚠️ gitleaks TOML parse unverified locally — closed by M6 T10's CI gitleaks action.
- Batch docs (T6, T9, T11, T12): complete (commits 1f0c99d..3254951, review clean); merged into m1-kernel-core.
- Remaining M6 tasks (T1–T5, T7, T8, T10) wait for M1–M5 code (template audit, init command, lefthook, guard test, CI gate).
