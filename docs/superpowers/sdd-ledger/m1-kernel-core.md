# SDD ledger — plan: docs/superpowers/plans/2026-09-08-agent-os-m1-kernel-core.md

Spec: docs/superpowers/specs/2026-09-08-agent-os-design.md (reachable). Contract: docs/superpowers/plans/2026-09-08-agent-os-00-contract.md (binding; §10a consolidates cross-plan additions).
Code repo: D:\Portfolio\agent-os (created by Task 1). This ledger is copied into `D:\Portfolio\agent-os\.superpowers\sdd\2026-09-08-agent-os-m1-kernel-core\progress.md` after Task 1; from then on that copy is authoritative.

## Pre-flight scan (M1, 11 tasks)

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 → all | pnpm workspace, tsconfig.base, biome, vitest root | consistent; T1 `test` script is `vitest run` at root — packages run `vitest run` per package via `pnpm --filter`, both valid |
| T2 → T3..T11 | contract §3 types + api.ts + `parseRoutinesFile` | consistent; api.ts additions listed in contract §10a |
| T3 → T4, T8, T9 | `KernelConfig`, `loadKernelConfig(osRoot, overrides)` | consistent |
| T4 → T8, T9 | `EventLog` per contract §4 | consistent; M2–M4 later add methods (contract §10a) |
| T5 → T8 | `parseStreamLine(line)` | consistent with contract `ClaudeStreamMessage` |
| T6 → T9 | `assemblePrompt`, `wrapUpPrompt` | consistent |
| T7 → T8, T9, T11 | fake-claude env contract §9 | consistent |
| T8 → T9 | `ProcessManager.start/kill/running` | consistent; `runToCompletion` is M2 |
| T9 → T10, T11 | `buildServer(kernel: Kernel)` (canonical, edited by controller), runs routes, `/ws`, `createKernel` | consistent after edit; server.ts uses `import type { Kernel } from '../kernel.js'` (type-only, no runtime cycle) |
| T10 → T11 | `ApiClient`, `agentos up/ps/logs/run` | consistent |
| T11 self | template instance + e2e acceptance | consistent |
| T9 self | `writeStubMcpConfig` + `pm.start` in POST /api/runs | acceptable for M1; superseded in M3 Task 9 Step 3b (ledgered in contract §10a) |

Rulings before execution:
- Ruling: Task 1 makes the bootstrap commit on `main` and pushes it (`git push -u origin main`) so the GitHub default branch is `main`; every later task commits on branch `m1-kernel-core` (created from that commit) and never pushes — merge/push happens at finishing-a-development-branch after the final review. — Why: the skill forbids implementing on main without consent; a brand-new repo needs one root commit to exist. — Cost if wrong: one branch to merge; trivial.
- Ruling: pushes beyond Task 1 are deferred to the finish step. — Why: pushing is a shared-side effect; batching it keeps the remote clean. — Cost if wrong: remote lags local until the end of the milestone.
- Ruling: implementers use model sonnet by default; haiku only for single-file transcription tasks; final whole-branch review on opus. — Why: SKILL.md Model Selection. — Cost if wrong: money.

Workspace note: this TechPulse-repo workspace stays authoritative for the whole run (briefs, reports, ledger); review packages are generated with cwd = D:\Portfolio\agent-os and an explicit OUTFILE here.

## Task log
- Task 1: implementer DONE_WITH_CONCERNS — bootstrap commit 038e0b4 on main, pushed; branch m1-kernel-core checked out. Concern: pnpm-lock.yaml untracked while CI uses --frozen-lockfile.
- Task 1: Ruling: commit pnpm-lock.yaml on m1-kernel-core; every later task that changes dependencies must stage pnpm-lock.yaml in its commit. — Why: CI `--frozen-lockfile` fails without it; the brief omitted it. — Cost if wrong: none (lockfile is meant to be committed).
- Task 1: fix (pre-review): lockfile committed 1f0c99d on m1-kernel-core; tree clean.
- Task 1: minor (deferred): the copied plan docs under docs/superpowers/ contain `D:\Portfolio\...` absolute paths (Task 1 Step 1 PowerShell commands). Not secrets; violates the "nothing machine-specific" constraint in spirit. Sanitize docs in a later docs commit (M6 guard test only scans examples/ and packages/**/src).
- Task 1: review — spec ✅, no Critical/Important. ⚠️ commit trailers: controller verified via git log. Minor (deferred): add `.superpowers/` to .gitignore in a later chore (plan's .gitignore omits it; no such dir is created in agent-os because review packages are written to the TechPulse workspace).
- Task 1: complete (commits 4b825dc(empty)..1f0c99d, review clean)
- Ruling (user-directed): run independent tasks in parallel, each in its own git worktree under D:\Portfolio\agent-os-wt\<name> on its own branch, merged into m1-kernel-core by the controller after a clean review; reviewers also run concurrently. Waves follow the dependency graph (T2 → T3 [kernel scaffold with ALL kernel runtime deps added up front to avoid package.json/lockfile conflicts] → T4/T5/T6/M3-T1 in parallel → T8 → T9 → T10 → T11; M5 dashboard T1–T4 after T2; M6 docs-only tasks now). — Why: user asked for ~10 parallel agents; SKILL forbids parallel implementers in ONE tree because of conflicts, worktrees remove that. — Cost if wrong: merge conflicts to resolve; a dispatched fixer handles them.
- Wave 1 dispatched: impl-m1-t7 (worktree m1-t7, branch m1-t7-fake-claude), impl-m6-docs (worktree m6-docs, branch m6-docs: M6 T6, T9, T11, T12 batch). Task 2 running in the main tree.
- Task 2: implementer DONE_WITH_CONCERNS — 74051e8 feat(shared) on m1-kernel-core, 12/12. Concerns: `as RoutinesFile` cast in parseRoutinesFile (zod-inferred `on: string[]` vs `EventType[]`); Biome reformatted brief code (double quotes/semicolons).
- Ruling: align root biome.json to the plans' style (`javascript.formatter.quoteStyle: 'single'`, `semicolons: 'asNeeded'`) as the first commit of Task 3's branch; formatting-only diffs from briefs are never findings. — Why: every plan's code is single-quote/no-semicolon; reformatting each task away from its brief makes review noisier and diffs larger. — Cost if wrong: one config commit + a reformat of packages/shared.
- Ruling: kernel and dashboard package scaffolds declare ALL their milestone dependencies up front (lists in the T3 and M5-batch1 dispatches). — Why: parallel worktrees must not each edit package.json/pnpm-lock.yaml. — Cost if wrong: a few unused deps installed early.
- Wave 2 dispatched: review-m1-t2 (package 1f0c99d..74051e8); impl-m1-t3 (worktree m1-t3, branch m1-t3-kernel-config from 74051e8); impl-m5-batch1 (worktree m5-dash, branch m5-dashboard from 74051e8: M5 T1–T4). Main tree is controller-only (merges) from now on.
- Task 7: implementer DONE_WITH_CONCERNS — 3ab4442 on m1-t7-fake-claude (base 1f0c99d), 4/4. Concerns: biome reformat (fine per ruling); root configs from Task 1 have CRLF → 3 pre-existing Biome errors.
- Ruling: enforce LF via root `.gitattributes` (`* text=auto eol=lf`) + renormalize + biome --write, as a commit on Task 3's branch (message sent to impl-m1-t3). — Why: Windows checkout wrote CRLF; Biome/CI would fail on every file. — Cost if wrong: a whitespace-only commit.
- Task 7: review dispatched (package 1f0c99d..3ab4442).
- Task 2: review — spec ✅, no Critical/Important; cast judged sound. Minor (deferred): type `EventTypeSchema` as `z.ZodType<EventType>` (or `z.custom<EventType>`) so `z.infer<typeof EventSchema>` doesn't widen `type` to `string`; removes the cast.
- Task 2: complete (commits 1f0c99d..74051e8, review clean) — already on m1-kernel-core.
- Task 3: NEEDS_CONTEXT — biome-alignment commit 2a72a5a done; `pnpm install` fails on better-sqlite3@^11 (node-gyp, no VS Build Tools; machine Node is v24.19.0, no v11 prebuild for Node 24).
- Ruling: repin `better-sqlite3@^12` (prebuilds for Node 20/22/24). Contract §0 pin updated from ^11 → ^12 (TechPulse copy now; agent-os docs copy in a later docs commit). Fallback if ^12 fails: Node built-in `node:sqlite` (`DatabaseSync`), engines >=24, CI node 24 — would require adapting T4's EventLog code (no `pragma()`/`transaction()` helpers). — Why: avoids a native toolchain requirement for every user of a portfolio repo. — Cost if wrong: a major-version bump of a dependency whose API is unchanged for our usage.
- Task 7: review — spec ✅, no Critical/Important. Minor (deferred, plan-mandated): bin.js has no friendly error when FAKE_CLAUDE_FIXTURE path is missing (raw ENOENT, exit 1). ⚠️ root vitest discovery of tools/**/*.test.js: controller verified — root `vitest run` = 16 passed (12 shared + 4 fake-claude).
- Task 7: complete (commits 1f0c99d..3ab4442, review clean); merged into m1-kernel-core as 42bbf14 (pnpm-lock.yaml conflict resolved by regenerating with `pnpm install`).
- M6 docs batch merged into m1-kernel-core as f660929.
- Handoff prep (user asked to continue in the cloud while asleep): all plans + updated contract + these ledgers committed to agent-os `docs/superpowers/` (ledgers under `docs/superpowers/sdd-ledger/`). Minor (deferred): ledgers contain `D:\Portfolio\...` paths — sanitize or drop the ledger dir before the public release (M6 T8 guard test doesn't scan docs/).
- Task 3: implementer DONE — 2a72a5a (biome align), e643b6f (.gitattributes LF), c6de012 feat(kernel) config on m1-t3-kernel-config; better-sqlite3@12.11.1 resolved.
- Task 3: review — spec ✅, Approved; Important (plan-mandated): non-numeric AGENTOS_PORT → NaN. Minor: report listed files not in diff.
- Task 3: Ruling: fix the NaN port now (validate integer 0..65535 else 4545) despite being plan-mandated — Why: server task builds on it; two-line change. — Cost if wrong: none.
- Task 3: fix round 1/5 (1 addressed, 0 open — NaN port; commit 638085f); scoped re-review clean.
- Task 3: complete (commits 74051e8..638085f, review clean); merged into m1-kernel-core as 27aa3db (lockfile regenerated), followed by a controller formatting/LF normalization commit for files merged before the Biome-style change (Task 7's JS).
- STATE FOR CLOUD HANDOFF: m1-kernel-core contains Tasks 1, 2, 3, 7 of M1 and the M6 docs batch (T6, T9, T11, T12). Next M1 work: Tasks 4 (EventLog), 5 (streamParser), 6 (promptAssembler) can run in parallel (distinct files under packages/kernel/src; kernel package.json already has all deps), then 8 (ProcessManager), 9 (server/kernel), 10 (CLI), 11 (template + e2e). M3 Task 1 (triggers.ts, pure) and M2 Tasks 1–2 (redact.ts, wiki/index.ts, pure) may also run in parallel with M1 T4–T6. M5 Tasks 1–4 are IN PROGRESS locally on branch `m5-dashboard` (base 74051e8) and will be pushed when done — do not redo them; merge that branch after reviewing it against M5 T1–T4.
- Handoff plan: wait for Task 3 + M5 batch → review/merge → push m1-kernel-core (+ m5-dashboard) → launch a remote cloud orchestrator that resumes from the committed ledgers.
