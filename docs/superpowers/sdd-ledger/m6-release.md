# SDD ledger — plan: docs/superpowers/plans/2026-09-08-agent-os-m6-release.md

Spec: docs/superpowers/specs/2026-09-08-agent-os-design.md. Contract: docs/superpowers/plans/2026-09-08-agent-os-00-contract.md (§10a).
Execution model: parallel worktrees (see M1 ledger rulings). M6 docs-only tasks were pulled forward because they depend on no code.

## Task log
- Batch docs (T6, T9, T11, T12): implementer DONE on branch m6-docs (base 1f0c99d): 87c8967 T6 gitleaks, d11a3de T9 SECURITY.md, ae8e401 T11 README+LICENSE, 3254951 T12 DEMO+PRIVATE_INSTANCE. gitleaks/vitest verification skipped (tools absent). docs/demo.gif intentionally absent (placeholder).
- Batch docs: review dispatched (package 1f0c99d..3254951).
- Batch docs: review — T6/T9/T11/T12 all ✅ byte-identical, no Critical/Important. ⚠️ (resolved by controller): repo rule `gh[pousr]_` doesn't match `github_pat_`; gitleaks default ruleset (`[extend] useDefault = true`) includes `github-fine-grained-pat`, so coverage holds. ⚠️ gitleaks TOML parse unverified locally — closed by M6 T10's CI gitleaks action.
- Batch docs (T6, T9, T11, T12): complete (commits 1f0c99d..3254951, review clean); merged into m1-kernel-core.
- Remaining M6 tasks (T1–T5, T7, T8, T10) wait for M1–M5 code (template audit, init command, lefthook, guard test, CI gate).

## Cloud fire 2026-09-09: M1-M5 completed this fire — M6 T1-T5, T7, T8, T10 now unblocked

M1 (kernel core), M2 (wiki+syscalls), M3 (scheduler+heartbeat), M4 (TechPulse adapter+decisions), and M5 (dashboard) all completed and merged into `m1-kernel-core` this fire (see their own ledgers). Budget ran out before starting M6 proper — nothing below was implemented, this is a handoff note only.

Reconnaissance for the next fire, so it doesn't have to re-derive this:
- **T1 (instance schema + wiki seed files)** likely has substantial overlap with `examples/os-template/os/CLAUDE.md` and `wiki/` already written during M2 (Tasks 8-11, see m2-wiki-syscalls.md) — that work replaced M1's placeholder schema with real content. Not diffed against T1's exact reference text this fire; the next fire should diff before assuming either "already done" or "needs rewriting" — don't trust either extreme without checking.
- **T2/T3 (built-in skills/agents content)**: `examples/os-template/os/skills/{heartbeat,ingest,query,lint,daily-digest}/` and `agents/{ops,librarian}/` already have real `skill.md`/`AGENT.md`/`eval.json`/`learnings.md` content from M2/M3 (not M1 placeholders) — same caveat, diff against T2/T3's exact reference text before assuming coverage.
- **T4 (routines, dummy project, template README)**: `routines.yaml` and `projects/techpulse.yaml` already exist and are exercised end-to-end by real tests (`kernel.exec.test.ts`, `scheduler-e2e.test.ts`, `packages/adapters` e2e). A template README for `examples/os-template/` itself was not part of any M1-M5 task — likely still needed as written.
- **T5 (`agentos init` CLI command)**: does not exist yet — grepped `packages/cli/src` for "bootstrap"/"init", nothing found. This is a real, unstarted task.
- **T7 (lefthook pre-commit hook)**: not configured — no `lefthook.yml` in the repo. Unstarted.
- **T8 (no-secrets/no-machine-paths guard test)**: not present. Unstarted. Note this fire's own commits contain plenty of absolute paths in test fixtures (`os.tmpdir()`-based, not real secrets/hostnames) — when writing T8's guard, make sure it's scoped to what the contract/spec actually means by "machine paths" (real hostnames/usernames baked into *shipped* files, not test-local tmpdir paths), not a blanket grep that would false-positive on this repo's own test suite.
- **T10 (CI gate + tag release)**: `.github/workflows/ci.yml` exists from M1 (basic install/lint/test/build) but has not been touched since — T10 is the only M6 task permitted to modify `.github/workflows` per the standing HARD RULE. Unstarted; this is where gitleaks (T6, already merged) actually gets wired into CI, closing the "gitleaks TOML parse unverified locally" note from the batch-docs review above.

Ruling: did not start any of T1/T2/T3/T4 speculatively without diffing first, to avoid overwriting already-correct M2/M3 content with a mechanical re-application of the plan's reference text (M2/M3's content is known-good, e2e-tested content; the plan's text predates knowing that). Left for the next fire with this reconnaissance instead. Cost if wrong: none — no code was touched, this is a read-only note.
