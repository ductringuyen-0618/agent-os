# agent-os — Design Spec

Date: 2026-09-08
Status: draft for review
Target repo: `github.com/ductringuyen-0618/agent-os` (public) + a private instance repo

## 1. Goal

A portfolio-grade "Agentic OS": a local, always-on daemon that runs teams of
Claude Code agents (`claude -p` headless sessions) over a filesystem-first
memory layer, with a live web dashboard and a CLI. First concrete use: the
TechPulse COO routine's daily proposals appear in the dashboard and are
approved/rejected from there.

Success in 3 months: a compelling 2-minute demo (agents running on a
heartbeat, a wiki compounding, a proposal approved from the dashboard that
kicks off a cloud build), clean code, and a README that makes the design
legible to an employer.

### Non-goals (MVP)
- Chat channels (WhatsApp/Slack/Telegram), multi-user, RBAC
- WASM/container sandboxing (containment = Claude Code permission modes,
  tool allowlists, directory scoping)
- Model-agnostic engine (Claude Code CLI only)
- Remote/cloud hosting (local daemon on Windows; Docker later)

## 2. Influences

- Video "The NEW Agentic OS standard for Claude 5 Models" (RoboNuggets) and
  MindStudio's write-up: four layers — shared business context, persistent
  memory, self-improving skills (`skill.md` / `learnings.md` / `eval.json` /
  `handoff.md`), scheduled workflows with a heartbeat — plus a "command
  centre" dashboard.
- Karpathy's LLM Wiki gist: `raw/` (immutable, human-curated) → `wiki/`
  (LLM-owned, `index.md` + append-only `log.md` + wikilinked pages) with a
  schema file (`CLAUDE.md`) and three workflows: ingest, query, lint.
- AIOS / OpenFang kernel vocabulary (scheduler, memory, syscalls); Vercel eve
  ("an agent is a directory"); Anthropic Managed Agents (append-only session
  log as the durable unit).

## 3. Repos

### 3.1 `agent-os` (public)
```
agent-os/
  packages/
    shared/      # Zod schemas + types: Run, Event, Routine, Skill, Decision, Project
    kernel/      # daemon: Scheduler, ProcessManager, EventLog, SyscallServer, adapters
    dashboard/   # React + Vite; WebSocket client
    cli/         # `agentos` binary
    adapters/    # project adapters (first: techpulse-coo)
  examples/os-template/   # sanitized starter instance (see 3.2 layout)
  docs/
  .gitleaks.toml, .pre-commit hooks
```
Monorepo: pnpm workspaces, TypeScript strict, Node 22+, Vitest, Playwright.

### 3.2 Private instance repo (e.g. `my-agent-os`)
The living `os/` directory. Never public. Same layout as `examples/os-template`:
```
os/
  CLAUDE.md            # schema/constitution (human + LLM co-evolve)
  raw/                 # immutable inputs; LLM never edits
  wiki/                # LLM-owned: index.md, log.md, business-brain.md,
                       #   projects/, agents/, concepts/, decisions/
  output/              # deliverables: approvals/, reports/, digests/
  skills/<name>/       # skill.md, learnings.md, eval.json, last-output.md,
                       #   context/handoff.md
  agents/<name>/AGENT.md
  routines.yaml
  projects/<name>.yaml
.agentos/              # gitignored runtime: agentos.db, clones/, pids/, logs/
.env                   # gitignored
```
The daemon is started with `agentos up --root <path-to-os>`. Any repo with an
`os/` folder is a valid instance.

### 3.3 No machine details in git
- No absolute paths or hostnames in committed files; `projects/*.yaml` uses
  `${AGENTOS_HOME}` / `${AGENTOS_CLONES}` variables resolved at runtime.
- Secrets only via env; GitHub auth reuses the local `gh` login.
- `gitleaks` pre-commit hook in both repos.
- The `remember` syscall rejects content matching secret patterns
  (AWS/GitHub/OpenAI/Anthropic key regexes, `-----BEGIN`), logging a
  `security.redacted` event instead.

## 4. Kernel (`packages/kernel`)

### 4.1 Modules
| Module | Responsibility |
|---|---|
| `Scheduler` | Evaluates `routines.yaml` (cron, heartbeat, event triggers), enqueues `Run`s, enforces `max_attempts`, backoff |
| `ProcessManager` | Assembles prompts, spawns/kills/resumes `claude -p`, parses stream-json into `Event`s, runs the wrap-up turn |
| `EventLog` | Append-only SQLite (`events`, `runs`, `decisions`, `messages`, `schedules`); pub/sub to WebSocket |
| `SyscallServer` | stdio MCP server injected into every run (see 4.4) |
| `WikiService` | Schema-enforcing writes to `wiki/` (page + `index.md` + `log.md`), raw-immutability guard, lint helpers |
| `AdapterHost` | Loads project adapters; runs `sync()`; executes `applyDecision()` |
| `Api` | HTTP (127.0.0.1 only, optional bearer token) + WebSocket for dashboard/CLI |

### 4.2 Run lifecycle
1. Trigger (cron | heartbeat | event | CLI/dashboard) → `Run{status: queued}`.
2. Prompt assembly:
   - system-prompt append: `os/CLAUDE.md` + `agents/<agent>/AGENT.md`
   - user prompt: `skills/<skill>/skill.md` + `learnings.md` + upstream
     `context/handoff.md` (if the routine declares `after:`) + task payload
3. Spawn:
   ```
   claude -p --output-format stream-json --include-partial-messages \
     --mcp-config <kernel-mcp.json> --strict-mcp-config \
     --permission-mode <routine.permission_mode> \
     --allowedTools <routine.allowed_tools...> \
     --add-dir <os-root> <workspace> --model <routine.model>
   ```
   cwd = `agents/<agent>/workspace/` (created per agent, gitignored contents
   optional). Session id captured from the `init` event.
4. Stream-json events → `EventLog` (`assistant`, `tool_use`, `tool_result`,
   `result` incl. usage/cost) → dashboard.
5. Wrap-up turn (kernel-driven, `--resume <session>`): "update
   `learnings.md`; write `context/handoff.md`; call `remember` for durable
   facts; score this run against `eval.json` and write `last-output.md`."
6. Terminal status: `success | failed | blocked` (blocked = awaiting a
   `Decision`). Retries per routine; final failure emits `run.failed`.

### 4.3 Routines (`routines.yaml`)
```yaml
defaults:
  model: sonnet
  permission_mode: plan            # read-only unless overridden
  allowed_tools: [Read, Glob, Grep, WebFetch, WebSearch]
  max_attempts: 2

routines:
  - name: heartbeat
    every: 30m
    skill: heartbeat
    agent: ops
    model: haiku
  - name: techpulse-sync
    every: 1h
    adapter: techpulse-coo         # adapter routines run code, not an agent
  - name: ingest
    on: [raw.added]                # event trigger
    skill: ingest
    agent: librarian
    permission_mode: acceptEdits   # may write via syscalls only; fs writes limited to workspace
  - name: lint
    cron: "0 3 * * *"
    skill: lint
    agent: librarian
  - name: daily-digest
    cron: "0 8 * * *"
    skill: daily-digest
    agent: ops
    after: [lint]
```
Per-routine overrides: `model`, `permission_mode`, `allowed_tools`,
`extra_mcp` (explicit opt-in to additional MCP servers), `max_attempts`,
`timeout`.

### 4.4 Syscalls (kernel MCP server)
| Tool | Effect |
|---|---|
| `get_context()` | Returns `business-brain.md` + `wiki/index.md` |
| `remember(page, content, links?)` | Writes/updates a wiki page, updates `index.md`, appends `log.md`; refuses secrets; refuses paths under `raw/` |
| `read_wiki(page)` | Returns a wiki page |
| `emit_event(type, payload)` | Appends an event; may trigger routines with matching `on:` |
| `send_message(to, body)` / `read_inbox()` | Agent-to-agent mailbox (SQLite) |
| `schedule(skill, when, payload?)` | One-shot future run |
| `request_approval(title, body, adapter?, ref?)` | Creates a pending `Decision`; never resolves it |

Rationale: routing writes through the kernel is what lets the OS enforce the
raw/wiki contract, keep the index/log consistent, and audit everything.

### 4.5 Heartbeat skill
Cheap model. Steps: (a) kernel supplies the list of `raw/` files absent from
`index.md` → `emit_event(raw.added)` per file; (b) check last-run status of
each routine, flag misses/failures as `wiki/agents/<agent>.md` notes and an
`ops.alert` event; (c) if lint hasn't run in 24h, `schedule(lint)`;
(d) one line to `log.md`.

### 4.6 Wiki workflows (skills)
- `ingest`: read the raw file, write a source summary page, update entity/
  concept/project pages, all via `remember`.
- `query`: read `index.md` first, then pages; answer with citations; optionally
  `remember` a new insight page.
- `lint`: contradictions, stale claims, orphan pages, missing links → fixes via
  `remember` + a `wiki/lint-report.md`.
Rules live in `os/CLAUDE.md` (page templates, frontmatter, log prefixes
`## [YYYY-MM-DD] ingest|query|lint|decision | Title`).

## 5. Project adapters (`packages/adapters`)

Interface:
```ts
interface ProjectAdapter {
  name: string
  sync(ctx): Promise<SyncResult>            // mirror external state into raw/, emit events
  applyDecision(decision, ctx): Promise<void> // act on approve/reject
}
```

### 5.1 `techpulse-coo`
Config (`projects/techpulse.yaml`): repo URL, clone path (`${AGENTOS_CLONES}/techpulse`),
`proposals_path: docs/missions/coo/proposals`, `state_path`, `reports_path`, base branch.

- `sync()`: `git fetch` + checkout `main`; copy new/changed proposal, report and
  state files into `raw/techpulse/{proposals,reports}/` (immutable copies,
  content-hashed to detect change); emit `raw.added` / `proposal.changed`.
  `sync()` itself creates a pending Decision (deterministically, no LLM in
  the loop) for any proposal whose status is `proposed` and has no existing
  Decision with the same `adapter` + `ref`. The `ingest` skill, triggered by
  `raw.added`, then writes `wiki/projects/techpulse/proposals/<slug>.md`.
- `applyDecision(approve|reject)`: in the clone, flip frontmatter `status:` to
  `approved` / `rejected`, commit `chore(coo): <approve|reject> <slug>`, push
  to `main`; write `output/approvals/<date>-<slug>.md`; `remember` the
  decision on the proposal's wiki page; log entry. On push failure the decision
  stays `pending` with the error attached.
- Status changes (`in_progress`, `shipped`, `blocked`) and report files flow
  back through `sync()` so the dashboard shows the pipeline.

## 6. Dashboard (`packages/dashboard`)
Panels: **Agents** (idle/working/blocked, current run) · **Runs** (live
stream, tool calls, cost) · **Decisions** (pending approvals with Approve/
Reject; history) · **Wiki** (index, log, page viewer with wikilinks) ·
**Skills** (learnings, eval-score trend) · **Routines** (next run,
enable/disable, run now) · **Costs** (per agent/day).
Tech: React 18, Vite, Tailwind, WebSocket; served by the kernel on
`127.0.0.1:<port>`.

## 7. CLI (`packages/cli`)
`agentos init [--template]` · `up --root <os>` · `ps` · `logs <run|agent>` ·
`run <skill> [--agent] [--payload]` · `decisions` · `approve|reject <id>` ·
`routines [enable|disable|run <name>]` · `wiki lint` · `sync <project>`.
Talks to the daemon over HTTP; `up` starts it.

## 8. Security model
- **Containment per run**: `--strict-mcp-config` (only the kernel MCP server
  unless `extra_mcp` opts in), tool allowlist, permission mode, directory
  scoping via `--add-dir`, per-agent workspace cwd.
- **Untrusted input**: everything in `raw/` (repo docs, web pages) is data; the
  schema and skills state this; `request_approval` cannot self-resolve;
  decisions only via dashboard/CLI.
- **Audit**: every git commit/push the kernel performs is an event with run id.
- **Network**: dashboard/API bound to loopback; optional bearer token.
- **Secrets**: env-only; gitleaks; `remember` redaction.

## 9. Error handling
- Run timeouts kill the process and mark `failed`; retries with backoff up to
  `max_attempts`.
- Daemon restart replays `queued`/`running` runs from SQLite (running → requeue).
- Adapter failures (clone missing, push rejected) surface as `ops.alert`
  events and a blocked Decision, never silent.
- Stream-json parse errors are logged raw and the run continues.

## 10. Testing
- Unit (Vitest): schemas, scheduler timing, prompt assembly, WikiService
  index/log updates, secret redaction, adapter git ops against a temp repo.
- Integration: a fake `claude` executable that replays stream-json fixtures;
  full run lifecycle without API spend.
- E2E (flagged `AGENTOS_E2E=1`): one real `claude -p` heartbeat run.
- Dashboard: Playwright smoke (panels render, approve flow against fake daemon).

## 11. Milestones
1. `shared` + `kernel` core: EventLog, ProcessManager with fake `claude`, CLI `up/ps/logs/run`.
2. SyscallServer + WikiService + `os/CLAUDE.md` schema + ingest/query/lint skills.
3. Scheduler + heartbeat + routines.yaml.
4. `techpulse-coo` adapter + Decisions (approve from CLI).
5. Dashboard (all panels), approve from UI.
6. README, demo GIF, `examples/os-template`, gitleaks hooks, private instance repo bootstrap.

## 12. Decisions deferred beyond MVP
- Always-on: MVP is a manually started `agentos up`; a Windows Task Scheduler / NSSM service wrapper comes after milestone 6.
- Wrap-up is a kernel-driven second `--resume` turn (non-skippable) rather than part of the main prompt; revisit only if cost is measured to matter.
- Docker packaging and API-key auth for headless runs in a container come after the local MVP.
