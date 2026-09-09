# agent-os — Shared Implementation Contract

This file is the binding contract for every milestone plan (M1–M6). Planners
and implementers MUST use these exact names, paths, signatures and shapes.
If a milestone needs something not here, it adds it to its own plan under an
explicit "Contract additions" heading, never by renaming what is here.

Spec: `docs/superpowers/specs/2026-09-08-agent-os-design.md`

## 0. Global constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only
  (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome (single tool).
- Runtime deps (pinned major): `zod@^3`, `better-sqlite3@^12` (was ^11; ^12 ships Node 24 prebuilds), `croner@^9`,
  `fastify@^5` + `@fastify/websocket@^11` + `@fastify/static@^8`,
  `commander@^12`, `yaml@^2`, `@modelcontextprotocol/sdk@^1`, `execa@^9`,
  `simple-git@^3`, `gray-matter@^4`, `nanoid@^5`, `pino@^9`.
- Dashboard: `react@^18`, `react-dom@^18`, `vite@^6`, `tailwindcss@^4`.
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`).
- Every commit message ends with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Public repo: `github.com/ductringuyen-0618/agent-os`. Default branch `main`.
- Nothing machine-specific in committed files (no absolute paths, hostnames,
  tokens). Runtime state under `<osRoot>/../.agentos/` (gitignored).
- The `claude` binary path comes from `AGENTOS_CLAUDE_BIN` (default `claude`);
  tests point it at the fake binary.

## 1. Repository layout
```
agent-os/
  package.json                # pnpm workspace root; scripts: build, test, lint, dev
  pnpm-workspace.yaml         # packages/*, examples/*
  tsconfig.base.json
  biome.json
  .gitignore                  # node_modules, dist, .agentos/, .env, *.db
  .gitleaks.toml
  .github/workflows/ci.yml    # pnpm install, lint, test, build
  README.md
  docs/superpowers/specs/2026-09-08-agent-os-design.md
  docs/superpowers/plans/*.md
  packages/
    shared/     @agentos/shared
    kernel/     @agentos/kernel
    cli/        @agentos/cli        (bin: agentos)
    dashboard/  @agentos/dashboard
    adapters/   @agentos/adapters
  examples/os-template/       # sanitized instance (layout in §2)
  tools/fake-claude/          # test double for `claude -p` (§9)
```

### 1.1 `packages/shared/src`
```
index.ts            # re-exports
types/run.ts        # Run, RunStatus
types/event.ts      # Event, EventType, ClaudeStreamMessage
types/decision.ts   # Decision
types/message.ts    # Message
types/routine.ts    # RoutineConfig, RoutinesFile, Trigger
types/project.ts    # ProjectConfig
types/skill.ts      # SkillMeta, EvalCriteria
types/api.ts        # request/response shapes for §7
schemas.ts          # zod schemas for all of the above (named <Type>Schema)
```

### 1.2 `packages/kernel/src`
```
index.ts                     # createKernel(config): Kernel
config.ts                    # KernelConfig + loadKernelConfig(osRoot)
log/eventLog.ts              # EventLog (better-sqlite3)
log/schema.sql               # tables (§8)
process/processManager.ts    # ProcessManager
process/streamParser.ts      # parseStreamLine
process/promptAssembler.ts   # assemblePrompt, wrapUpPrompt
process/mcpConfig.ts         # writeRunMcpConfig
scheduler/scheduler.ts       # Scheduler
scheduler/triggers.ts        # trigger matching helpers
wiki/wikiService.ts          # WikiService
wiki/redact.ts               # findSecrets, SecretDetectedError
wiki/index.ts                # index.md / log.md helpers
syscall/bin.ts               # stdio MCP server entry (spawned by claude)
syscall/tools.ts             # tool definitions (§6)
syscall/handler.ts           # daemon-side executor
adapters/adapterHost.ts      # AdapterHost
adapters/types.ts            # ProjectAdapter interface (§5)
api/server.ts                # Fastify app: routes (§7) + WS
api/internal.ts              # POST /internal/syscall
kernel.ts                    # Kernel class wiring modules
```

### 1.3 `packages/cli/src`
```
bin.ts                       # commander program
client.ts                    # ApiClient (fetch wrapper for §7)
commands/{init,up,ps,logs,run,decisions,approve,reject,routines,wiki,sync}.ts
```

### 1.4 `packages/dashboard/src`
```
main.tsx, App.tsx
api/client.ts                # same routes as §7
api/ws.ts                    # useEvents() hook over /ws
panels/{Agents,Runs,Decisions,Wiki,Skills,Routines,Costs}Panel.tsx
components/{RunStream,DecisionCard,WikiPage,StatusBadge}.tsx
```

### 1.5 `packages/adapters/src`
```
index.ts                     # registry: { 'techpulse-coo': techpulseCooAdapter }
techpulseCoo/adapter.ts
techpulseCoo/frontmatter.ts  # readStatus/setStatus on proposal files
```

## 2. Instance (`os/`) layout — identical for `examples/os-template`
```
os/
  CLAUDE.md
  raw/.gitkeep
  wiki/index.md  wiki/log.md  wiki/business-brain.md
  wiki/{projects,agents,concepts,decisions}/.gitkeep
  output/{approvals,reports,digests}/.gitkeep
  skills/<name>/skill.md  learnings.md  eval.json  last-output.md  context/handoff.md
  agents/<name>/AGENT.md  agents/<name>/workspace/.gitkeep
  routines.yaml
  projects/<name>.yaml
```
Runtime dir: `<osRoot>/../.agentos/` containing `agentos.db`, `clones/`,
`runs/<runId>/` (mcp.json, stdout.jsonl), `pids/`.

Built-in agents: `ops`, `librarian`. Built-in skills: `heartbeat`, `ingest`,
`query`, `lint`, `daily-digest`.

## 3. Shared types (exact)
```ts
// types/run.ts
export type RunStatus = 'queued'|'running'|'wrapping_up'|'success'|'failed'|'blocked'|'killed'
export interface Run {
  id: string; routine: string; skill?: string; adapter?: string; agent?: string
  status: RunStatus; attempt: number; payload?: Record<string, unknown>
  sessionId?: string; pid?: number
  startedAt?: string; endedAt?: string           // ISO
  inputTokens?: number; outputTokens?: number; costUsd?: number
  error?: string
}

// types/event.ts
export type EventType =
  | 'run.queued'|'run.started'|'run.stream'|'run.wrapup'|'run.finished'|'run.failed'|'run.killed'
  | 'raw.added'|'raw.changed'|'proposal.changed'
  | 'decision.created'|'decision.resolved'
  | 'message.sent'|'wiki.written'|'schedule.created'
  | 'git.commit'|'git.push'|'ops.alert'|'security.redacted'
  | `custom.${string}`
export interface Event { id: number; ts: string; type: EventType; runId?: string; payload: Record<string, unknown> }
export type ClaudeStreamMessage =
  | { type: 'system'; subtype: 'init'; session_id: string; model?: string }
  | { type: 'assistant'; message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> }; session_id: string }
  | { type: 'user'; message: { content: unknown }; session_id: string }
  | { type: 'result'; subtype: 'success'|'error_max_turns'|'error_during_execution'; session_id: string;
      total_cost_usd?: number; usage?: { input_tokens: number; output_tokens: number }; result?: string; is_error?: boolean }

// types/decision.ts
export type DecisionStatus = 'pending'|'approved'|'rejected'|'error'
export interface Decision {
  id: string; title: string; body: string; adapter?: string; ref?: string
  status: DecisionStatus; createdByRun?: string; createdAt: string; resolvedAt?: string; error?: string
}

// types/message.ts
export interface Message { id: string; from: string; to: string; body: string; ts: string; readAt?: string }

// types/routine.ts
export type PermissionMode = 'plan'|'acceptEdits'|'default'|'bypassPermissions'
export interface RoutineDefaults { model: string; permission_mode: PermissionMode; allowed_tools: string[]; max_attempts: number; timeout_ms: number }
export interface RoutineConfig {
  name: string; enabled?: boolean
  skill?: string; adapter?: string; agent?: string
  every?: string; cron?: string; on?: EventType[]; after?: string[]
  model?: string; permission_mode?: PermissionMode; allowed_tools?: string[]
  extra_mcp?: Record<string, { command: string; args?: string[]; env?: Record<string,string> }>
  max_attempts?: number; timeout_ms?: number
}
export interface RoutinesFile { defaults: RoutineDefaults; routines: RoutineConfig[] }
// exactly one of every|cron|on must be set unless the routine is manual-only

// types/project.ts
export interface ProjectConfig { name: string; adapter: string; repo: string; clone: string; base_branch: string; options: Record<string, unknown> }

// types/skill.ts
export interface EvalCriteria { criteria: Array<{ key: string; weight: number; description: string }> }
export interface SkillMeta { name: string; path: string; hasLearnings: boolean; lastScore?: number }
```
`schemas.ts` exports `RunSchema, EventSchema, DecisionSchema, MessageSchema,
RoutineConfigSchema, RoutinesFileSchema, ProjectConfigSchema, EvalCriteriaSchema`
and `parseRoutinesFile(yamlText: string): RoutinesFile` (throws ZodError).

## 4. Kernel module APIs (exact)
```ts
// config.ts
export interface KernelConfig {
  osRoot: string; runtimeDir: string; dbPath: string; claudeBin: string
  host: '127.0.0.1'; port: number; authToken?: string; logLevel: 'info'|'debug'
}
export function loadKernelConfig(osRoot: string, overrides?: Partial<KernelConfig>): KernelConfig
// runtimeDir = path.resolve(osRoot, '..', '.agentos'); port default 4545; env AGENTOS_PORT, AGENTOS_TOKEN, AGENTOS_CLAUDE_BIN

// log/eventLog.ts
export class EventLog {
  constructor(dbPath: string)
  append(e: Omit<Event,'id'|'ts'>): Event
  createRun(r: Omit<Run,'id'|'status'|'attempt'> & { attempt?: number }): Run
  updateRun(id: string, patch: Partial<Run>): Run
  getRun(id: string): Run | undefined
  listRuns(opts?: { status?: RunStatus; routine?: string; limit?: number }): Run[]
  listEvents(opts: { runId?: string; sinceId?: number; types?: EventType[]; limit?: number }): Event[]
  createDecision(d: Omit<Decision,'id'|'status'|'createdAt'>): Decision
  resolveDecision(id: string, status: 'approved'|'rejected'|'error', error?: string): Decision
  listDecisions(opts?: { status?: DecisionStatus }): Decision[]
  sendMessage(m: Omit<Message,'id'|'ts'>): Message
  readInbox(agent: string, markRead?: boolean): Message[]
  subscribe(cb: (e: Event) => void): () => void
  close(): void
}

// process/streamParser.ts
export function parseStreamLine(line: string): ClaudeStreamMessage | null   // null for blank/unparseable

// process/promptAssembler.ts
export interface AssembleInput { osRoot: string; skill: string; agent: string; task?: string; upstreamSkill?: string }
export interface AssembledPrompt { prompt: string; systemPromptAppend: string }
export function assemblePrompt(i: AssembleInput): Promise<AssembledPrompt>
export function wrapUpPrompt(osRoot: string, skill: string): string

// process/mcpConfig.ts
export function writeRunMcpConfig(runtimeDir: string, run: Run, daemonUrl: string, runToken: string,
  extra?: RoutineConfig['extra_mcp']): Promise<string>   // returns path to runs/<id>/mcp.json

// process/processManager.ts
export interface SpawnSpec {
  prompt: string; systemPromptAppend: string; cwd: string; model: string
  permissionMode: PermissionMode; allowedTools: string[]; addDirs: string[]
  mcpConfigPath: string; resumeSessionId?: string; timeoutMs: number
}
export interface RunResult { status: 'success'|'failed'|'killed'; sessionId?: string; costUsd?: number; inputTokens?: number; outputTokens?: number; error?: string; resultText?: string }
export class ProcessManager {
  constructor(cfg: KernelConfig, log: EventLog)
  start(run: Run, spec: SpawnSpec): Promise<RunResult>   // emits run.started, run.stream per line, run.finished|run.failed
  kill(runId: string): boolean
  running(): string[]
}

// scheduler/scheduler.ts
export class Scheduler {
  constructor(cfg: KernelConfig, log: EventLog, exec: (routine: RoutineConfig, payload?: Record<string,unknown>) => Promise<void>)
  load(routines: RoutinesFile): void
  start(): void
  stop(): void
  runNow(name: string, payload?: Record<string,unknown>): Promise<string>   // returns runId
  onEvent(e: Event): void       // matches `on:` triggers
  scheduleOnce(skill: string, when: Date, payload?: Record<string,unknown>): string
  setEnabled(name: string, enabled: boolean): void
  list(): Array<{ routine: RoutineConfig; nextRun?: string; lastRun?: Run }>
}

// wiki/redact.ts
export class SecretDetectedError extends Error { patterns: string[] }
export function findSecrets(text: string): string[]   // names of matched patterns

// wiki/wikiService.ts
export interface WritePageInput { path: string; content: string; links?: string[]; runId?: string; op?: 'ingest'|'query'|'lint'|'decision'|'note' }
export class WikiService {
  constructor(osRoot: string, log: EventLog)
  writePage(i: WritePageInput): Promise<{ result: 'created'|'updated'; path: string }>  // throws SecretDetectedError; throws if path starts with 'raw/'
  readPage(path: string): Promise<string>
  readIndex(): Promise<string>
  readLog(limit?: number): Promise<string>
  listUnindexedRaw(): Promise<string[]>
  appendLog(op: string, title: string, runId?: string): Promise<void>   // "## [YYYY-MM-DD] <op> | <title>"
}

// adapters/adapterHost.ts
export class AdapterHost {
  constructor(cfg: KernelConfig, log: EventLog, wiki: WikiService, registry: Record<string, ProjectAdapter>)
  loadProjects(): Promise<ProjectConfig[]>        // reads os/projects/*.yaml, expands ${AGENTOS_HOME}, ${AGENTOS_CLONES}
  sync(projectName: string, runId?: string): Promise<SyncResult>
  applyDecision(decision: Decision): Promise<void>
}

// kernel.ts
export interface Kernel { cfg: KernelConfig; log: EventLog; pm: ProcessManager; scheduler: Scheduler; wiki: WikiService; adapters: AdapterHost; start(): Promise<void>; stop(): Promise<void> }
export function createKernel(cfg: KernelConfig): Kernel
```

## 5. ProjectAdapter (exact)
```ts
// adapters/types.ts
export interface AdapterContext { cfg: KernelConfig; log: EventLog; wiki: WikiService; project: ProjectConfig; runId?: string }
export interface SyncResult { added: string[]; changed: string[]; events: EventType[] }
export interface ProjectAdapter {
  name: string
  sync(ctx: AdapterContext): Promise<SyncResult>
  applyDecision(decision: Decision, ctx: AdapterContext): Promise<void>
}
```
`techpulse-coo` options: `{ proposals_path: string; state_path: string; reports_path: string }`.
Mirrors into `raw/<project>/proposals/<file>`, `raw/<project>/reports/<file>`,
`raw/<project>/state.md`. Decision `ref` = proposal filename (e.g. `001-slug.md`).

## 6. Syscalls (MCP tools) — exact names & input schemas
Server name in `--mcp-config`: `agentos`. Tool names as exposed to Claude: `mcp__agentos__<tool>`.
| tool | input (zod) | output |
|---|---|---|
| `get_context` | `{}` | `{ businessBrain: string; index: string }` |
| `remember` | `{ page: string; content: string; links?: string[]; op?: 'ingest'\|'query'\|'lint'\|'decision'\|'note' }` | `{ result: 'created'\|'updated'; path: string }` |
| `read_wiki` | `{ page: string }` | `{ content: string }` |
| `emit_event` | `{ type: string; payload?: object }` (type must start with `custom.` or be `raw.added`) | `{ id: number }` |
| `send_message` | `{ to: string; body: string }` | `{ id: string }` |
| `read_inbox` | `{}` | `{ messages: Message[] }` |
| `schedule` | `{ skill: string; when: string (ISO or "+30m"); payload?: object }` | `{ scheduleId: string }` |
| `request_approval` | `{ title: string; body: string; adapter?: string; ref?: string }` | `{ decisionId: string }` |

Transport: `syscall/bin.ts` is a stdio MCP server; for each tool call it POSTs
`{ tool, args }` to `${AGENTOS_DAEMON_URL}/internal/syscall` with header
`X-Run-Token: ${AGENTOS_RUN_TOKEN}` and returns the JSON. Env vars are set in
the generated `mcp.json`. The daemon validates the token against the run.

## 7. HTTP API (Fastify, prefix `/api`, JSON) and WS
```
GET  /api/health                         -> { ok: true, version }
GET  /api/runs?status=&routine=&limit=   -> Run[]
GET  /api/runs/:id                       -> Run
GET  /api/runs/:id/events?sinceId=       -> Event[]
POST /api/runs        { skill, agent?, payload? } -> { runId }
POST /api/runs/:id/kill                  -> { ok }
GET  /api/decisions?status=              -> Decision[]
POST /api/decisions/:id/approve          -> Decision
POST /api/decisions/:id/reject           -> Decision
GET  /api/routines                       -> Scheduler.list()
POST /api/routines/:name/run  { payload? } -> { runId }
POST /api/routines/:name/enable | /disable -> { ok }
GET  /api/wiki/index                     -> { content }
GET  /api/wiki/log?limit=                -> { content }
GET  /api/wiki/page?path=                -> { content }
GET  /api/skills                         -> SkillMeta[]
GET  /api/agents                         -> Array<{ name; status: 'idle'|'working'|'blocked'; currentRun?: string }>
GET  /api/costs?days=                    -> Array<{ day; agent; costUsd }>
POST /api/projects/:name/sync            -> SyncResult
POST /internal/syscall { tool, args }    (header X-Run-Token) -> tool output
WS   /ws                                 -> server pushes every Event as JSON
```
If `authToken` is set, all `/api/*` and `/ws` require `Authorization: Bearer <token>`.
Errors: `{ error: string }` with 4xx/5xx.

## 8. SQLite schema (`log/schema.sql`)
```sql
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, routine TEXT NOT NULL, skill TEXT, adapter TEXT, agent TEXT,
  status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, payload TEXT, session_id TEXT, pid INTEGER,
  started_at TEXT, ended_at TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
  run_id TEXT, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id); CREATE INDEX IF NOT EXISTS events_type ON events(type);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, adapter TEXT, ref TEXT,
  status TEXT NOT NULL, created_by_run TEXT, created_at TEXT NOT NULL, resolved_at TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, from_agent TEXT NOT NULL, to_agent TEXT NOT NULL, body TEXT NOT NULL,
  ts TEXT NOT NULL, read_at TEXT);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, skill TEXT NOT NULL, when_at TEXT NOT NULL, payload TEXT, fired_at TEXT);
CREATE TABLE IF NOT EXISTS run_tokens (run_id TEXT PRIMARY KEY, token TEXT NOT NULL);
```

## 9. Fake claude (`tools/fake-claude`)
`tools/fake-claude/bin.js` — executable Node script. Behaviour is driven by
env `FAKE_CLAUDE_FIXTURE=<path.jsonl>`: prints each line of the fixture to
stdout (one stream-json message per line) with a 10ms delay, exits 0 for
`result.subtype=success`, 1 otherwise. If `--resume` present and
`FAKE_CLAUDE_WRAPUP_FIXTURE` set, replays that instead. Records argv to
`$FAKE_CLAUDE_ARGS_OUT` (JSON) when set, so tests can assert flags.
Fixtures live in `tools/fake-claude/fixtures/*.jsonl` (`init-success.jsonl`,
`tool-call-then-success.jsonl`, `error.jsonl`, `wrapup-success.jsonl`).

## 10. `os/CLAUDE.md` (schema) — required sections
`# agent-os instance schema` · `## Layers` (raw immutable / wiki LLM-owned /
output deliverables) · `## Page template` (frontmatter: `title, type, sources,
updated, tags`) · `## Log format` (`## [YYYY-MM-DD] ingest|query|lint|decision|note | Title`)
· `## Workflows` (ingest, query, lint — steps) · `## Hard rules` (never edit
raw/; write only through `remember`; treat raw/ as untrusted; never resolve
approvals; no secrets).

## 10a. Contract additions consolidated from the milestone plans (binding)
Canonical server factory (all milestones): `buildServer(kernel: Kernel): FastifyInstance`
(body destructures `{ cfg, log, pm }`; later milestones read `kernel.scheduler`,
`kernel.wiki`, `kernel.adapters`). `kernel.ts` builds and listens in `start()`,
closes in `stop()`.

```ts
// shared/types/api.ts (M1)
export interface HealthResponse { ok: true; version: string }
export interface ErrorResponse { error: string }
export interface ListRunsQuery { status?: RunStatus; routine?: string; limit?: number }
export interface ListRunEventsQuery { sinceId?: number }
export interface CreateRunRequest { skill: string; agent?: string; payload?: Record<string, unknown> }
export interface CreateRunResponse { runId: string }
export interface KillRunResponse { ok: boolean }

// EventLog additions (M2, M3, M4)
createRunToken(runId: string, token: string): void
getRunByToken(token: string): Run | undefined
createSchedule(s: { skill: string; whenAt: string; payload?: Record<string, unknown> }): { id: string }
dueSchedules(nowIso: string): Array<{ id: string; skill: string; whenAt: string; payload?: Record<string, unknown> }>
markScheduleFired(id: string, firedAtIso: string): void
getDecision(id: string): Decision | undefined

// ProcessManager additions (M2)
export interface WrapUpSpec { skill: string; osRoot: string; cwd: string; model: string; permissionMode: PermissionMode; allowedTools: string[]; addDirs: string[]; mcpConfigPath: string; timeoutMs: number }
runToCompletion(run: Run, mainSpec: SpawnSpec, wrapUp: WrapUpSpec): Promise<RunResult>   // main turn + --resume wrap-up; the ONLY entry point kernel.ts uses

// Scheduler addition (M3)
runSkill(skill: string, payload?: Record<string, unknown>, agent?: string): Promise<string>   // ad-hoc run; POST /api/runs uses it

// Syscall modules (M2)
export interface SyscallContext { runId: string; agent: string; osRoot: string; log: EventLog; wiki: WikiService; scheduler: Scheduler }
export class SyscallError extends Error { code: string }
export function handleSyscall(tool: string, args: unknown, ctx: SyscallContext): Promise<unknown>
export interface SyscallToolDef { description: string; inputSchema: z.ZodTypeAny; mcpInputSchema: Record<string, unknown> }
export const SyscallToolDefs: Record<string, SyscallToolDef>
export interface InternalRouteDeps { log: EventLog; wiki: WikiService; scheduler: Scheduler; osRoot: string }
export function registerInternalRoutes(app: FastifyInstance, deps: InternalRouteDeps): void

// CLI (M1)
export interface ApiClientOptions { baseUrl: string; token?: string }
export class ApiClient { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T>; /* + typed helpers per milestone */ }

// Dashboard-driven server additions (M5)
GET /api/skills/:name -> { skillMd: string; learningsMd: string; eval: EvalCriteria; lastOutputMd: string }   // 404 {error} if missing
@fastify/static serves packages/dashboard/dist at '/', SPA fallback to index.html for non-/api, non-/ws paths
```
Rule: every run's syscall token is registered with `log.createRunToken` BEFORE
`writeRunMcpConfig`; the only production path that spawns Claude is the
Scheduler `exec` callback in `kernel.ts` (M3 Task 8), which calls
`pm.runToCompletion`. Decisions for TechPulse proposals are created by the
adapter's `sync()` (spec §5.1), not by the `ingest` skill.

Additional files owned by M6: `lefthook.yml`, root `vitest.config.ts` +
`test/no-secrets-no-paths.test.ts`, `packages/cli/src/gitleaksTemplate.ts`,
`LICENSE` (MIT), `docs/SECURITY.md`, `docs/DEMO.md`, `docs/PRIVATE_INSTANCE.md`,
`docs/demo.gif` (placeholder path).

## 11. Milestone → plan files
| M | Plan file | Deliverable |
|---|---|---|
| 1 | `2026-09-08-agent-os-m1-kernel-core.md` | repo bootstrap, shared types, EventLog, StreamParser, PromptAssembler, ProcessManager (fake claude), CLI `up/ps/logs/run`, Api runs routes + WS |
| 2 | `2026-09-08-agent-os-m2-wiki-syscalls.md` | WikiService, redact, SyscallServer (bin+handler+internal route), mcpConfig, `os/CLAUDE.md`, skills ingest/query/lint, wrap-up turn |
| 3 | `2026-09-08-agent-os-m3-scheduler-heartbeat.md` | Scheduler (every/cron/on/after/scheduleOnce), routines.yaml loading, heartbeat + daily-digest skills, routines API + CLI |
| 4 | `2026-09-08-agent-os-m4-techpulse-adapter.md` | adapters pkg, AdapterHost, techpulse-coo adapter, decisions API + CLI approve/reject, projects sync |
| 5 | `2026-09-08-agent-os-m5-dashboard.md` | dashboard app, all panels, WS hook, served by kernel, Playwright smoke |
| 6 | `2026-09-08-agent-os-m6-release.md` | README + demo, examples/os-template, gitleaks + CI, `agentos init`, private instance bootstrap doc |
