# agent-os

A local, always-on "agentic OS": a daemon that runs teams of Claude Code
agents (`claude -p` headless sessions) over a filesystem-first memory
layer, with a live dashboard and a CLI. Point it at a project, let a
heartbeat keep its wiki current, and approve or reject what it proposes
from a browser tab — nothing an agent does to a real repo happens without
a human clicking Approve first.

![agent-os demo](docs/demo.gif)

## What it does, in 60 seconds

```
        raw/ (immutable)         wiki/ (LLM-owned)         output/
  ┌──────────────────────┐  remember()  ┌───────────┐   ┌───────────┐
  │ adapter-mirrored docs │ ───────────▶ │ index.md  │──▶│ approvals/│
  │ proposals, reports,   │              │ log.md    │   │ reports/  │
  │ web captures...       │              │ business- │   │ digests/  │
  └──────────────────────┘              │ brain.md  │   └───────────┘
            ▲                            │ pages...  │
            │ sync()                     └───────────┘
     ┌──────┴───────┐        syscalls (get_context, remember,
     │ project       │        read_wiki, emit_event, send_message,
     │ adapter       │◀──────  read_inbox, schedule, request_approval)
     │ (techpulse)   │                       ▲
     └──────┬────────┘                       │ stdio MCP, --strict-mcp-config
            │ applyDecision()          ┌─────┴─────┐
            ▼                          │ claude -p │  agents: ops, librarian
   git commit + push (on approve)      │  runs     │  skills: heartbeat,
                                        └─────┬─────┘  ingest, query, lint,
   ┌────────────────────────────────────────┐│         daily-digest
   │ kernel: Scheduler · EventLog (SQLite) · ││
   │ ProcessManager · SyscallServer · Api    │◀── heartbeat every 30m
   └───────────────────┬────────────────────┘
                        │ WebSocket + HTTP (127.0.0.1)
                 ┌──────┴──────┐
                 │  dashboard  │  Agents · Runs · Decisions · Wiki ·
                 │ (React/Vite)│  Skills · Routines · Costs · Messages
                 └─────────────┘
```

A `routines.yaml` schedule (cron, interval, or event-triggered) tells the
kernel when to spawn a `claude -p` session for a skill+agent pair, or to
run a project adapter's `sync()`. Every syscall an agent makes is routed
through the kernel so the raw/wiki/output contract, the wiki's
index/log, and the audit trail stay consistent no matter what the model
decides to do inside a run.

## Quickstart

```bash
pnpm i
pnpm build
node packages/cli/dist/bin.js init ./my-os
node packages/cli/dist/bin.js up --root ./my-os/os
# open http://127.0.0.1:4545
```

## Approving a TechPulse proposal from the dashboard

1. Point `os/projects/example.yaml` (renamed, e.g. `techpulse.yaml`) at a
   real repo with a `docs/missions/coo/proposals/` folder — see
   [`docs/PRIVATE_INSTANCE.md`](docs/PRIVATE_INSTANCE.md) — and enable its
   sync routine in `routines.yaml`.
2. The `techpulse-coo` adapter's `sync()` mirrors any `status: proposed`
   proposal file into `raw/techpulse/proposals/`.
3. The `ingest` routine fires on `raw.added`, writes a wiki page for the
   proposal, and calls `request_approval` — a pending card appears on the
   dashboard's **Decisions** panel with the proposal's title and body.
4. Open `http://127.0.0.1:4545`, go to **Decisions**, read the proposal,
   click **Approve** (or **Reject**).
5. The adapter's `applyDecision` flips the proposal's frontmatter to
   `approved`, commits `chore(coo): approve <slug>`, and pushes to `main`
   in the cloned repo — visible in **Runs** as a `git.commit`/`git.push`
   event, and in **Wiki** as the decision recorded on the proposal's page.

## Concepts

- **Agents** (`agents/<name>/AGENT.md`) — a persona plus a workspace
  directory; the only thing that changes what an agent can *do* is the
  routine's `permission_mode`/`allowed_tools`, not the agent itself.
- **Skills** (`skills/<name>/`) — `skill.md` (instructions) +
  `learnings.md` + `eval.json` (self-scoring rubric) + `last-output.md` +
  `context/handoff.md`, all rewritten by a kernel-driven wrap-up turn
  after every run.
- **Routines** (`routines.yaml`) — the schedule: `every`/`cron`/`on`
  triggers, `after:` chains a handoff from one skill's run into the next,
  `daily_budget_usd` (global or per routine) trips a circuit breaker that
  skips further fires and alerts once a routine's spend for the UTC day
  meets its cap — visible as a "budget hit" chip in the dashboard's
  Routines and Costs panels, resetting on its own at midnight.
- **Wiki** (`wiki/`) — LLM-owned memory; the *only* writer is the
  `remember` syscall, which keeps `index.md` and `log.md` in sync.
- **Decisions** — created by `request_approval`, resolved only by a human
  via the dashboard or `agentos approve|reject`.
- **Adapters** (`packages/adapters`) — `sync()` mirrors an external
  project's state into `raw/`; `applyDecision()` acts on an approved or
  rejected proposal.

## Security

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full containment model:
`--strict-mcp-config` + tool allowlists + directory scoping per run,
secrets only in `.env`, `remember`'s built-in redaction, and gitleaks in
both the pre-commit hook and CI.

## Roadmap

- Docker packaging for the daemon.
- A Windows service wrapper (today it's `agentos up` in a terminal, or an
  optional, manually-installed Task Scheduler entry — see
  `docs/PRIVATE_INSTANCE.md`).
- More project adapters beyond `techpulse-coo`.

## Credits

- Andrej Karpathy's LLM Wiki gist (github.com/karpathy) — the raw/wiki
  split and the ingest/query/lint workflow shape.
- RoboNuggets' "The NEW Agentic OS standard for Claude 5 Models" and
  MindStudio's write-up — the four-layer framing (context, memory,
  self-improving skills, scheduled workflows) and the "command centre"
  dashboard idea.
- [AIOS](https://github.com/agiresearch/AIOS) — kernel vocabulary
  (scheduler, memory, syscalls) for an LLM-agent operating system.
- Vercel's [eve](https://github.com/vercel-labs/eve) — "an agent is a
  directory."

## License

MIT — see [LICENSE](LICENSE).
