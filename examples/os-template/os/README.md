# This is an agent-os instance

1. `CLAUDE.md` — the schema every agent run reads: layers, page template,
   log format, workflows, hard rules.
2. `raw/` — immutable inputs. Nothing here is ever edited by an agent.
3. `wiki/` — LLM-owned memory: `index.md` (page list), `log.md`
   (append-only activity log), `business-brain.md` (your context —
   replace the Acme Devtools example), plus `agents/`, `projects/`,
   `concepts/`, `decisions/` pages written by the `remember` syscall.
4. `output/` — deliverables: `approvals/`, `reports/`, `digests/`.
5. `skills/<name>/` — one folder per capability: `skill.md`
   (instructions), `learnings.md` (self-updated), `eval.json` (scoring
   rubric), `last-output.md`, `context/handoff.md`.
6. `agents/<name>/AGENT.md` — persona + boundaries for `ops` and
   `librarian`; `agents/<name>/workspace/` is that agent's only writable
   directory outside the syscalls.
7. `routines.yaml` — the schedule: heartbeat, ingest, lint, daily-digest,
   and a project sync routine.
8. `projects/<name>.yaml` — one file per project adapter; replace
   `projects/techpulse.yaml` with your own repo before enabling its sync
   routine.

Start the daemon with `agentos up --root <path-to-this-os-folder>`.
