BUILD COMPLETE

# agent-os — final build report (M1-M6)

All six milestone plans in `docs/superpowers/plans/2026-09-08-agent-os-*.md`
are implemented, tested, and merged into `m1-kernel-core`. The whole-repo
gate (`pnpm install --frozen-lockfile && pnpm lint && pnpm -r build &&
pnpm -r test && pnpm exec vitest run`) is green from a from-scratch
checkout, `pnpm -r run typecheck` is clean across all 5 packages, and the
dashboard's Playwright smoke test passes. `.gitleaks.toml` parses as valid
TOML. This branch was built across four cloud fires plus local pre-work on
`m1-kernel-core`; PR #1 (M1-M5) has already been merged to `main` by the
repo owner — this report covers everything on top of that merge (M6) plus
the reconciliation of the branch restart.

## What shipped, per milestone

**M1 — kernel core.** pnpm workspace scaffold, `@agentos/shared` (contract
types/zod schemas, `parseRoutinesFile`), `@agentos/kernel`'s `EventLog`
(SQLite via `better-sqlite3`), `ProcessManager` (spawns `claude -p`,
`runToCompletion` with a wrap-up turn), prompt assembly, stream-JSON
parsing, `buildServer(kernel)` (Fastify HTTP + `/ws`), `createKernel`, and
`@agentos/cli` (`agentos up/ps/logs/run`). `agentos up` → `run heartbeat
--agent ops` → `logs <runId>` works end-to-end against a fake `claude -p`
binary (`tools/fake-claude`) with no real API calls.

**M2 — wiki + syscalls.** Real `WikiService` (frontmatter, `index.md`/
`log.md` upserts, secret redaction via `wiki/redact.ts`), the 8
`mcp__agentos__*` syscall tools + handler, per-run tokens +
`/internal/syscall`, `writeRunMcpConfig`, a stdio MCP server
(`syscall/bin.ts`) every `claude -p` run connects to via
`--strict-mcp-config`, and the real `os/CLAUDE.md` instance schema +
`ingest`/`query`/`lint` skills + `librarian` agent.

**M3 — scheduler + heartbeat.** A real `Scheduler` (`every:`/`cron:`/
`on:`/`after:` triggers, retry with backoff, `ops.alert` on exhausted
retries or missed routines, daemon-restart recovery, a persistent one-shot
queue), a minimal `AdapterHost` stub (replaced in M4), `kernel.ts` wired so
every run — scheduled or manual — goes through `Scheduler.exec` →
`pm.runToCompletion`, a routines HTTP API + `agentos routines` CLI, and the
full `routines.yaml` + `heartbeat`/`daily-digest` skill content.

**M4 — TechPulse adapter & decisions.** `@agentos/adapters` with a real
`techpulse-coo` `ProjectAdapter`: `sync()` clones/fetches the configured
repo, mirrors proposals/reports/state into `raw/` with content-hash change
detection, raises a pending `Decision` per newly-proposed proposal, and
`applyDecision()` flips frontmatter status, commits, pushes, and records
the outcome. `AdapterHost` loads `os/projects/*.yaml` and wraps every
adapter call in a tracked `Run`. Decisions HTTP API + `agentos
decisions/approve/reject/sync` CLI commands.

**M5 — dashboard.** `@agentos/dashboard`, a React SPA served by the kernel
itself: Agents, Runs (+ live `RunStream` with kill/replay), Decisions
(approve/reject + history), a wikilink-aware Wiki viewer, Skills (with
expandable learnings), Routines (run-now/enable/disable), and a hand-rolled
SVG cost chart. A reconnecting WebSocket hook, `@fastify/static` serving
the built dashboard with SPA fallback, and `GET /api/skills`,
`GET /api/skills/:name`, `GET /api/agents`, `GET /api/costs` (base contract
routes no earlier milestone had actually implemented). A Playwright smoke
test exercises every panel plus a full decision-approval round trip.

**M6 — release & hardening.**
- T1-T4: instance schema + wiki seed content, built-in skill/agent content
  (heartbeat/ingest/query/lint/daily-digest, ops/librarian), routines +
  the TechPulse project config, and a template-layer README — audited
  against the plan's reference text (most content already existed,
  real, e2e-tested, from M2/M3; gaps filled without overwriting
  known-good content).
- T5: `agentos init <dir>` — copies `examples/os-template/os` into a new
  instance, writes a guard `.gitignore` + `.gitleaks.toml`.
- T6: root `.gitleaks.toml` (AWS/GitHub/OpenAI/Anthropic key patterns +
  private-key blocks, `useDefault = true` extends the community ruleset).
- T7: **cancelled by standing ruling** — a lefthook pre-commit hook could
  not be added (writing git-hook config is blocked in this sandbox; two
  earlier fires stalled trying). `docs/SECURITY.md` documents running
  `gitleaks protect --staged --config .gitleaks.toml` manually instead;
  CI's gitleaks step is the enforced backstop.
- T8: `test/no-secrets-no-paths.test.ts` + root `vitest.config.ts` — scans
  the shipped template, every package's `src/`+`test/`, and the
  user-facing docs (README, SECURITY, DEMO, PRIVATE_INSTANCE) for
  hardcoded absolute paths and non-placeholder emails. Deliberately
  excludes `docs/superpowers/**` (this project's own SDD build ledger,
  a factual sandbox record, not shipped documentation).
- T9: `docs/SECURITY.md` — containment model, `--strict-mcp-config`,
  where secrets live, the human-only approval boundary.
- T10: `.github/workflows/ci.yml` — `install → lint → build → typecheck →
  test → gitleaks`, plus a `release` job (tag-triggered, publishes a dist
  tarball via `softprops/action-gh-release`).
- T11-T12: public README + LICENSE, this demo script, `PRIVATE_INSTANCE.md`.

## Rulings (the ones that shaped the build; full detail + "why"/"cost if
wrong" for every ruling is in `docs/superpowers/sdd-ledger/*.md`)

- **M6 Task 7 (lefthook) is cancelled.** Git-hook config writes are blocked
  in this sandbox; local secret scanning is manual (`gitleaks protect
  --staged`), CI is the enforced gate.
- **M6 Task 5 (`agentos init`) prints `os/projects/techpulse.yaml`**, not
  the plan's generic `example.yaml` — that's the real file this repo ships
  and what M4's adapter e2e tests depend on.
- **`better-sqlite3` pinned `^12`** (not the plan's `^11`) — no Node 24
  prebuild existed for `^11`.
- Recurring "the plan's own reference code/build assumptions have a real
  gap" pattern, caught and fixed at every milestone (not implementer
  mistakes): a path-traversal vulnerability in the wiki service (M2), an
  auth hook that would 401 every syscall in a secured deployment (M2), an
  MCP-server-shadowing footgun (M2), a `schema.sql`/`syscall/bin.js`/
  `adapters/types.d.ts` dist-vs-src build gap repeated three times across
  M1/M2/M4 (tsup's single-entry bundling doesn't carry non-entry assets or
  additional type-only exports for free), a scheduler bug where a hung
  routine's "missed" detection could never trip (M3), a routine/project
  naming mismatch that would fail the TechPulse sync routine on every fire
  (M4), a latent HTTP client bug breaking every bodyless POST against a
  real server (M4), a dual-bundle type-identity gap only `tsc --noEmit`
  (not `vitest run`) could catch (M4), a shutdown race in `EventLog.append`
  (M5), a react-markdown v9 API change silently dropping wikilinks (M5), a
  dashboard-static-serving path bug invisible to the test suite but fatal
  against the real built binary (M5), and — this fire — a CLI id-generation
  bug where a leading `-` in a nanoid-generated id breaks commander's
  positional-arg parsing (found via a flaky CLI test, fixed at the source
  in `EventLog.genId()`), plus two real gaps in M6 Task 8's own guard test
  scope and M6 Task 10's own CI plan text (typecheck script never existed;
  `pnpm -r run typecheck` with no such script silently exits 0 rather than
  failing).
- **PR #1 merged mid-fire; `m1-kernel-core` was restarted from `main`'s new
  tip** (`git checkout -B m1-kernel-core origin/main` + `--force-with-lease`
  push, safe because the branch held only already-merged history) per the
  standing "merged PR" handling rule. A concurrent human push+self-revert
  on the branch mid-fire was reconciled with a plain merge (confirmed a
  true no-op via diff before merging).

## Deferred minors (low-risk, not blocking; see ledgers for exact lines)

- CLI (`bin.ts`/commands) has no top-level error handling — a daemon-down
  `ECONNREFUSED` surfaces as a raw stack trace rather than a clean message.
- `kernel.ts#stop()` doesn't drain in-flight fire-and-forget `pm.start()`
  promises before closing the EventLog (narrow shutdown race; `append()`
  no-ops safely if it does happen, per the M5 fix).
- `agentos init`'s overwrite guard only checks `os/`'s existence, not
  `.gitignore`/`.gitleaks.toml` individually.
- `agentos init` only works from inside an agent-os monorepo checkout
  (`findRepoRoot` walks up to `pnpm-workspace.yaml`) — no bundled template
  for a standalone/published install.
- `docs/demo.gif` is intentionally absent (placeholder) — no screen
  recording was made this build; `docs/DEMO.md`'s script is ready to record
  against.
- Several narrow test-coverage gaps noted per-task in the milestone
  ledgers (e.g. `/ws` and kill-run routes untested, a routine-override
  `routines.yaml` path untested) — all correct by inspection, just not
  exercised by an automated test.

## Running the demo

Follow `docs/DEMO.md` verbatim:

```bash
pnpm i
pnpm build
node packages/cli/dist/bin.js init ./demo-os
node packages/cli/dist/bin.js up --root ./demo-os/os
```

Then open `http://127.0.0.1:4545` for the dashboard, run
`node packages/cli/dist/bin.js routines run heartbeat` to trigger a
heartbeat on demand, `node packages/cli/dist/bin.js sync techpulse` to
raise a decision, and approve it from the **Decisions** panel to see the
commit/push events land. `docs/DEMO.md` has the full panel-by-panel script
and a recording checklist if producing `docs/demo.gif` for the README.

## Verification run for this report (clean checkout)

```
rm -rf packages/*/dist node_modules packages/*/node_modules
CI=true pnpm install --frozen-lockfile
pnpm lint            # 161 files, clean
pnpm -r build        # all 5 packages
pnpm -r run typecheck   # all 5 packages, clean
pnpm -r test         # shared 12, kernel 133, dashboard 21, cli 11, adapters 13 = 190
pnpm exec vitest run # root guard 331 + tools/fake-claude 4 = 335
pnpm --filter @agentos/dashboard e2e   # Playwright smoke, 1 test, green
```

All green. `git diff origin/main...m1-kernel-core` (this fire's M6 work on
top of the already-merged M1-M5) went through one final adversarial
whole-branch review (see `docs/superpowers/sdd-ledger/m6-release.md`'s
"FINAL STEP" section) — 1 Important + 1 Minor finding, both fixed and
re-verified.

## Next step

Open a new pull request from `m1-kernel-core` to `main` (PR #1 already
merged and closed — this is a fresh PR, not a reuse). The repo owner
merges; this session does not push to `main` directly.
