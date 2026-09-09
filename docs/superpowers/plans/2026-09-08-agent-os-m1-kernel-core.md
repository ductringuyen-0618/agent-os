# agent-os M1 — Kernel Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `agent-os` monorepo and its kernel core — shared types, `EventLog`, `ProcessManager` driving a fake `claude -p`, the runs-only HTTP API, and a CLI — so `agentos up`, `agentos run heartbeat --agent ops`, and `agentos logs <runId>` work end to end without spending real API tokens.
**Architecture:** `packages/shared` defines every cross-cutting type and its zod schema, including `parseRoutinesFile`. `packages/kernel` wires `EventLog` (append-only SQLite) + `ProcessManager` (spawns `claude -p`, parses `stream-json` via `streamParser.ts`, builds prompts via `promptAssembler.ts`) behind a Fastify `api/server.ts` exposing only the runs routes, `/api/health`, and `/ws`; `Scheduler`, `WikiService`, and `AdapterHost` are wired into `kernel.ts` as minimal no-op stubs that M2–M4 replace. `packages/cli` is a thin `commander` program (`up`, `ps`, `logs`, `run`) talking to the daemon over `client.ts`. `tools/fake-claude` is a Node script that replays `stream-json` fixtures so tests never call the real `claude` binary.
**Tech Stack:** TypeScript `^5.6` strict/ESM, Vitest, `zod@^3`, `yaml@^2`, `better-sqlite3@^11`, `fastify@^5` + `@fastify/websocket@^11`, `execa@^9`, `nanoid@^5`, `commander@^12`, `tsup`, Biome.
**Spec:** docs/superpowers/specs/2026-09-08-agent-os-design.md
**Contract:** docs/superpowers/plans/2026-09-08-agent-os-00-contract.md

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome (single tool).
- Runtime deps (pinned major): `zod@^3`, `better-sqlite3@^11`, `croner@^9`, `fastify@^5` + `@fastify/websocket@^11` + `@fastify/static@^8`, `commander@^12`, `yaml@^2`, `@modelcontextprotocol/sdk@^1`, `execa@^9`, `simple-git@^3`, `gray-matter@^4`, `nanoid@^5`, `pino@^9`.
- Dashboard: `react@^18`, `react-dom@^18`, `vite@^6`, `tailwindcss@^4`.
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`).
- Every commit message ends with: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Public repo: `github.com/ductringuyen-0618/agent-os`. Default branch `main`.
- Nothing machine-specific in committed files (no absolute paths, hostnames, tokens). Runtime state under `<osRoot>/../.agentos/` (gitignored).
- The `claude` binary path comes from `AGENTOS_CLAUDE_BIN` (default `claude`); tests point it at the fake binary.
---

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.gitignore` | Workspace root config |
| `.github/workflows/ci.yml` | CI: install, lint, test, build |
| `docs/superpowers/specs/2026-09-08-agent-os-design.md`, `docs/superpowers/plans/2026-09-08-agent-os-00-contract.md`, `docs/superpowers/plans/2026-09-08-agent-os-m1-kernel-core.md` | Copied binding docs |
| `packages/shared/src/types/{run,event,decision,message,routine,project,skill,api}.ts` | Exact contract types (§3) + M1 API request/response shapes |
| `packages/shared/src/schemas.ts` | Zod schemas + `parseRoutinesFile` |
| `packages/shared/src/index.ts` | Re-exports |
| `packages/kernel/src/config.ts` | `KernelConfig`, `loadKernelConfig` |
| `packages/kernel/src/log/eventLog.ts`, `packages/kernel/src/log/schema.sql` | `EventLog` (better-sqlite3), SQLite schema (§8) |
| `packages/kernel/src/process/streamParser.ts` | `parseStreamLine` |
| `packages/kernel/src/process/promptAssembler.ts` | `assemblePrompt`, `wrapUpPrompt` |
| `packages/kernel/src/process/processManager.ts` | `ProcessManager` — spawns `claude -p`, parses stream-json, emits events |
| `packages/kernel/src/scheduler/scheduler.ts` | `Scheduler` — **M1 no-op stub**, replaced in M3 |
| `packages/kernel/src/wiki/wikiService.ts` | `WikiService` — **M1 no-op stub**, replaced in M2 |
| `packages/kernel/src/adapters/types.ts`, `packages/kernel/src/adapters/adapterHost.ts` | `ProjectAdapter` interface + `AdapterHost` — **M1 no-op stub**, replaced in M4 |
| `packages/kernel/src/api/server.ts` | Fastify app: `/api/health`, runs routes (§7), `/ws` |
| `packages/kernel/src/kernel.ts`, `packages/kernel/src/index.ts` | `createKernel`, package exports |
| `packages/cli/src/client.ts` | `ApiClient` (fetch wrapper) |
| `packages/cli/src/commands/{up,ps,logs,run}.ts` | CLI command implementations |
| `packages/cli/src/bin.ts` | `commander` program entry (`agentos`) |
| `packages/cli/src/acceptance.e2e.test.ts` | End-to-end proof of the M1 milestone demo |
| `tools/fake-claude/bin.js`, `tools/fake-claude/bin.test.js` | Fake `claude` executable (§9) + its own test |
| `tools/fake-claude/fixtures/*.jsonl` | Stream-json fixtures |
| `examples/os-template/os/**` | Minimal sanitized instance (§2) |

Every implementation file `X.ts` gets a colocated `X.test.ts` in the same directory (Vitest's default discovery needs no config file — `vitest run` picks up any `*.test.ts` under the current package directory).

## Task 1: Repo bootstrap & tooling

**Files:** Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.github/workflows/ci.yml`, `docs/superpowers/specs/2026-09-08-agent-os-design.md`, `docs/superpowers/plans/2026-09-08-agent-os-00-contract.md`, `docs/superpowers/plans/2026-09-08-agent-os-m1-kernel-core.md`.
**Interfaces:** Produces: a working `pnpm install` at the repo root that later tasks build on. No TypeScript interfaces yet.

This task has no application logic, so its "tests" are verification commands rather than a red/green unit-test cycle.

- [ ] **Step 1: create and clone the repo, copy the binding docs**

  From `D:\Portfolio` in PowerShell:
  ```powershell
  Set-Location D:\Portfolio
  gh repo create ductringuyen-0618/agent-os --public --clone
  Set-Location D:\Portfolio\agent-os
  New-Item -ItemType Directory -Force -Path docs\superpowers\specs, docs\superpowers\plans | Out-Null
  Copy-Item "D:\Portfolio\ai-tech-news-assistant\docs\superpowers\specs\2026-09-08-agent-os-design.md" "docs\superpowers\specs\" -Force
  Copy-Item "D:\Portfolio\ai-tech-news-assistant\docs\superpowers\plans\2026-09-08-agent-os-00-contract.md" "docs\superpowers\plans\" -Force
  Copy-Item "D:\Portfolio\ai-tech-news-assistant\docs\superpowers\plans\2026-09-08-agent-os-m1-kernel-core.md" "docs\superpowers\plans\" -Force
  ```
  Expected: `D:\Portfolio\agent-os` exists, is a git repo with remote `origin` pointing at `github.com/ductringuyen-0618/agent-os`, and contains the three copied files under `docs/superpowers/`.

  All remaining steps in this plan assume the working directory is `D:\Portfolio\agent-os`.

- [ ] **Step 2: workspace root files**

  ```json
  // package.json
  {
    "name": "agent-os",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "engines": { "node": ">=22" },
    "packageManager": "pnpm@9.12.0",
    "scripts": {
      "build": "pnpm -r --if-present run build",
      "test": "vitest run",
      "lint": "biome check .",
      "dev": "pnpm --filter @agentos/cli exec node ./dist/bin.js"
    },
    "devDependencies": {
      "@biomejs/biome": "^1.9.0",
      "typescript": "^5.6.0",
      "vitest": "^2.1.0",
      "tsup": "^8.3.0"
    }
  }
  ```

  ```yaml
  # pnpm-workspace.yaml
  packages:
    - 'packages/*'
    - 'examples/*'
  ```

  ```json
  // tsconfig.base.json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022"],
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "strict": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "verbatimModuleSyntax": true
    }
  }
  ```

  ```json
  // biome.json
  {
    "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
    "organizeImports": { "enabled": true },
    "linter": { "enabled": true, "rules": { "recommended": true } },
    "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
    "files": { "ignore": ["dist", "node_modules", ".agentos"] }
  }
  ```

  ```
  # .gitignore
  node_modules/
  dist/
  .agentos/
  .env
  *.db
  *.db-journal
  *.db-wal
  coverage/
  ```

  Run: `pnpm install`
  Expected: succeeds with 0 packages found in the workspace (no `packages/*` exist yet) — this is not an error, just a warning that can be ignored.

- [ ] **Step 3: CI workflow**

  ```yaml
  # .github/workflows/ci.yml
  name: CI
  on:
    push:
      branches: [main]
    pull_request:
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
          with:
            version: '9'
        - uses: actions/setup-node@v4
          with:
            node-version: '22'
            cache: 'pnpm'
        - run: pnpm install --frozen-lockfile
        - run: pnpm lint
        - run: pnpm test
        - run: pnpm build
  ```

  Run: `pnpm lint`
  Expected: succeeds (nothing to lint yet, or only lints the files just created — fix any Biome formatting complaints it reports).

- [ ] **Step 4: commit**
  ```
  git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json .gitignore .github/workflows/ci.yml docs/superpowers
  git commit -m "$(cat <<'EOF'
  chore: bootstrap agent-os pnpm workspace

  Root package.json, pnpm-workspace.yaml, shared tsconfig, Biome config,
  gitignore, CI workflow, and the binding spec/contract/plan docs that
  every milestone implements against.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 2: `packages/shared` — types, schemas, `parseRoutinesFile`

**Files:** Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/types/run.ts`, `packages/shared/src/types/event.ts`, `packages/shared/src/types/decision.ts`, `packages/shared/src/types/message.ts`, `packages/shared/src/types/routine.ts`, `packages/shared/src/types/project.ts`, `packages/shared/src/types/skill.ts`, `packages/shared/src/types/api.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/index.ts`. Test: `packages/shared/src/schemas.test.ts`.
**Interfaces:** Produces: every type/interface in contract §3 verbatim, plus `RunSchema, EventSchema, DecisionSchema, MessageSchema, RoutineConfigSchema, RoutinesFileSchema, ProjectConfigSchema, EvalCriteriaSchema, parseRoutinesFile(yamlText: string): RoutinesFile` (contract §3), plus the M1 subset of `types/api.ts` (see "Contract additions").

- [ ] **Step 1: package scaffolding**

  ```json
  // packages/shared/package.json
  {
    "name": "@agentos/shared",
    "version": "0.1.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
    "scripts": {
      "build": "tsup src/index.ts --format esm --dts --out-dir dist",
      "test": "vitest run"
    },
    "dependencies": {
      "zod": "^3.23.0",
      "yaml": "^2.5.0"
    }
  }
  ```

  ```json
  // packages/shared/tsconfig.json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "include": ["src"]
  }
  ```

  Run: `pnpm install`
  Expected: `packages/shared` is now linked into the workspace (`pnpm ls -r --depth -1` lists `@agentos/shared`).

- [ ] **Step 2: failing test for the routine schema and `parseRoutinesFile`**

  ```ts
  // packages/shared/src/schemas.test.ts
  import { describe, expect, it } from 'vitest'
  import {
    RunSchema,
    EventSchema,
    DecisionSchema,
    MessageSchema,
    RoutineConfigSchema,
    RoutinesFileSchema,
    ProjectConfigSchema,
    EvalCriteriaSchema,
    parseRoutinesFile,
  } from './schemas.js'

  describe('RunSchema', () => {
    it('accepts a minimal run', () => {
      expect(() =>
        RunSchema.parse({ id: 'r1', routine: 'heartbeat', status: 'queued', attempt: 1 })
      ).not.toThrow()
    })
    it('rejects an unknown status', () => {
      expect(() =>
        RunSchema.parse({ id: 'r1', routine: 'heartbeat', status: 'nope', attempt: 1 })
      ).toThrow()
    })
  })

  describe('EventSchema', () => {
    it('accepts a built-in event type', () => {
      expect(() =>
        EventSchema.parse({ id: 1, ts: '2026-09-08T00:00:00.000Z', type: 'run.started', payload: {} })
      ).not.toThrow()
    })
    it('accepts a custom.* event type', () => {
      expect(() =>
        EventSchema.parse({ id: 1, ts: '2026-09-08T00:00:00.000Z', type: 'custom.my-thing', payload: {} })
      ).not.toThrow()
    })
    it('rejects an event type that is neither built-in nor custom.*', () => {
      expect(() =>
        EventSchema.parse({ id: 1, ts: '2026-09-08T00:00:00.000Z', type: 'bogus.event', payload: {} })
      ).toThrow()
    })
  })

  describe('DecisionSchema / MessageSchema / ProjectConfigSchema / EvalCriteriaSchema', () => {
    it('accept valid shapes', () => {
      expect(() =>
        DecisionSchema.parse({
          id: 'd1', title: 't', body: 'b', status: 'pending', createdAt: '2026-09-08T00:00:00.000Z',
        })
      ).not.toThrow()
      expect(() =>
        MessageSchema.parse({ id: 'm1', from: 'ops', to: 'librarian', body: 'hi', ts: '2026-09-08T00:00:00.000Z' })
      ).not.toThrow()
      expect(() =>
        ProjectConfigSchema.parse({
          name: 'techpulse', adapter: 'techpulse-coo', repo: 'x', clone: 'y', base_branch: 'main', options: {},
        })
      ).not.toThrow()
      expect(() =>
        EvalCriteriaSchema.parse({ criteria: [{ key: 'accuracy', weight: 1, description: 'd' }] })
      ).not.toThrow()
    })
  })

  describe('RoutineConfigSchema', () => {
    it('accepts a routine with exactly one trigger', () => {
      expect(() => RoutineConfigSchema.parse({ name: 'heartbeat', every: '30m' })).not.toThrow()
    })
    it('accepts a manual-only routine with no trigger', () => {
      expect(() => RoutineConfigSchema.parse({ name: 'daily-digest' })).not.toThrow()
    })
    it('rejects a routine with two triggers set', () => {
      expect(() =>
        RoutineConfigSchema.parse({ name: 'bad', every: '30m', cron: '0 3 * * *' })
      ).toThrow()
    })
  })

  describe('parseRoutinesFile', () => {
    const yamlText = `
  defaults:
    model: sonnet
    permission_mode: plan
    allowed_tools: [Read, Glob, Grep, WebFetch, WebSearch]
    max_attempts: 2
    timeout_ms: 300000
  routines:
    - name: heartbeat
      every: 30m
      skill: heartbeat
      agent: ops
      model: haiku
  `
    it('parses valid YAML into a RoutinesFile', () => {
      const parsed = parseRoutinesFile(yamlText)
      expect(parsed.defaults.model).toBe('sonnet')
      expect(parsed.routines).toHaveLength(1)
      expect(parsed.routines[0].name).toBe('heartbeat')
    })
    it('throws a ZodError on invalid YAML', () => {
      expect(() => parseRoutinesFile('defaults: {}\nroutines: "not-an-array"')).toThrow()
    })
  })

  describe('RoutinesFileSchema', () => {
    it('is used by parseRoutinesFile and is independently importable', () => {
      expect(RoutinesFileSchema).toBeDefined()
    })
  })
  ```

- [ ] **Step 2b: run it, expect failure**
  `pnpm --filter @agentos/shared test -- src/schemas.test.ts`
  Expected: fails — `Cannot find module './schemas.js'` (and `./types/*.js` don't exist yet).

- [ ] **Step 3: minimal implementation — types**

  ```ts
  // packages/shared/src/types/run.ts
  export type RunStatus = 'queued' | 'running' | 'wrapping_up' | 'success' | 'failed' | 'blocked' | 'killed'

  export interface Run {
    id: string
    routine: string
    skill?: string
    adapter?: string
    agent?: string
    status: RunStatus
    attempt: number
    payload?: Record<string, unknown>
    sessionId?: string
    pid?: number
    startedAt?: string
    endedAt?: string
    inputTokens?: number
    outputTokens?: number
    costUsd?: number
    error?: string
  }
  ```

  ```ts
  // packages/shared/src/types/event.ts
  export type EventType =
    | 'run.queued' | 'run.started' | 'run.stream' | 'run.wrapup' | 'run.finished' | 'run.failed' | 'run.killed'
    | 'raw.added' | 'raw.changed' | 'proposal.changed'
    | 'decision.created' | 'decision.resolved'
    | 'message.sent' | 'wiki.written' | 'schedule.created'
    | 'git.commit' | 'git.push' | 'ops.alert' | 'security.redacted'
    | `custom.${string}`

  export interface Event {
    id: number
    ts: string
    type: EventType
    runId?: string
    payload: Record<string, unknown>
  }

  export type ClaudeStreamMessage =
    | { type: 'system'; subtype: 'init'; session_id: string; model?: string }
    | { type: 'assistant'; message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown }> }; session_id: string }
    | { type: 'user'; message: { content: unknown }; session_id: string }
    | {
        type: 'result'
        subtype: 'success' | 'error_max_turns' | 'error_during_execution'
        session_id: string
        total_cost_usd?: number
        usage?: { input_tokens: number; output_tokens: number }
        result?: string
        is_error?: boolean
      }
  ```

  ```ts
  // packages/shared/src/types/decision.ts
  export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'error'

  export interface Decision {
    id: string
    title: string
    body: string
    adapter?: string
    ref?: string
    status: DecisionStatus
    createdByRun?: string
    createdAt: string
    resolvedAt?: string
    error?: string
  }
  ```

  ```ts
  // packages/shared/src/types/message.ts
  export interface Message {
    id: string
    from: string
    to: string
    body: string
    ts: string
    readAt?: string
  }
  ```

  ```ts
  // packages/shared/src/types/routine.ts
  import type { EventType } from './event.js'

  export type PermissionMode = 'plan' | 'acceptEdits' | 'default' | 'bypassPermissions'

  export interface RoutineDefaults {
    model: string
    permission_mode: PermissionMode
    allowed_tools: string[]
    max_attempts: number
    timeout_ms: number
  }

  export interface RoutineConfig {
    name: string
    enabled?: boolean
    skill?: string
    adapter?: string
    agent?: string
    every?: string
    cron?: string
    on?: EventType[]
    after?: string[]
    model?: string
    permission_mode?: PermissionMode
    allowed_tools?: string[]
    extra_mcp?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
    max_attempts?: number
    timeout_ms?: number
  }

  export interface RoutinesFile {
    defaults: RoutineDefaults
    routines: RoutineConfig[]
  }
  ```

  ```ts
  // packages/shared/src/types/project.ts
  export interface ProjectConfig {
    name: string
    adapter: string
    repo: string
    clone: string
    base_branch: string
    options: Record<string, unknown>
  }
  ```

  ```ts
  // packages/shared/src/types/skill.ts
  export interface EvalCriteria {
    criteria: Array<{ key: string; weight: number; description: string }>
  }

  export interface SkillMeta {
    name: string
    path: string
    hasLearnings: boolean
    lastScore?: number
  }
  ```

  ```ts
  // packages/shared/src/types/api.ts
  // M1 subset only (health + runs routes). Later milestones append more
  // entries here for decisions/routines/wiki/skills/agents/costs/projects/
  // syscall as their routes land — see "Contract additions" in
  // docs/superpowers/plans/2026-09-08-agent-os-m1-kernel-core.md.
  import type { RunStatus } from './run.js'

  export interface HealthResponse {
    ok: true
    version: string
  }

  export interface ErrorResponse {
    error: string
  }

  export interface ListRunsQuery {
    status?: RunStatus
    routine?: string
    limit?: number
  }

  export interface ListRunEventsQuery {
    sinceId?: number
  }

  export interface CreateRunRequest {
    skill: string
    agent?: string
    payload?: Record<string, unknown>
  }

  export interface CreateRunResponse {
    runId: string
  }

  export interface KillRunResponse {
    ok: boolean
  }
  ```

- [ ] **Step 4: minimal implementation — schemas and `parseRoutinesFile`**

  ```ts
  // packages/shared/src/schemas.ts
  import { z } from 'zod'
  import { parse as parseYaml } from 'yaml'
  import type { RoutinesFile } from './types/routine.js'

  const BUILTIN_EVENT_TYPES = [
    'run.queued', 'run.started', 'run.stream', 'run.wrapup', 'run.finished', 'run.failed', 'run.killed',
    'raw.added', 'raw.changed', 'proposal.changed',
    'decision.created', 'decision.resolved',
    'message.sent', 'wiki.written', 'schedule.created',
    'git.commit', 'git.push', 'ops.alert', 'security.redacted',
  ] as const

  export const EventTypeSchema = z.union([
    z.enum(BUILTIN_EVENT_TYPES),
    z.string().regex(/^custom\..+$/, 'custom event types must start with "custom."'),
  ])

  export const RunStatusSchema = z.enum([
    'queued', 'running', 'wrapping_up', 'success', 'failed', 'blocked', 'killed',
  ])

  export const RunSchema = z.object({
    id: z.string(),
    routine: z.string(),
    skill: z.string().optional(),
    adapter: z.string().optional(),
    agent: z.string().optional(),
    status: RunStatusSchema,
    attempt: z.number().int(),
    payload: z.record(z.unknown()).optional(),
    sessionId: z.string().optional(),
    pid: z.number().optional(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    costUsd: z.number().optional(),
    error: z.string().optional(),
  })

  export const EventSchema = z.object({
    id: z.number(),
    ts: z.string(),
    type: EventTypeSchema,
    runId: z.string().optional(),
    payload: z.record(z.unknown()),
  })

  export const DecisionStatusSchema = z.enum(['pending', 'approved', 'rejected', 'error'])

  export const DecisionSchema = z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    adapter: z.string().optional(),
    ref: z.string().optional(),
    status: DecisionStatusSchema,
    createdByRun: z.string().optional(),
    createdAt: z.string(),
    resolvedAt: z.string().optional(),
    error: z.string().optional(),
  })

  export const MessageSchema = z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    body: z.string(),
    ts: z.string(),
    readAt: z.string().optional(),
  })

  export const PermissionModeSchema = z.enum(['plan', 'acceptEdits', 'default', 'bypassPermissions'])

  export const RoutineDefaultsSchema = z.object({
    model: z.string(),
    permission_mode: PermissionModeSchema,
    allowed_tools: z.array(z.string()),
    max_attempts: z.number().int(),
    timeout_ms: z.number().int(),
  })

  export const RoutineConfigSchema = z
    .object({
      name: z.string(),
      enabled: z.boolean().optional(),
      skill: z.string().optional(),
      adapter: z.string().optional(),
      agent: z.string().optional(),
      every: z.string().optional(),
      cron: z.string().optional(),
      on: z.array(EventTypeSchema).optional(),
      after: z.array(z.string()).optional(),
      model: z.string().optional(),
      permission_mode: PermissionModeSchema.optional(),
      allowed_tools: z.array(z.string()).optional(),
      extra_mcp: z
        .record(
          z.object({
            command: z.string(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string()).optional(),
          })
        )
        .optional(),
      max_attempts: z.number().int().optional(),
      timeout_ms: z.number().int().optional(),
    })
    .refine(
      (r) => [r.every, r.cron, r.on].filter((v) => v !== undefined).length <= 1,
      { message: 'at most one of every|cron|on may be set on a routine' }
    )

  export const RoutinesFileSchema = z.object({
    defaults: RoutineDefaultsSchema,
    routines: z.array(RoutineConfigSchema),
  })

  export const ProjectConfigSchema = z.object({
    name: z.string(),
    adapter: z.string(),
    repo: z.string(),
    clone: z.string(),
    base_branch: z.string(),
    options: z.record(z.unknown()),
  })

  export const EvalCriteriaSchema = z.object({
    criteria: z.array(
      z.object({ key: z.string(), weight: z.number(), description: z.string() })
    ),
  })

  export function parseRoutinesFile(yamlText: string): RoutinesFile {
    const obj = parseYaml(yamlText)
    return RoutinesFileSchema.parse(obj)
  }
  ```

  ```ts
  // packages/shared/src/index.ts
  export * from './types/run.js'
  export * from './types/event.js'
  export * from './types/decision.js'
  export * from './types/message.js'
  export * from './types/routine.js'
  export * from './types/project.js'
  export * from './types/skill.js'
  export * from './types/api.js'
  export * from './schemas.js'
  ```

- [ ] **Step 5: run tests, expect PASS**
  `pnpm --filter @agentos/shared test -- src/schemas.test.ts`

- [ ] **Step 6: build shared (needed by every later package that imports `@agentos/shared`)**
  `pnpm --filter @agentos/shared build`
  Expected: `packages/shared/dist/index.js` and `.d.ts` exist. Re-run this command any time `packages/shared/src` changes and another package's tests need the update.

- [ ] **Step 7: commit**
  ```
  git add packages/shared
  git commit -m "$(cat <<'EOF'
  feat(shared): add contract types, zod schemas, and parseRoutinesFile

  Implements every type from contract §3 (Run, Event, Decision, Message,
  RoutineConfig/RoutinesFile, ProjectConfig, SkillMeta/EvalCriteria) plus
  the M1 slice of types/api.ts, their zod schemas, and parseRoutinesFile.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 3: `packages/kernel` — `config.ts`

**Files:** Create: `packages/kernel/package.json`, `packages/kernel/tsconfig.json`, `packages/kernel/src/config.ts`. Test: `packages/kernel/src/config.test.ts`.
**Interfaces:** Consumes: nothing yet. Produces: `export interface KernelConfig { osRoot: string; runtimeDir: string; dbPath: string; claudeBin: string; host: '127.0.0.1'; port: number; authToken?: string; logLevel: 'info' | 'debug' }`, `export function loadKernelConfig(osRoot: string, overrides?: Partial<KernelConfig>): KernelConfig` (contract §4).

- [ ] **Step 1: package scaffolding**

  ```json
  // packages/kernel/package.json
  {
    "name": "@agentos/kernel",
    "version": "0.1.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
    "scripts": {
      "build": "tsup src/index.ts --format esm --dts --out-dir dist",
      "test": "vitest run"
    },
    "dependencies": {}
  }
  ```

  ```json
  // packages/kernel/tsconfig.json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "include": ["src"]
  }
  ```

  Run: `pnpm install`

- [ ] **Step 2: failing test**

  ```ts
  // packages/kernel/src/config.test.ts
  import { describe, expect, it, beforeEach, afterEach } from 'vitest'
  import path from 'node:path'
  import { loadKernelConfig } from './config.js'

  describe('loadKernelConfig', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
      delete process.env.AGENTOS_PORT
      delete process.env.AGENTOS_TOKEN
      delete process.env.AGENTOS_CLAUDE_BIN
    })

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('derives runtimeDir and dbPath from osRoot', () => {
      const cfg = loadKernelConfig(path.join('some', 'instance', 'os'))
      expect(cfg.osRoot).toBe(path.resolve(path.join('some', 'instance', 'os')))
      expect(cfg.runtimeDir).toBe(path.resolve(path.join('some', 'instance', '.agentos')))
      expect(cfg.dbPath).toBe(path.join(cfg.runtimeDir, 'agentos.db'))
    })

    it('defaults host, port, claudeBin, logLevel', () => {
      const cfg = loadKernelConfig('os')
      expect(cfg.host).toBe('127.0.0.1')
      expect(cfg.port).toBe(4545)
      expect(cfg.claudeBin).toBe('claude')
      expect(cfg.logLevel).toBe('info')
      expect(cfg.authToken).toBeUndefined()
    })

    it('reads AGENTOS_PORT, AGENTOS_TOKEN, AGENTOS_CLAUDE_BIN from env', () => {
      process.env.AGENTOS_PORT = '5050'
      process.env.AGENTOS_TOKEN = 'secret-token'
      process.env.AGENTOS_CLAUDE_BIN = '/opt/fake-claude'
      const cfg = loadKernelConfig('os')
      expect(cfg.port).toBe(5050)
      expect(cfg.authToken).toBe('secret-token')
      expect(cfg.claudeBin).toBe('/opt/fake-claude')
    })

    it('lets explicit overrides win over env and defaults', () => {
      process.env.AGENTOS_PORT = '5050'
      const cfg = loadKernelConfig('os', { port: 9999, claudeBin: '/bin/fake' })
      expect(cfg.port).toBe(9999)
      expect(cfg.claudeBin).toBe('/bin/fake')
    })
  })
  ```

- [ ] **Step 3: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/config.test.ts`
  Expected: fails — `Cannot find module './config.js'`.

- [ ] **Step 4: minimal implementation**

  ```ts
  // packages/kernel/src/config.ts
  import path from 'node:path'

  export interface KernelConfig {
    osRoot: string
    runtimeDir: string
    dbPath: string
    claudeBin: string
    host: '127.0.0.1'
    port: number
    authToken?: string
    logLevel: 'info' | 'debug'
  }

  export function loadKernelConfig(osRoot: string, overrides: Partial<KernelConfig> = {}): KernelConfig {
    const resolvedOsRoot = path.resolve(osRoot)
    const runtimeDir = overrides.runtimeDir ?? path.resolve(resolvedOsRoot, '..', '.agentos')
    const dbPath = overrides.dbPath ?? path.join(runtimeDir, 'agentos.db')
    const port = overrides.port ?? (process.env.AGENTOS_PORT ? Number(process.env.AGENTOS_PORT) : 4545)
    const claudeBin = overrides.claudeBin ?? process.env.AGENTOS_CLAUDE_BIN ?? 'claude'
    const authToken = overrides.authToken ?? process.env.AGENTOS_TOKEN
    const logLevel = overrides.logLevel ?? 'info'

    return {
      osRoot: resolvedOsRoot,
      runtimeDir,
      dbPath,
      claudeBin,
      host: '127.0.0.1',
      port,
      authToken,
      logLevel,
    }
  }
  ```

- [ ] **Step 5: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/config.test.ts`

- [ ] **Step 6: commit**
  ```
  git add packages/kernel/package.json packages/kernel/tsconfig.json packages/kernel/src/config.ts packages/kernel/src/config.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add KernelConfig and loadKernelConfig

  Resolves osRoot/runtimeDir/dbPath, defaults port 4545 and claudeBin
  'claude', and reads AGENTOS_PORT/AGENTOS_TOKEN/AGENTOS_CLAUDE_BIN with
  explicit overrides taking precedence (contract §4).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 4: `packages/kernel` — `EventLog` + SQLite schema

**Files:** Create: `packages/kernel/src/log/schema.sql`, `packages/kernel/src/log/eventLog.ts`. Test: `packages/kernel/src/log/eventLog.test.ts`. Modify: `packages/kernel/package.json`.
**Interfaces:** Consumes: `Run, RunStatus, Event, EventType, Decision, DecisionStatus, Message` from `@agentos/shared`. Produces: `export class EventLog` with the exact method set in contract §4 (`append, createRun, updateRun, getRun, listRuns, listEvents, createDecision, resolveDecision, listDecisions, sendMessage, readInbox, subscribe, close`).

- [ ] **Step 1: add dependencies**

  Modify `packages/kernel/package.json` `dependencies`:
  ```json
  "dependencies": {
    "@agentos/shared": "workspace:*",
    "better-sqlite3": "^11.3.0",
    "nanoid": "^5.0.7"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
  ```
  Run: `pnpm install`

- [ ] **Step 2: failing test**

  ```ts
  // packages/kernel/src/log/eventLog.test.ts
  import { describe, expect, it, beforeEach, afterEach } from 'vitest'
  import fs from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  import { EventLog } from './eventLog.js'

  describe('EventLog', () => {
    let tmpDir: string
    let log: EventLog

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-eventlog-'))
      log = new EventLog(path.join(tmpDir, 'agentos.db'))
    })

    afterEach(() => {
      log.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('creates and retrieves a run', () => {
      const run = log.createRun({ routine: 'heartbeat', skill: 'heartbeat', agent: 'ops' })
      expect(run.status).toBe('queued')
      expect(run.attempt).toBe(1)
      expect(log.getRun(run.id)).toEqual(run)
    })

    it('updates a run', () => {
      const run = log.createRun({ routine: 'heartbeat' })
      const updated = log.updateRun(run.id, { status: 'success', costUsd: 0.01 })
      expect(updated.status).toBe('success')
      expect(updated.costUsd).toBe(0.01)
    })

    it('lists runs filtered by status', () => {
      log.createRun({ routine: 'a' })
      const r2 = log.createRun({ routine: 'b' })
      log.updateRun(r2.id, { status: 'success' })
      const stillQueued = log.listRuns({ status: 'queued' })
      expect(stillQueued.map((r) => r.routine)).toEqual(['a'])
    })

    it('appends and lists events, notifying subscribers', () => {
      const seen: string[] = []
      const unsubscribe = log.subscribe((e) => seen.push(e.type))
      const run = log.createRun({ routine: 'heartbeat' })
      log.append({ type: 'run.started', runId: run.id, payload: { foo: 'bar' } })
      log.append({ type: 'run.finished', runId: run.id, payload: {} })
      unsubscribe()
      log.append({ type: 'run.failed', runId: run.id, payload: {} })

      const events = log.listEvents({ runId: run.id })
      expect(events.map((e) => e.type)).toEqual(['run.started', 'run.finished', 'run.failed'])
      expect(seen).toEqual(['run.started', 'run.finished'])
    })

    it('creates and resolves decisions', () => {
      const decision = log.createDecision({ title: 'Approve X', body: 'body text' })
      expect(decision.status).toBe('pending')
      const resolved = log.resolveDecision(decision.id, 'approved')
      expect(resolved.status).toBe('approved')
      expect(log.listDecisions({ status: 'approved' })).toHaveLength(1)
    })

    it('sends and reads inbox messages', () => {
      log.sendMessage({ from: 'ops', to: 'librarian', body: 'hello' })
      const inbox = log.readInbox('librarian')
      expect(inbox).toHaveLength(1)
      expect(inbox[0].body).toBe('hello')
    })
  })
  ```

- [ ] **Step 3: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/log/eventLog.test.ts`
  Expected: fails — `Cannot find module './eventLog.js'`.

- [ ] **Step 4: minimal implementation**

  ```sql
  -- packages/kernel/src/log/schema.sql
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

  ```ts
  // packages/kernel/src/log/eventLog.ts
  import Database from 'better-sqlite3'
  import fs from 'node:fs'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { nanoid } from 'nanoid'
  import type {
    Run, RunStatus, Event, EventType, Decision, DecisionStatus, Message,
  } from '@agentos/shared'

  const __dirname = path.dirname(fileURLToPath(import.meta.url))

  function nowIso(): string {
    return new Date().toISOString()
  }

  // biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
  function rowToRun(row: any): Run {
    return {
      id: row.id,
      routine: row.routine,
      skill: row.skill ?? undefined,
      adapter: row.adapter ?? undefined,
      agent: row.agent ?? undefined,
      status: row.status as RunStatus,
      attempt: row.attempt,
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      sessionId: row.session_id ?? undefined,
      pid: row.pid ?? undefined,
      startedAt: row.started_at ?? undefined,
      endedAt: row.ended_at ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      costUsd: row.cost_usd ?? undefined,
      error: row.error ?? undefined,
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
  function rowToEvent(row: any): Event {
    return { id: row.id, ts: row.ts, type: row.type as EventType, runId: row.run_id ?? undefined, payload: JSON.parse(row.payload) }
  }

  // biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
  function rowToDecision(row: any): Decision {
    return {
      id: row.id, title: row.title, body: row.body, adapter: row.adapter ?? undefined, ref: row.ref ?? undefined,
      status: row.status as DecisionStatus, createdByRun: row.created_by_run ?? undefined,
      createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined, error: row.error ?? undefined,
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
  function rowToMessage(row: any): Message {
    return { id: row.id, from: row.from_agent, to: row.to_agent, body: row.body, ts: row.ts, readAt: row.read_at ?? undefined }
  }

  export class EventLog {
    private db: Database.Database
    private subscribers = new Set<(e: Event) => void>()

    constructor(dbPath: string) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      this.db = new Database(dbPath)
      this.db.pragma('journal_mode = WAL')
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
      this.db.exec(schema)
    }

    append(e: Omit<Event, 'id' | 'ts'>): Event {
      const ts = nowIso()
      const info = this.db
        .prepare('INSERT INTO events (ts, type, run_id, payload) VALUES (?, ?, ?, ?)')
        .run(ts, e.type, e.runId ?? null, JSON.stringify(e.payload))
      const event: Event = { id: Number(info.lastInsertRowid), ts, type: e.type, runId: e.runId, payload: e.payload }
      for (const cb of this.subscribers) cb(event)
      return event
    }

    createRun(r: Omit<Run, 'id' | 'status' | 'attempt'> & { attempt?: number }): Run {
      const id = nanoid()
      const attempt = r.attempt ?? 1
      this.db
        .prepare(
          `INSERT INTO runs (id, routine, skill, adapter, agent, status, attempt, payload, session_id, pid, started_at, ended_at, input_tokens, output_tokens, cost_usd, error)
           VALUES (@id, @routine, @skill, @adapter, @agent, 'queued', @attempt, @payload, @sessionId, @pid, @startedAt, @endedAt, @inputTokens, @outputTokens, @costUsd, @error)`
        )
        .run({
          id, routine: r.routine, skill: r.skill ?? null, adapter: r.adapter ?? null, agent: r.agent ?? null,
          attempt, payload: r.payload ? JSON.stringify(r.payload) : null,
          sessionId: r.sessionId ?? null, pid: r.pid ?? null, startedAt: r.startedAt ?? null, endedAt: r.endedAt ?? null,
          inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null, costUsd: r.costUsd ?? null, error: r.error ?? null,
        })
      // biome-ignore lint/style/noNonNullAssertion: just inserted
      return this.getRun(id)!
    }

    updateRun(id: string, patch: Partial<Run>): Run {
      const existing = this.getRun(id)
      if (!existing) throw new Error(`Run not found: ${id}`)
      const merged: Run = { ...existing, ...patch }
      this.db
        .prepare(
          `UPDATE runs SET routine=@routine, skill=@skill, adapter=@adapter, agent=@agent, status=@status, attempt=@attempt,
           payload=@payload, session_id=@sessionId, pid=@pid, started_at=@startedAt, ended_at=@endedAt,
           input_tokens=@inputTokens, output_tokens=@outputTokens, cost_usd=@costUsd, error=@error WHERE id=@id`
        )
        .run({
          id, routine: merged.routine, skill: merged.skill ?? null, adapter: merged.adapter ?? null, agent: merged.agent ?? null,
          status: merged.status, attempt: merged.attempt, payload: merged.payload ? JSON.stringify(merged.payload) : null,
          sessionId: merged.sessionId ?? null, pid: merged.pid ?? null, startedAt: merged.startedAt ?? null, endedAt: merged.endedAt ?? null,
          inputTokens: merged.inputTokens ?? null, outputTokens: merged.outputTokens ?? null, costUsd: merged.costUsd ?? null, error: merged.error ?? null,
        })
      // biome-ignore lint/style/noNonNullAssertion: just updated
      return this.getRun(id)!
    }

    getRun(id: string): Run | undefined {
      const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
      return row ? rowToRun(row) : undefined
    }

    listRuns(opts: { status?: RunStatus; routine?: string; limit?: number } = {}): Run[] {
      let sql = 'SELECT * FROM runs WHERE 1=1'
      const params: unknown[] = []
      if (opts.status) { sql += ' AND status = ?'; params.push(opts.status) }
      if (opts.routine) { sql += ' AND routine = ?'; params.push(opts.routine) }
      sql += ' ORDER BY created_at DESC'
      if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit) }
      return this.db.prepare(sql).all(...params).map(rowToRun)
    }

    listEvents(opts: { runId?: string; sinceId?: number; types?: EventType[]; limit?: number }): Event[] {
      let sql = 'SELECT * FROM events WHERE 1=1'
      const params: unknown[] = []
      if (opts.runId) { sql += ' AND run_id = ?'; params.push(opts.runId) }
      if (opts.sinceId !== undefined) { sql += ' AND id > ?'; params.push(opts.sinceId) }
      if (opts.types && opts.types.length > 0) {
        sql += ` AND type IN (${opts.types.map(() => '?').join(',')})`
        params.push(...opts.types)
      }
      sql += ' ORDER BY id ASC'
      if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit) }
      return this.db.prepare(sql).all(...params).map(rowToEvent)
    }

    createDecision(d: Omit<Decision, 'id' | 'status' | 'createdAt'>): Decision {
      const id = nanoid()
      const createdAt = nowIso()
      this.db
        .prepare(
          `INSERT INTO decisions (id, title, body, adapter, ref, status, created_by_run, created_at, resolved_at, error)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`
        )
        .run(id, d.title, d.body, d.adapter ?? null, d.ref ?? null, d.createdByRun ?? null, createdAt)
      return rowToDecision(this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id))
    }

    resolveDecision(id: string, status: 'approved' | 'rejected' | 'error', error?: string): Decision {
      const resolvedAt = nowIso()
      this.db.prepare('UPDATE decisions SET status = ?, resolved_at = ?, error = ? WHERE id = ?').run(status, resolvedAt, error ?? null, id)
      const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id)
      if (!row) throw new Error(`Decision not found: ${id}`)
      return rowToDecision(row)
    }

    listDecisions(opts: { status?: DecisionStatus } = {}): Decision[] {
      let sql = 'SELECT * FROM decisions WHERE 1=1'
      const params: unknown[] = []
      if (opts.status) { sql += ' AND status = ?'; params.push(opts.status) }
      sql += ' ORDER BY created_at DESC'
      return this.db.prepare(sql).all(...params).map(rowToDecision)
    }

    sendMessage(m: Omit<Message, 'id' | 'ts'>): Message {
      const id = nanoid()
      const ts = nowIso()
      this.db
        .prepare('INSERT INTO messages (id, from_agent, to_agent, body, ts, read_at) VALUES (?, ?, ?, ?, ?, NULL)')
        .run(id, m.from, m.to, m.body, ts)
      return { id, from: m.from, to: m.to, body: m.body, ts }
    }

    readInbox(agent: string, markRead = false): Message[] {
      const rows = this.db.prepare('SELECT * FROM messages WHERE to_agent = ? ORDER BY ts ASC').all(agent)
      const messages = rows.map(rowToMessage)
      if (markRead) {
        this.db.prepare('UPDATE messages SET read_at = ? WHERE to_agent = ? AND read_at IS NULL').run(nowIso(), agent)
      }
      return messages
    }

    subscribe(cb: (e: Event) => void): () => void {
      this.subscribers.add(cb)
      return () => this.subscribers.delete(cb)
    }

    close(): void {
      this.db.close()
    }
  }
  ```

- [ ] **Step 5: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/log/eventLog.test.ts`

- [ ] **Step 6: commit**
  ```
  git add packages/kernel/package.json packages/kernel/src/log
  git commit -m "$(cat <<'EOF'
  feat(kernel): add EventLog over better-sqlite3

  Append-only events table, runs/decisions/messages CRUD, and an
  in-process subscribe() for the future /ws bridge (contract §4, §8).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 5: `packages/kernel` — `process/streamParser.ts`

**Files:** Create: `packages/kernel/src/process/streamParser.ts`. Test: `packages/kernel/src/process/streamParser.test.ts`.
**Interfaces:** Consumes: `ClaudeStreamMessage` from `@agentos/shared`. Produces: `export function parseStreamLine(line: string): ClaudeStreamMessage | null` (contract §4).

`claude -p --output-format stream-json` prints one JSON object per line on stdout. Each line's `type` field is one of `system` (subtype `init`, carries the `session_id` the kernel must remember for `--resume`), `assistant` (a message whose `content` array holds text blocks and `tool_use` blocks), `user` (tool results fed back to the model), or `result` (the terminal message: cost, token usage, and `subtype` telling you whether the turn succeeded). `parseStreamLine` turns one raw line into a typed message, or `null` if the line is blank or not valid JSON (real `claude` occasionally interleaves non-JSON diagnostic output — per spec §9 the run continues and the bad line is simply dropped from typed parsing).

- [ ] **Step 1: failing test**

  ```ts
  // packages/kernel/src/process/streamParser.test.ts
  import { describe, expect, it } from 'vitest'
  import { parseStreamLine } from './streamParser.js'

  describe('parseStreamLine', () => {
    it('returns null for blank lines', () => {
      expect(parseStreamLine('')).toBeNull()
      expect(parseStreamLine('   \n')).toBeNull()
    })

    it('returns null for unparseable JSON', () => {
      expect(parseStreamLine('not json')).toBeNull()
    })

    it('parses a system init message', () => {
      const msg = parseStreamLine('{"type":"system","subtype":"init","session_id":"s1","model":"sonnet"}')
      expect(msg).toEqual({ type: 'system', subtype: 'init', session_id: 's1', model: 'sonnet' })
    })

    it('parses an assistant message with a tool_use block', () => {
      const line = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"x"}}]},"session_id":"s1"}'
      const msg = parseStreamLine(line)
      expect(msg?.type).toBe('assistant')
    })

    it('parses a result message', () => {
      const msg = parseStreamLine('{"type":"result","subtype":"success","session_id":"s1","total_cost_usd":0.01}')
      expect(msg?.type).toBe('result')
    })
  })
  ```

- [ ] **Step 2: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/process/streamParser.test.ts`
  Expected: fails — `Cannot find module './streamParser.js'`.

- [ ] **Step 3: minimal implementation**

  ```ts
  // packages/kernel/src/process/streamParser.ts
  import type { ClaudeStreamMessage } from '@agentos/shared'

  export function parseStreamLine(line: string): ClaudeStreamMessage | null {
    const trimmed = line.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') return null
      return parsed as ClaudeStreamMessage
    } catch {
      return null
    }
  }
  ```

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/process/streamParser.test.ts`

- [ ] **Step 5: commit**
  ```
  git add packages/kernel/src/process/streamParser.ts packages/kernel/src/process/streamParser.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add parseStreamLine for claude -p stream-json output

  Tolerant line parser: blank/unparseable lines return null instead of
  throwing, matching spec §9's "log raw and continue" error handling.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 6: `packages/kernel` — `process/promptAssembler.ts`

**Files:** Create: `packages/kernel/src/process/promptAssembler.ts`. Test: `packages/kernel/src/process/promptAssembler.test.ts`.
**Interfaces:** Consumes: none beyond `node:fs/promises`, `node:path`. Produces: `export interface AssembleInput { osRoot: string; skill: string; agent: string; task?: string; upstreamSkill?: string }`, `export interface AssembledPrompt { prompt: string; systemPromptAppend: string }`, `export function assemblePrompt(i: AssembleInput): Promise<AssembledPrompt>`, `export function wrapUpPrompt(osRoot: string, skill: string): string` (contract §4).

- [ ] **Step 1: failing test**

  ```ts
  // packages/kernel/src/process/promptAssembler.test.ts
  import { describe, expect, it, beforeEach, afterEach } from 'vitest'
  import fs from 'node:fs/promises'
  import fsSync from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  import { assemblePrompt, wrapUpPrompt } from './promptAssembler.js'

  describe('assemblePrompt', () => {
    let osRoot: string

    beforeEach(async () => {
      osRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agentos-prompt-'))
      await fs.writeFile(path.join(osRoot, 'CLAUDE.md'), '# agent-os instance schema')
      await fs.mkdir(path.join(osRoot, 'agents', 'ops'), { recursive: true })
      await fs.writeFile(path.join(osRoot, 'agents', 'ops', 'AGENT.md'), '# ops agent')
      await fs.mkdir(path.join(osRoot, 'skills', 'heartbeat'), { recursive: true })
      await fs.writeFile(path.join(osRoot, 'skills', 'heartbeat', 'skill.md'), '# heartbeat skill')
      await fs.writeFile(path.join(osRoot, 'skills', 'heartbeat', 'learnings.md'), '- learned nothing yet')
    })

    afterEach(() => {
      fsSync.rmSync(osRoot, { recursive: true, force: true })
    })

    it('concatenates schema + agent for the system prompt', async () => {
      const { systemPromptAppend } = await assemblePrompt({ osRoot, skill: 'heartbeat', agent: 'ops' })
      expect(systemPromptAppend).toContain('# agent-os instance schema')
      expect(systemPromptAppend).toContain('# ops agent')
    })

    it('concatenates skill + learnings + task into the user prompt', async () => {
      const { prompt } = await assemblePrompt({ osRoot, skill: 'heartbeat', agent: 'ops', task: 'run now' })
      expect(prompt).toContain('# heartbeat skill')
      expect(prompt).toContain('learned nothing yet')
      expect(prompt).toContain('run now')
    })

    it('includes an upstream handoff when upstreamSkill is set', async () => {
      await fs.mkdir(path.join(osRoot, 'skills', 'lint', 'context'), { recursive: true })
      await fs.writeFile(path.join(osRoot, 'skills', 'lint', 'context', 'handoff.md'), 'lint found 2 issues')
      const { prompt } = await assemblePrompt({ osRoot, skill: 'heartbeat', agent: 'ops', upstreamSkill: 'lint' })
      expect(prompt).toContain('lint found 2 issues')
    })

    it('tolerates missing files', async () => {
      const { prompt, systemPromptAppend } = await assemblePrompt({ osRoot, skill: 'missing-skill', agent: 'missing-agent' })
      expect(typeof prompt).toBe('string')
      expect(typeof systemPromptAppend).toBe('string')
    })
  })

  describe('wrapUpPrompt', () => {
    it('mentions learnings, handoff, remember and eval scoring', () => {
      const text = wrapUpPrompt('/some/os', 'heartbeat')
      expect(text).toContain('learnings.md')
      expect(text).toContain('handoff.md')
      expect(text).toContain('remember')
      expect(text).toContain('eval.json')
    })
  })
  ```

- [ ] **Step 2: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/process/promptAssembler.test.ts`
  Expected: fails — `Cannot find module './promptAssembler.js'`.

- [ ] **Step 3: minimal implementation**

  ```ts
  // packages/kernel/src/process/promptAssembler.ts
  import fs from 'node:fs/promises'
  import path from 'node:path'

  export interface AssembleInput {
    osRoot: string
    skill: string
    agent: string
    task?: string
    upstreamSkill?: string
  }

  export interface AssembledPrompt {
    prompt: string
    systemPromptAppend: string
  }

  async function readIfExists(p: string): Promise<string> {
    try {
      return await fs.readFile(p, 'utf8')
    } catch {
      return ''
    }
  }

  export async function assemblePrompt(i: AssembleInput): Promise<AssembledPrompt> {
    const claudeMd = await readIfExists(path.join(i.osRoot, 'CLAUDE.md'))
    const agentMd = await readIfExists(path.join(i.osRoot, 'agents', i.agent, 'AGENT.md'))
    const systemPromptAppend = [claudeMd, agentMd].filter(Boolean).join('\n\n')

    const skillMd = await readIfExists(path.join(i.osRoot, 'skills', i.skill, 'skill.md'))
    const learningsMd = await readIfExists(path.join(i.osRoot, 'skills', i.skill, 'learnings.md'))
    const parts = [skillMd, learningsMd]
    if (i.upstreamSkill) {
      const handoff = await readIfExists(path.join(i.osRoot, 'skills', i.upstreamSkill, 'context', 'handoff.md'))
      if (handoff) parts.push(handoff)
    }
    if (i.task) parts.push(i.task)
    const prompt = parts.filter(Boolean).join('\n\n')

    return { prompt, systemPromptAppend }
  }

  export function wrapUpPrompt(_osRoot: string, skill: string): string {
    return [
      `Update skills/${skill}/learnings.md with anything worth remembering from this run.`,
      `Write skills/${skill}/context/handoff.md summarizing output for any downstream routine.`,
      'Call the remember syscall for any durable facts.',
      `Score this run against skills/${skill}/eval.json and write skills/${skill}/last-output.md.`,
    ].join('\n')
  }
  ```

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/process/promptAssembler.test.ts`

- [ ] **Step 5: commit**
  ```
  git add packages/kernel/src/process/promptAssembler.ts packages/kernel/src/process/promptAssembler.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add assemblePrompt and wrapUpPrompt

  Builds the system-prompt append (CLAUDE.md + AGENT.md) and user prompt
  (skill.md + learnings.md + optional upstream handoff + task) per spec
  §4.2; wrapUpPrompt is the static instruction text for the M2 wrap-up
  turn (real logic lands with ProcessManager.runToCompletion in M2).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 7: `tools/fake-claude`

**Files:** Create: `tools/fake-claude/bin.js`, `tools/fake-claude/fixtures/init-success.jsonl`, `tools/fake-claude/fixtures/tool-call-then-success.jsonl`, `tools/fake-claude/fixtures/error.jsonl`, `tools/fake-claude/fixtures/wrapup-success.jsonl`. Test: `tools/fake-claude/bin.test.js`. Modify: root `package.json`.
**Interfaces:** Consumes: env `FAKE_CLAUDE_FIXTURE`, `FAKE_CLAUDE_WRAPUP_FIXTURE`, `FAKE_CLAUDE_ARGS_OUT`; argv (looks for `--resume`). Produces: an executable that Task 8's `ProcessManager` spawns in place of the real `claude` binary (contract §9).

`tools/fake-claude` is not a pnpm workspace member (it's outside `packages/*` and `examples/*`), so it has no `package.json` of its own — Node resolves its ESM `import` syntax from the nearest ancestor `package.json`, which is the workspace root's `"type": "module"`.

- [ ] **Step 1: add `execa` to the root workspace for the fixture-replay test**

  Modify root `package.json` `devDependencies`, adding:
  ```json
  "execa": "^9.4.0"
  ```
  Run: `pnpm install`

- [ ] **Step 2: fixtures**

  ```
  # tools/fake-claude/fixtures/init-success.jsonl
  {"type":"system","subtype":"init","session_id":"sess-init-success","model":"claude-haiku-4-5"}
  {"type":"assistant","message":{"content":[{"type":"text","text":"Heartbeat check complete."}]},"session_id":"sess-init-success"}
  {"type":"result","subtype":"success","session_id":"sess-init-success","total_cost_usd":0.0021,"usage":{"input_tokens":120,"output_tokens":40},"result":"Heartbeat check complete."}
  ```

  ```
  # tools/fake-claude/fixtures/tool-call-then-success.jsonl
  {"type":"system","subtype":"init","session_id":"sess-tool-call","model":"claude-sonnet-5"}
  {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"os/wiki/index.md"}}]},"session_id":"sess-tool-call"}
  {"type":"user","message":{"content":[{"type":"tool_result","content":"index.md contents"}]},"session_id":"sess-tool-call"}
  {"type":"assistant","message":{"content":[{"type":"text","text":"Done reading index."}]},"session_id":"sess-tool-call"}
  {"type":"result","subtype":"success","session_id":"sess-tool-call","total_cost_usd":0.0045,"usage":{"input_tokens":300,"output_tokens":80},"result":"Done reading index."}
  ```

  ```
  # tools/fake-claude/fixtures/error.jsonl
  {"type":"system","subtype":"init","session_id":"sess-error","model":"claude-sonnet-5"}
  {"type":"assistant","message":{"content":[{"type":"text","text":"Attempting task..."}]},"session_id":"sess-error"}
  {"type":"result","subtype":"error_during_execution","session_id":"sess-error","is_error":true,"result":"simulated failure"}
  ```

  ```
  # tools/fake-claude/fixtures/wrapup-success.jsonl
  {"type":"system","subtype":"init","session_id":"sess-wrapup","model":"claude-haiku-4-5"}
  {"type":"assistant","message":{"content":[{"type":"text","text":"Updated learnings.md and handoff.md."}]},"session_id":"sess-wrapup"}
  {"type":"result","subtype":"success","session_id":"sess-wrapup","total_cost_usd":0.0012,"usage":{"input_tokens":90,"output_tokens":30},"result":"wrap-up complete"}
  ```

- [ ] **Step 3: failing test**

  ```js
  // tools/fake-claude/bin.test.js
  import { describe, expect, it, beforeEach, afterEach } from 'vitest'
  import { execa } from 'execa'
  import fs from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const binPath = path.resolve(__dirname, 'bin.js')
  const fixturesDir = path.resolve(__dirname, 'fixtures')

  describe('fake-claude bin.js', () => {
    let tmpDir

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('replays the fixture to stdout and exits 0 on success', async () => {
      const result = await execa(process.execPath, [binPath, '-p', '--output-format', 'stream-json'], {
        env: { ...process.env, FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'init-success.jsonl') },
        reject: false,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"session_id":"sess-init-success"')
    })

    it('exits 1 when the fixture reports an error', async () => {
      const result = await execa(process.execPath, [binPath, '-p'], {
        env: { ...process.env, FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'error.jsonl') },
        reject: false,
      })
      expect(result.exitCode).toBe(1)
    })

    it('records argv when FAKE_CLAUDE_ARGS_OUT is set', async () => {
      const argsOut = path.join(tmpDir, 'args.json')
      await execa(process.execPath, [binPath, '-p', '--model', 'haiku'], {
        env: {
          ...process.env,
          FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'init-success.jsonl'),
          FAKE_CLAUDE_ARGS_OUT: argsOut,
        },
        reject: false,
      })
      const recorded = JSON.parse(fs.readFileSync(argsOut, 'utf8'))
      expect(recorded).toEqual(['-p', '--model', 'haiku'])
    })

    it('replays the wrapup fixture when --resume is passed and FAKE_CLAUDE_WRAPUP_FIXTURE is set', async () => {
      const result = await execa(process.execPath, [binPath, '-p', '--resume', 'sess-init-success'], {
        env: {
          ...process.env,
          FAKE_CLAUDE_FIXTURE: path.join(fixturesDir, 'init-success.jsonl'),
          FAKE_CLAUDE_WRAPUP_FIXTURE: path.join(fixturesDir, 'wrapup-success.jsonl'),
        },
        reject: false,
      })
      expect(result.stdout).toContain('"session_id":"sess-wrapup"')
    })
  })
  ```

- [ ] **Step 4: run it, expect failure**
  `pnpm exec vitest run tools/fake-claude/bin.test.js`
  Expected: fails — `bin.js` does not exist (`ENOENT`).

- [ ] **Step 5: minimal implementation**

  ```js
  // tools/fake-claude/bin.js
  #!/usr/bin/env node
  import fs from 'node:fs'

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function main() {
    const argv = process.argv.slice(2)

    if (process.env.FAKE_CLAUDE_ARGS_OUT) {
      fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_OUT, JSON.stringify(argv, null, 2))
    }

    const isResume = argv.includes('--resume')
    const fixturePath =
      isResume && process.env.FAKE_CLAUDE_WRAPUP_FIXTURE
        ? process.env.FAKE_CLAUDE_WRAPUP_FIXTURE
        : process.env.FAKE_CLAUDE_FIXTURE

    if (!fixturePath) {
      process.stderr.write('fake-claude: FAKE_CLAUDE_FIXTURE not set\n')
      process.exit(1)
    }

    const text = fs.readFileSync(fixturePath, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)

    let lastResultSuccess = false
    for (const line of lines) {
      process.stdout.write(`${line}\n`)
      await sleep(10)
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'result') {
          lastResultSuccess = msg.subtype === 'success'
        }
      } catch {
        // mirrors real claude's tolerance of stray non-JSON output (spec §9)
      }
    }

    process.exit(lastResultSuccess ? 0 : 1)
  }

  main()
  ```

- [ ] **Step 6: run tests, expect PASS**
  `pnpm exec vitest run tools/fake-claude/bin.test.js`

- [ ] **Step 7: commit**
  ```
  git add package.json tools/fake-claude
  git commit -m "$(cat <<'EOF'
  test(tools): add fake-claude test double for `claude -p`

  Replays a stream-json fixture line-by-line with a 10ms delay, exits
  0/1 based on the final result.subtype, supports --resume via
  FAKE_CLAUDE_WRAPUP_FIXTURE, and records argv when
  FAKE_CLAUDE_ARGS_OUT is set (contract §9).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 8: `packages/kernel` — `process/processManager.ts`

**Files:** Create: `packages/kernel/src/process/processManager.ts`. Test: `packages/kernel/src/process/processManager.test.ts`. Modify: `packages/kernel/package.json`.
**Interfaces:** Consumes: `EventLog` (Task 4), `parseStreamLine` (Task 5), `KernelConfig` (Task 3), `Run, PermissionMode` from `@agentos/shared`, `tools/fake-claude/bin.js` (Task 7). Produces: `export interface SpawnSpec { prompt: string; systemPromptAppend: string; cwd: string; model: string; permissionMode: PermissionMode; allowedTools: string[]; addDirs: string[]; mcpConfigPath: string; resumeSessionId?: string; timeoutMs: number }`, `export interface RunResult { status: 'success'|'failed'|'killed'; sessionId?: string; costUsd?: number; inputTokens?: number; outputTokens?: number; error?: string; resultText?: string }`, `export class ProcessManager` with `constructor(cfg: KernelConfig, log: EventLog)`, `start(run: Run, spec: SpawnSpec): Promise<RunResult>`, `kill(runId: string): boolean`, `running(): string[]` (contract §4).

- [ ] **Step 1: add `execa` to kernel**

  Modify `packages/kernel/package.json` `dependencies`, adding:
  ```json
  "execa": "^9.4.0"
  ```
  Run: `pnpm install`

- [ ] **Step 2: failing test**

  ```ts
  // packages/kernel/src/process/processManager.test.ts
  import { describe, expect, it, beforeEach, afterEach } from 'vitest'
  import fs from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { EventLog } from '../log/eventLog.js'
  import { loadKernelConfig } from '../config.js'
  import { ProcessManager } from './processManager.js'

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const fakeClaudeBin = path.resolve(__dirname, '../../../../tools/fake-claude/bin.js')
  const fixturesDir = path.resolve(__dirname, '../../../../tools/fake-claude/fixtures')

  describe('ProcessManager', () => {
    let tmpDir: string
    let log: EventLog

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-pm-'))
      log = new EventLog(path.join(tmpDir, 'agentos.db'))
    })

    afterEach(() => {
      log.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
      delete process.env.FAKE_CLAUDE_FIXTURE
      delete process.env.FAKE_CLAUDE_ARGS_OUT
    })

    it('runs a successful session through the fake claude and records events', async () => {
      const cfg = loadKernelConfig(path.join(tmpDir, 'os'), { claudeBin: fakeClaudeBin, dbPath: path.join(tmpDir, 'agentos.db') })
      const pm = new ProcessManager(cfg, log)
      const run = log.createRun({ routine: 'heartbeat', skill: 'heartbeat', agent: 'ops' })

      const argsOutPath = path.join(tmpDir, 'args.json')
      process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'init-success.jsonl')
      process.env.FAKE_CLAUDE_ARGS_OUT = argsOutPath

      const result = await pm.start(run, {
        prompt: 'run the heartbeat',
        systemPromptAppend: 'you are ops',
        cwd: tmpDir,
        model: 'haiku',
        permissionMode: 'plan',
        allowedTools: ['Read', 'Glob'],
        addDirs: [tmpDir],
        mcpConfigPath: path.join(tmpDir, 'mcp.json'),
        timeoutMs: 10_000,
      })

      expect(result.status).toBe('success')
      expect(result.sessionId).toBe('sess-init-success')
      expect(result.costUsd).toBeCloseTo(0.0021)

      const updated = log.getRun(run.id)
      expect(updated?.status).toBe('success')
      expect(updated?.sessionId).toBe('sess-init-success')

      const events = log.listEvents({ runId: run.id })
      expect(events.some((e) => e.type === 'run.started')).toBe(true)
      expect(events.some((e) => e.type === 'run.stream')).toBe(true)
      expect(events.some((e) => e.type === 'run.finished')).toBe(true)

      const recordedArgs = JSON.parse(fs.readFileSync(argsOutPath, 'utf8')) as string[]
      expect(recordedArgs).toContain('--permission-mode')
      expect(recordedArgs).toContain('plan')
      expect(recordedArgs).toContain('--model')
      expect(recordedArgs).toContain('haiku')
    })

    it('marks the run failed when the fake claude reports an error', async () => {
      const cfg = loadKernelConfig(path.join(tmpDir, 'os'), { claudeBin: fakeClaudeBin, dbPath: path.join(tmpDir, 'agentos.db') })
      const pm = new ProcessManager(cfg, log)
      const run = log.createRun({ routine: 'heartbeat', skill: 'heartbeat', agent: 'ops' })

      process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'error.jsonl')

      const result = await pm.start(run, {
        prompt: 'run the heartbeat',
        systemPromptAppend: '',
        cwd: tmpDir,
        model: 'sonnet',
        permissionMode: 'plan',
        allowedTools: [],
        addDirs: [],
        mcpConfigPath: path.join(tmpDir, 'mcp.json'),
        timeoutMs: 10_000,
      })

      expect(result.status).toBe('failed')
      expect(log.getRun(run.id)?.status).toBe('failed')
    })

    it('running() reflects in-flight runs and empties out after completion', async () => {
      const cfg = loadKernelConfig(path.join(tmpDir, 'os'), { claudeBin: fakeClaudeBin, dbPath: path.join(tmpDir, 'agentos.db') })
      const pm = new ProcessManager(cfg, log)
      const run = log.createRun({ routine: 'heartbeat' })
      process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'init-success.jsonl')

      const promise = pm.start(run, {
        prompt: 'x', systemPromptAppend: '', cwd: tmpDir, model: 'haiku', permissionMode: 'plan',
        allowedTools: [], addDirs: [], mcpConfigPath: path.join(tmpDir, 'mcp.json'), timeoutMs: 10_000,
      })
      await promise
      expect(pm.running()).toEqual([])
    })
  })
  ```

- [ ] **Step 3: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/process/processManager.test.ts`
  Expected: fails — `Cannot find module './processManager.js'`.

- [ ] **Step 4: minimal implementation**

  ```ts
  // packages/kernel/src/process/processManager.ts
  import { execa, type ResultPromise } from 'execa'
  import type { Run, PermissionMode } from '@agentos/shared'
  import type { EventLog } from '../log/eventLog.js'
  import type { KernelConfig } from '../config.js'
  import { parseStreamLine } from './streamParser.js'

  export interface SpawnSpec {
    prompt: string
    systemPromptAppend: string
    cwd: string
    model: string
    permissionMode: PermissionMode
    allowedTools: string[]
    addDirs: string[]
    mcpConfigPath: string
    resumeSessionId?: string
    timeoutMs: number
  }

  export interface RunResult {
    status: 'success' | 'failed' | 'killed'
    sessionId?: string
    costUsd?: number
    inputTokens?: number
    outputTokens?: number
    error?: string
    resultText?: string
  }

  function buildArgs(spec: SpawnSpec): string[] {
    const args: string[] = ['-p', '--output-format', 'stream-json', '--include-partial-messages']
    if (spec.systemPromptAppend) args.push('--append-system-prompt', spec.systemPromptAppend)
    args.push('--mcp-config', spec.mcpConfigPath, '--strict-mcp-config')
    args.push('--permission-mode', spec.permissionMode)
    if (spec.allowedTools.length > 0) args.push('--allowedTools', ...spec.allowedTools)
    for (const dir of spec.addDirs) args.push('--add-dir', dir)
    args.push('--model', spec.model)
    if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId)
    return args
  }

  /**
   * fake-claude ships as a plain .js file with no OS-level executable bit or
   * Windows shim, so on any platform we run it via the current Node binary
   * instead of trying to exec it directly. The real `claude` (no .js suffix,
   * resolved via cross-spawn/PATH) is unaffected.
   */
  function resolveCommand(claudeBin: string): { command: string; prefixArgs: string[] } {
    if (claudeBin.endsWith('.js')) {
      return { command: process.execPath, prefixArgs: [claudeBin] }
    }
    return { command: claudeBin, prefixArgs: [] }
  }

  export class ProcessManager {
    private children = new Map<string, ResultPromise>()

    constructor(private cfg: KernelConfig, private log: EventLog) {}

    async start(run: Run, spec: SpawnSpec): Promise<RunResult> {
      const args = buildArgs(spec)
      const { command, prefixArgs } = resolveCommand(this.cfg.claudeBin)

      this.log.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() })
      this.log.append({ type: 'run.started', runId: run.id, payload: { args } })

      const child = execa(command, [...prefixArgs, ...args], {
        cwd: spec.cwd,
        timeout: spec.timeoutMs,
        reject: false,
      })
      this.children.set(run.id, child)
      child.stdin?.write(spec.prompt)
      child.stdin?.end()

      let sessionId: string | undefined
      let costUsd: number | undefined
      let inputTokens: number | undefined
      let outputTokens: number | undefined
      let resultText: string | undefined
      let isError = false

      child.stdout?.setEncoding('utf8')
      let buffer = ''
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const msg = parseStreamLine(line)
          if (!msg) continue
          this.log.append({ type: 'run.stream', runId: run.id, payload: msg as unknown as Record<string, unknown> })
          if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id
          if (msg.type === 'result') {
            sessionId = msg.session_id
            costUsd = msg.total_cost_usd
            inputTokens = msg.usage?.input_tokens
            outputTokens = msg.usage?.output_tokens
            resultText = msg.result
            isError = Boolean(msg.is_error) || msg.subtype !== 'success'
          }
        }
      })

      const result = await child
      this.children.delete(run.id)

      if (result.killed) {
        this.log.append({ type: 'run.killed', runId: run.id, payload: {} })
        this.log.updateRun(run.id, { status: 'killed', endedAt: new Date().toISOString(), sessionId })
        return { status: 'killed', sessionId }
      }

      const status: RunResult['status'] = result.exitCode === 0 && !isError ? 'success' : 'failed'
      const error = status === 'failed' ? (resultText ?? `exit code ${result.exitCode}`) : undefined

      this.log.updateRun(run.id, {
        status, endedAt: new Date().toISOString(), sessionId, costUsd, inputTokens, outputTokens, error,
      })
      this.log.append({
        type: status === 'success' ? 'run.finished' : 'run.failed',
        runId: run.id,
        payload: { status, resultText },
      })

      return { status, sessionId, costUsd, inputTokens, outputTokens, resultText, error }
    }

    kill(runId: string): boolean {
      const child = this.children.get(runId)
      if (!child) return false
      return child.kill()
    }

    running(): string[] {
      return [...this.children.keys()]
    }
  }
  ```

- [ ] **Step 5: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/process/processManager.test.ts`

- [ ] **Step 6: commit**
  ```
  git add packages/kernel/package.json packages/kernel/src/process/processManager.ts packages/kernel/src/process/processManager.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add ProcessManager spawning claude -p

  Builds the exact argv from spec §4.2, streams stdout through
  parseStreamLine into run.stream events, and finalizes the run as
  success/failed/killed with cost/token usage from the terminal
  result message. Runs against tools/fake-claude in tests.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 9: Kernel stubs + `api/server.ts` + `kernel.ts` + `index.ts`

**Files:** Create: `packages/kernel/src/scheduler/scheduler.ts`, `packages/kernel/src/wiki/wikiService.ts`, `packages/kernel/src/adapters/types.ts`, `packages/kernel/src/adapters/adapterHost.ts`, `packages/kernel/src/api/server.ts`, `packages/kernel/src/kernel.ts`, `packages/kernel/src/index.ts`. Test: `packages/kernel/src/api/server.test.ts`. Modify: `packages/kernel/package.json`.
**Interfaces:** Consumes: `EventLog` (Task 4), `ProcessManager`/`SpawnSpec` (Task 8), `assemblePrompt` (Task 6), `KernelConfig`/`loadKernelConfig` (Task 3), `parseRoutinesFile`/`RoutinesFile`/`RoutineConfig` from `@agentos/shared` (Task 2). Produces: `Scheduler`, `WikiService`, `ProjectAdapter`/`AdapterHost` per contract §4/§5 (no-op bodies — see task notes), `export function buildServer(cfg, log, pm): FastifyInstance` (Contract addition), `export interface Kernel { cfg; log; pm; scheduler; wiki; adapters; start(): Promise<void>; stop(): Promise<void> }`, `export function createKernel(cfg: KernelConfig): Kernel` (contract §4).

This task wires the whole kernel together. `Scheduler`, `WikiService`, and `AdapterHost` are implemented here as **minimal no-op stubs** matching their exact contract §4/§5 signatures — no cron/heartbeat logic, no wiki writes, no adapter sync. M3 replaces `scheduler.ts`, M2 replaces `wikiService.ts` (and adds `redact.ts`/`wiki/index.ts`), M4 replaces `adapterHost.ts`. This is called out in every stub's file header comment.

- [ ] **Step 1: add fastify dependencies**

  Modify `packages/kernel/package.json` `dependencies`, adding:
  ```json
  "fastify": "^5.0.0",
  "@fastify/websocket": "^11.0.1"
  ```
  Run: `pnpm install`

- [ ] **Step 2: stub classes (no test — pure wiring, exercised transitively by Step 4's test)**

  ```ts
  // packages/kernel/src/wiki/wikiService.ts
  import type { EventLog } from '../log/eventLog.js'

  export interface WritePageInput {
    path: string
    content: string
    links?: string[]
    runId?: string
    op?: 'ingest' | 'query' | 'lint' | 'decision' | 'note'
  }

  /**
   * M1 stub: wired into the kernel so createKernel() satisfies the Kernel
   * interface, but none of the raw/wiki contract enforcement, secret
   * redaction, or index/log maintenance is implemented yet. All methods are
   * no-ops. M2 (docs/superpowers/plans/2026-09-08-agent-os-m2-wiki-syscalls.md)
   * replaces this file with the real implementation (contract §4).
   */
  export class WikiService {
    constructor(private osRoot: string, private log: EventLog) {}

    async writePage(i: WritePageInput): Promise<{ result: 'created' | 'updated'; path: string }> {
      return { result: 'created', path: i.path }
    }

    async readPage(_path: string): Promise<string> {
      return ''
    }

    async readIndex(): Promise<string> {
      return ''
    }

    async readLog(_limit?: number): Promise<string> {
      return ''
    }

    async listUnindexedRaw(): Promise<string[]> {
      return []
    }

    async appendLog(_op: string, _title: string, _runId?: string): Promise<void> {
      return
    }
  }
  ```

  ```ts
  // packages/kernel/src/scheduler/scheduler.ts
  import type { EventLog } from '../log/eventLog.js'
  import type { KernelConfig } from '../config.js'
  import type { Event, RoutineConfig, RoutinesFile, Run } from '@agentos/shared'

  /**
   * M1 stub: no cron/heartbeat/event-trigger logic yet. load() just stores
   * the parsed routines file so createKernel() type-checks and `agentos up`
   * can start. M3 (docs/superpowers/plans/2026-09-08-agent-os-m3-scheduler-heartbeat.md)
   * replaces this file with real every/cron/on/after/scheduleOnce support.
   */
  export class Scheduler {
    private routinesFile: RoutinesFile | undefined

    constructor(
      private cfg: KernelConfig,
      private log: EventLog,
      private exec: (routine: RoutineConfig, payload?: Record<string, unknown>) => Promise<void>
    ) {}

    load(routines: RoutinesFile): void {
      this.routinesFile = routines
    }

    start(): void {
      // no-op until M3
    }

    stop(): void {
      // no-op until M3
    }

    async runNow(name: string): Promise<string> {
      throw new Error(`Scheduler.runNow('${name}') is not implemented until M3`)
    }

    onEvent(_e: Event): void {
      // no-op until M3
    }

    scheduleOnce(_skill: string, _when: Date): string {
      throw new Error('Scheduler.scheduleOnce is not implemented until M3')
    }

    setEnabled(_name: string, _enabled: boolean): void {
      // no-op until M3
    }

    list(): Array<{ routine: RoutineConfig; nextRun?: string; lastRun?: Run }> {
      return (this.routinesFile?.routines ?? []).map((routine) => ({ routine }))
    }
  }
  ```

  ```ts
  // packages/kernel/src/adapters/types.ts
  import type { KernelConfig } from '../config.js'
  import type { EventLog } from '../log/eventLog.js'
  import type { WikiService } from '../wiki/wikiService.js'
  import type { Decision, EventType, ProjectConfig } from '@agentos/shared'

  export interface AdapterContext {
    cfg: KernelConfig
    log: EventLog
    wiki: WikiService
    project: ProjectConfig
    runId?: string
  }

  export interface SyncResult {
    added: string[]
    changed: string[]
    events: EventType[]
  }

  export interface ProjectAdapter {
    name: string
    sync(ctx: AdapterContext): Promise<SyncResult>
    applyDecision(decision: Decision, ctx: AdapterContext): Promise<void>
  }
  ```

  ```ts
  // packages/kernel/src/adapters/adapterHost.ts
  import type { KernelConfig } from '../config.js'
  import type { EventLog } from '../log/eventLog.js'
  import type { WikiService } from '../wiki/wikiService.js'
  import type { Decision, ProjectConfig } from '@agentos/shared'
  import type { ProjectAdapter, SyncResult } from './types.js'

  /**
   * M1 stub: no project registry is wired up yet (packages/adapters, which
   * owns the real techpulse-coo adapter, is created in M4). loadProjects()
   * and applyDecision() are no-ops so createKernel() type-checks; M4
   * (docs/superpowers/plans/2026-09-08-agent-os-m4-techpulse-adapter.md)
   * replaces this file with real git/frontmatter logic.
   */
  export class AdapterHost {
    constructor(
      private cfg: KernelConfig,
      private log: EventLog,
      private wiki: WikiService,
      private registry: Record<string, ProjectAdapter>
    ) {}

    async loadProjects(): Promise<ProjectConfig[]> {
      return []
    }

    async sync(projectName: string): Promise<SyncResult> {
      throw new Error(`AdapterHost.sync('${projectName}') is not implemented until M4`)
    }

    async applyDecision(_decision: Decision): Promise<void> {
      return
    }
  }
  ```

- [ ] **Step 3: failing test for the runs API**

  ```ts
  // packages/kernel/src/api/server.test.ts
  import { describe, expect, it, beforeEach, afterEach } from 'vitest'
  import fs from 'node:fs'
  import fsp from 'node:fs/promises'
  import os from 'node:os'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { EventLog } from '../log/eventLog.js'
  import { ProcessManager } from '../process/processManager.js'
  import { loadKernelConfig } from '../config.js'
  import { buildServer } from './server.js'
  import type { Kernel } from '../kernel.js'

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const fakeClaudeBin = path.resolve(__dirname, '../../../../tools/fake-claude/bin.js')
  const fixturesDir = path.resolve(__dirname, '../../../../tools/fake-claude/fixtures')

  describe('api/server runs routes', () => {
    let tmpDir: string
    let osRoot: string
    let log: EventLog

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-api-'))
      osRoot = path.join(tmpDir, 'os')
      await fsp.mkdir(path.join(osRoot, 'skills', 'heartbeat'), { recursive: true })
      await fsp.mkdir(path.join(osRoot, 'agents', 'ops'), { recursive: true })
      await fsp.writeFile(path.join(osRoot, 'skills', 'heartbeat', 'skill.md'), '# Heartbeat skill\nCheck routines.')
      await fsp.writeFile(path.join(osRoot, 'agents', 'ops', 'AGENT.md'), '# ops agent')
      await fsp.writeFile(path.join(osRoot, 'CLAUDE.md'), '# agent-os instance schema')
      process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'init-success.jsonl')
      log = new EventLog(path.join(tmpDir, '.agentos', 'agentos.db'))
    })

    afterEach(() => {
      log.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
      delete process.env.FAKE_CLAUDE_FIXTURE
    })

    it('reports health', async () => {
      const cfg = loadKernelConfig(osRoot, { claudeBin: fakeClaudeBin, runtimeDir: path.join(tmpDir, '.agentos'), dbPath: path.join(tmpDir, '.agentos', 'agentos.db') })
      const pm = new ProcessManager(cfg, log)
      const app = buildServer({ cfg, log, pm } as unknown as Kernel)
      const health = await app.inject({ method: 'GET', url: '/api/health' })
      expect(health.json()).toEqual({ ok: true, version: '0.1.0' })
      await app.close()
    })

    it('creates a run over HTTP and lets it complete through the fake claude', async () => {
      const cfg = loadKernelConfig(osRoot, {
        claudeBin: fakeClaudeBin,
        runtimeDir: path.join(tmpDir, '.agentos'),
        dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
      })
      const pm = new ProcessManager(cfg, log)
      const app = buildServer({ cfg, log, pm } as unknown as Kernel)

      const created = await app.inject({ method: 'POST', url: '/api/runs', payload: { skill: 'heartbeat', agent: 'ops' } })
      expect(created.statusCode).toBe(202)
      const { runId } = created.json() as { runId: string }
      expect(runId).toBeTruthy()

      await new Promise((resolve) => setTimeout(resolve, 300))

      const runRes = await app.inject({ method: 'GET', url: `/api/runs/${runId}` })
      expect(runRes.json().status).toBe('success')

      const eventsRes = await app.inject({ method: 'GET', url: `/api/runs/${runId}/events` })
      const events = eventsRes.json() as Array<{ type: string }>
      expect(events.some((e) => e.type === 'run.finished')).toBe(true)

      const listRes = await app.inject({ method: 'GET', url: '/api/runs' })
      expect((listRes.json() as unknown[]).length).toBeGreaterThan(0)

      await app.close()
    })

    it('rejects requests without a skill', async () => {
      const cfg = loadKernelConfig(osRoot, { claudeBin: fakeClaudeBin, runtimeDir: path.join(tmpDir, '.agentos'), dbPath: path.join(tmpDir, '.agentos', 'agentos.db') })
      const pm = new ProcessManager(cfg, log)
      const app = buildServer({ cfg, log, pm } as unknown as Kernel)
      const res = await app.inject({ method: 'POST', url: '/api/runs', payload: {} })
      expect(res.statusCode).toBe(400)
      await app.close()
    })

    it('enforces the bearer token when authToken is set', async () => {
      const cfg = loadKernelConfig(osRoot, {
        claudeBin: fakeClaudeBin, runtimeDir: path.join(tmpDir, '.agentos'), dbPath: path.join(tmpDir, '.agentos', 'agentos.db'),
        authToken: 'secret',
      })
      const pm = new ProcessManager(cfg, log)
      const app = buildServer({ cfg, log, pm } as unknown as Kernel)
      const unauthorized = await app.inject({ method: 'GET', url: '/api/runs' })
      expect(unauthorized.statusCode).toBe(401)
      const authorized = await app.inject({ method: 'GET', url: '/api/runs', headers: { authorization: 'Bearer secret' } })
      expect(authorized.statusCode).toBe(200)
      await app.close()
    })
  })
  ```

- [ ] **Step 4: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/api/server.test.ts`
  Expected: fails — `Cannot find module './server.js'`.

- [ ] **Step 5: minimal implementation — `api/server.ts`**

  ```ts
  // packages/kernel/src/api/server.ts
  import Fastify, { type FastifyInstance } from 'fastify'
  import fastifyWebsocket from '@fastify/websocket'
  import fs from 'node:fs/promises'
  import path from 'node:path'
  import {
    parseRoutinesFile,
    type RoutinesFile,
    type RoutineConfig,
    type ErrorResponse,
    type HealthResponse,
    type CreateRunRequest,
    type CreateRunResponse,
  } from '@agentos/shared'
  import type { Kernel } from '../kernel.js'
  import { assemblePrompt } from '../process/promptAssembler.js'

  const VERSION = '0.1.0'

  const DEFAULT_ROUTINES: RoutinesFile = {
    defaults: {
      model: 'sonnet',
      permission_mode: 'plan',
      allowed_tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      max_attempts: 2,
      timeout_ms: 300_000,
    },
    routines: [],
  }

  async function loadRoutines(osRoot: string): Promise<RoutinesFile> {
    try {
      const text = await fs.readFile(path.join(osRoot, 'routines.yaml'), 'utf8')
      return parseRoutinesFile(text)
    } catch {
      return DEFAULT_ROUTINES
    }
  }

  /**
   * M1 stand-in for M2's process/mcpConfig.ts#writeRunMcpConfig: writes an
   * mcp.json with no servers (there is no SyscallServer yet) so
   * ProcessManager still has a real --mcp-config path to pass to claude -p,
   * at the runtime layout contract §2 specifies (runs/<runId>/mcp.json).
   */
  async function writeStubMcpConfig(runtimeDir: string, runId: string): Promise<string> {
    const dir = path.join(runtimeDir, 'runs', runId)
    await fs.mkdir(dir, { recursive: true })
    const mcpPath = path.join(dir, 'mcp.json')
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: {} }, null, 2))
    return mcpPath
  }

  function findRoutineForSkill(routines: RoutinesFile, skill: string): RoutineConfig | undefined {
    return routines.routines.find((r) => r.skill === skill)
  }

  export function buildServer(kernel: Kernel): FastifyInstance {
    const { cfg, log, pm } = kernel
    const app = Fastify({ logger: { level: cfg.logLevel } })
    app.register(fastifyWebsocket)

    app.addHook('onRequest', async (req, reply) => {
      if (!cfg.authToken) return
      if (req.url === '/api/health') return
      const header = req.headers.authorization
      if (header !== `Bearer ${cfg.authToken}`) {
        reply.code(401).send({ error: 'unauthorized' } satisfies ErrorResponse)
      }
    })

    app.get('/api/health', async (): Promise<HealthResponse> => ({ ok: true, version: VERSION }))

    app.get('/api/runs', async (req) => {
      const q = req.query as { status?: string; routine?: string; limit?: string }
      return log.listRuns({
        // biome-ignore lint/suspicious/noExplicitAny: validated by SQL WHERE, not user-trusted parsing
        status: q.status as any,
        routine: q.routine,
        limit: q.limit ? Number(q.limit) : undefined,
      })
    })

    app.get('/api/runs/:id', async (req, reply) => {
      const { id } = req.params as { id: string }
      const run = log.getRun(id)
      if (!run) return reply.code(404).send({ error: 'run not found' } satisfies ErrorResponse)
      return run
    })

    app.get('/api/runs/:id/events', async (req) => {
      const { id } = req.params as { id: string }
      const q = req.query as { sinceId?: string }
      return log.listEvents({ runId: id, sinceId: q.sinceId ? Number(q.sinceId) : undefined })
    })

    app.post('/api/runs', async (req, reply) => {
      const body = req.body as CreateRunRequest
      if (!body?.skill) return reply.code(400).send({ error: 'skill is required' } satisfies ErrorResponse)

      const routines = await loadRoutines(cfg.osRoot)
      const routine = findRoutineForSkill(routines, body.skill)
      const agent = body.agent ?? routine?.agent ?? 'ops'

      const run = log.createRun({ routine: routine?.name ?? body.skill, skill: body.skill, agent, payload: body.payload })

      const mcpConfigPath = await writeStubMcpConfig(cfg.runtimeDir, run.id)
      const { prompt, systemPromptAppend } = await assemblePrompt({
        osRoot: cfg.osRoot,
        skill: body.skill,
        agent,
        task: body.payload ? JSON.stringify(body.payload) : undefined,
      })
      const workspace = path.join(cfg.osRoot, 'agents', agent, 'workspace')
      await fs.mkdir(workspace, { recursive: true })

      void pm.start(run, {
        prompt,
        systemPromptAppend,
        cwd: workspace,
        model: routine?.model ?? routines.defaults.model,
        permissionMode: routine?.permission_mode ?? routines.defaults.permission_mode,
        allowedTools: routine?.allowed_tools ?? routines.defaults.allowed_tools,
        addDirs: [cfg.osRoot],
        mcpConfigPath,
        timeoutMs: routine?.timeout_ms ?? routines.defaults.timeout_ms,
      })

      return reply.code(202).send({ runId: run.id } satisfies CreateRunResponse)
    })

    app.post('/api/runs/:id/kill', async (req) => {
      const { id } = req.params as { id: string }
      return { ok: pm.kill(id) }
    })

    app.get('/ws', { websocket: true }, (socket) => {
      const unsubscribe = log.subscribe((event) => {
        socket.send(JSON.stringify(event))
      })
      socket.on('close', unsubscribe)
    })

    return app
  }
  ```

- [ ] **Step 6: minimal implementation — `kernel.ts` + `index.ts`**

  ```ts
  // packages/kernel/src/kernel.ts
  import fs from 'node:fs/promises'
  import type { FastifyInstance } from 'fastify'
  import type { KernelConfig } from './config.js'
  import { EventLog } from './log/eventLog.js'
  import { ProcessManager } from './process/processManager.js'
  import { Scheduler } from './scheduler/scheduler.js'
  import { WikiService } from './wiki/wikiService.js'
  import { AdapterHost } from './adapters/adapterHost.js'
  import { buildServer } from './api/server.js'

  export interface Kernel {
    cfg: KernelConfig
    log: EventLog
    pm: ProcessManager
    scheduler: Scheduler
    wiki: WikiService
    adapters: AdapterHost
    start(): Promise<void>
    stop(): Promise<void>
  }

  class KernelImpl implements Kernel {
    log: EventLog
    pm: ProcessManager
    scheduler: Scheduler
    wiki: WikiService
    adapters: AdapterHost
    private server: FastifyInstance | undefined

    constructor(public cfg: KernelConfig) {
      this.log = new EventLog(cfg.dbPath)
      this.pm = new ProcessManager(cfg, this.log)
      this.wiki = new WikiService(cfg.osRoot, this.log)
      this.adapters = new AdapterHost(cfg, this.log, this.wiki, {})
      this.scheduler = new Scheduler(cfg, this.log, async () => {
        // wired for real in M3; unused in M1
      })
    }

    async start(): Promise<void> {
      await fs.mkdir(this.cfg.runtimeDir, { recursive: true })
      this.server = buildServer(this)
      await this.server.listen({ host: this.cfg.host, port: this.cfg.port })
      this.scheduler.start()
    }

    async stop(): Promise<void> {
      this.scheduler.stop()
      await this.server?.close()
      this.log.close()
    }
  }

  export function createKernel(cfg: KernelConfig): Kernel {
    return new KernelImpl(cfg)
  }
  ```

  ```ts
  // packages/kernel/src/index.ts
  export * from './config.js'
  export * from './kernel.js'
  export * from './log/eventLog.js'
  export * from './process/streamParser.js'
  export * from './process/promptAssembler.js'
  export * from './process/processManager.js'
  export * from './scheduler/scheduler.js'
  export * from './wiki/wikiService.js'
  export * from './adapters/types.js'
  export * from './adapters/adapterHost.js'
  export * from './api/server.js'
  ```

- [ ] **Step 7: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/api/server.test.ts`

- [ ] **Step 8: build kernel (needed by the CLI in Task 10)**
  `pnpm --filter @agentos/kernel build`

- [ ] **Step 9: commit**
  ```
  git add packages/kernel/package.json packages/kernel/src
  git commit -m "$(cat <<'EOF'
  feat(kernel): wire createKernel with runs API and no-op Scheduler/WikiService/AdapterHost

  buildServer() exposes /api/health, the runs routes, and /ws over
  Fastify; POST /api/runs assembles the prompt, writes a stub mcp.json,
  and spawns through ProcessManager. Scheduler/WikiService/AdapterHost
  are minimal stubs satisfying their contract §4/§5 signatures — M2/M3/M4
  replace them with real logic.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 10: `packages/cli`

**Files:** Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/client.ts`, `packages/cli/src/commands/up.ts`, `packages/cli/src/commands/ps.ts`, `packages/cli/src/commands/logs.ts`, `packages/cli/src/commands/run.ts`, `packages/cli/src/bin.ts`. Test: `packages/cli/src/commands/ps.test.ts`, `packages/cli/src/commands/logs.test.ts`, `packages/cli/src/commands/run.test.ts`.
**Interfaces:** Consumes: `Run, Event, HealthResponse, CreateRunRequest, CreateRunResponse` from `@agentos/shared`, `loadKernelConfig, createKernel` from `@agentos/kernel`. Produces: `export class ApiClient` (Contract addition — see below), `agentos up|ps|logs|run` commands (contract §7 CLI section).

- [ ] **Step 1: package scaffolding**

  ```json
  // packages/cli/package.json
  {
    "name": "@agentos/cli",
    "version": "0.1.0",
    "type": "module",
    "bin": { "agentos": "./dist/bin.js" },
    "scripts": {
      "build": "tsup src/bin.ts --format esm --dts --out-dir dist",
      "test": "vitest run"
    },
    "dependencies": {
      "@agentos/shared": "workspace:*",
      "@agentos/kernel": "workspace:*",
      "commander": "^12.1.0"
    }
  }
  ```

  ```json
  // packages/cli/tsconfig.json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "include": ["src"]
  }
  ```

  Run: `pnpm install`

- [ ] **Step 2: `client.ts` (no dedicated test — exercised by Task 11's acceptance test and by the fake clients in Step 3-5)**

  ```ts
  // packages/cli/src/client.ts
  import type { Run, Event, HealthResponse, CreateRunRequest, CreateRunResponse } from '@agentos/shared'

  export interface ApiClientOptions {
    baseUrl: string
    token?: string
  }

  export class ApiClient {
    constructor(private opts: ApiClientOptions) {}

    private async request<T>(urlPath: string, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers)
      headers.set('content-type', 'application/json')
      if (this.opts.token) headers.set('authorization', `Bearer ${this.opts.token}`)
      const res = await fetch(`${this.opts.baseUrl}${urlPath}`, { ...init, headers })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`agent-os API ${res.status}: ${body}`)
      }
      return (await res.json()) as T
    }

    health(): Promise<HealthResponse> {
      return this.request('/api/health')
    }

    listRuns(opts: { status?: string; routine?: string; limit?: number } = {}): Promise<Run[]> {
      const params = new URLSearchParams()
      if (opts.status) params.set('status', opts.status)
      if (opts.routine) params.set('routine', opts.routine)
      if (opts.limit) params.set('limit', String(opts.limit))
      const qs = params.toString()
      return this.request(`/api/runs${qs ? `?${qs}` : ''}`)
    }

    getRun(id: string): Promise<Run> {
      return this.request(`/api/runs/${id}`)
    }

    getRunEvents(id: string, sinceId?: number): Promise<Event[]> {
      const qs = sinceId !== undefined ? `?sinceId=${sinceId}` : ''
      return this.request(`/api/runs/${id}/events${qs}`)
    }

    createRun(body: CreateRunRequest): Promise<CreateRunResponse> {
      return this.request('/api/runs', { method: 'POST', body: JSON.stringify(body) })
    }
  }
  ```

- [ ] **Step 3: `ps` command — failing test then implementation**

  ```ts
  // packages/cli/src/commands/ps.test.ts
  import { describe, expect, it, vi, beforeEach } from 'vitest'
  import { ps } from './ps.js'
  import type { ApiClient } from '../client.js'

  function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
    return {
      listRuns: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as ApiClient
  }

  describe('ps', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    it('prints "no runs yet" when there are none', async () => {
      await ps(fakeClient({ listRuns: vi.fn().mockResolvedValue([]) }))
      expect(logSpy).toHaveBeenCalledWith('no runs yet')
    })

    it('prints one line per run', async () => {
      const client = fakeClient({
        listRuns: vi.fn().mockResolvedValue([
          { id: 'r1', routine: 'heartbeat', status: 'success', attempt: 1, agent: 'ops', skill: 'heartbeat' },
        ]),
      })
      await ps(client)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('r1'))
    })
  })
  ```

  Run: `pnpm --filter @agentos/cli test -- src/commands/ps.test.ts`
  Expected: fails — `Cannot find module './ps.js'`.

  ```ts
  // packages/cli/src/commands/ps.ts
  import type { ApiClient } from '../client.js'

  export async function ps(client: ApiClient): Promise<void> {
    const runs = await client.listRuns({ limit: 50 })
    if (runs.length === 0) {
      console.log('no runs yet')
      return
    }
    for (const run of runs) {
      console.log(`${run.id}  ${run.status.padEnd(10)}  ${run.routine}  agent=${run.agent ?? '-'}  skill=${run.skill ?? '-'}`)
    }
  }
  ```

  Run: `pnpm --filter @agentos/cli test -- src/commands/ps.test.ts`
  Expected: PASS.

- [ ] **Step 4: `logs` command — failing test then implementation**

  ```ts
  // packages/cli/src/commands/logs.test.ts
  import { describe, expect, it, vi, beforeEach } from 'vitest'
  import { logs } from './logs.js'
  import type { ApiClient } from '../client.js'

  describe('logs', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    it('prints each event', async () => {
      const client = {
        getRunEvents: vi.fn().mockResolvedValue([
          { id: 1, ts: '2026-09-08T00:00:00.000Z', type: 'run.started', runId: 'r1', payload: {} },
        ]),
      } as unknown as ApiClient
      await logs(client, 'r1')
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('run.started'))
      expect(client.getRunEvents).toHaveBeenCalledWith('r1')
    })
  })
  ```

  Run: `pnpm --filter @agentos/cli test -- src/commands/logs.test.ts`
  Expected: fails — `Cannot find module './logs.js'`.

  ```ts
  // packages/cli/src/commands/logs.ts
  import type { ApiClient } from '../client.js'

  export async function logs(client: ApiClient, runId: string): Promise<void> {
    const events = await client.getRunEvents(runId)
    for (const event of events) {
      console.log(`[${event.ts}] ${event.type} ${JSON.stringify(event.payload)}`)
    }
  }
  ```

  Run: `pnpm --filter @agentos/cli test -- src/commands/logs.test.ts`
  Expected: PASS.

- [ ] **Step 5: `run` command — failing test then implementation**

  ```ts
  // packages/cli/src/commands/run.test.ts
  import { describe, expect, it, vi } from 'vitest'
  import { run } from './run.js'
  import type { ApiClient } from '../client.js'

  describe('run', () => {
    it('creates a run and returns the runId', async () => {
      const client = {
        createRun: vi.fn().mockResolvedValue({ runId: 'run-123' }),
      } as unknown as ApiClient
      const runId = await run(client, { skill: 'heartbeat', agent: 'ops' })
      expect(runId).toBe('run-123')
      expect(client.createRun).toHaveBeenCalledWith({ skill: 'heartbeat', agent: 'ops', payload: undefined })
    })

    it('parses a JSON payload string', async () => {
      const client = { createRun: vi.fn().mockResolvedValue({ runId: 'run-456' }) } as unknown as ApiClient
      await run(client, { skill: 'heartbeat', payload: '{"force":true}' })
      expect(client.createRun).toHaveBeenCalledWith({ skill: 'heartbeat', agent: undefined, payload: { force: true } })
    })
  })
  ```

  Run: `pnpm --filter @agentos/cli test -- src/commands/run.test.ts`
  Expected: fails — `Cannot find module './run.js'`.

  ```ts
  // packages/cli/src/commands/run.ts
  import type { ApiClient } from '../client.js'

  export interface RunOptions {
    skill: string
    agent?: string
    payload?: string
  }

  export async function run(client: ApiClient, opts: RunOptions): Promise<string> {
    const payload = opts.payload ? (JSON.parse(opts.payload) as Record<string, unknown>) : undefined
    const { runId } = await client.createRun({ skill: opts.skill, agent: opts.agent, payload })
    console.log(`started run ${runId}`)
    return runId
  }
  ```

  Run: `pnpm --filter @agentos/cli test -- src/commands/run.test.ts`
  Expected: PASS.

- [ ] **Step 6: `up` command (no dedicated unit test — it starts a real, blocking daemon; verified in Task 11's acceptance test and manually)**

  ```ts
  // packages/cli/src/commands/up.ts
  import { loadKernelConfig, createKernel } from '@agentos/kernel'

  export interface UpOptions {
    root: string
    port?: string
  }

  export async function up(opts: UpOptions): Promise<void> {
    const cfg = loadKernelConfig(opts.root, opts.port ? { port: Number(opts.port) } : undefined)
    const kernel = createKernel(cfg)
    await kernel.start()
    console.log(`agent-os daemon listening on http://${cfg.host}:${cfg.port} (osRoot=${cfg.osRoot})`)

    const shutdown = async () => {
      console.log('agent-os daemon shutting down...')
      await kernel.stop()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
  ```

- [ ] **Step 7: `bin.ts`**

  ```ts
  // packages/cli/src/bin.ts
  #!/usr/bin/env node
  import { Command } from 'commander'
  import { ApiClient } from './client.js'
  import { up } from './commands/up.js'
  import { ps } from './commands/ps.js'
  import { logs } from './commands/logs.js'
  import { run as runCommand } from './commands/run.js'

  const program = new Command()
  program.name('agentos').description('agent-os CLI').version('0.1.0')

  function client(): ApiClient {
    const baseUrl = process.env.AGENTOS_URL ?? `http://127.0.0.1:${process.env.AGENTOS_PORT ?? '4545'}`
    return new ApiClient({ baseUrl, token: process.env.AGENTOS_TOKEN })
  }

  program
    .command('up')
    .description('start the agent-os daemon')
    .requiredOption('--root <path>', 'path to the os/ directory')
    .option('--port <port>', 'HTTP port')
    .action(async (opts) => {
      await up({ root: opts.root, port: opts.port })
    })

  program
    .command('ps')
    .description('list recent runs')
    .action(async () => {
      await ps(client())
    })

  program
    .command('logs <runId>')
    .description('print events for a run')
    .action(async (runId: string) => {
      await logs(client(), runId)
    })

  program
    .command('run <skill>')
    .description('start a run for a skill')
    .option('--agent <agent>', 'agent to run as')
    .option('--payload <json>', 'JSON payload')
    .action(async (skill: string, opts) => {
      await runCommand(client(), { skill, agent: opts.agent, payload: opts.payload })
    })

  program.parseAsync(process.argv)
  ```

- [ ] **Step 8: run all cli tests, expect PASS**
  `pnpm --filter @agentos/cli test`

- [ ] **Step 9: build cli**
  `pnpm --filter @agentos/cli build`

- [ ] **Step 10: commit**
  ```
  git add packages/cli
  git commit -m "$(cat <<'EOF'
  feat(cli): add agentos up/ps/logs/run commands

  ApiClient wraps the runs + health routes; `up` starts the kernel
  in-process and blocks until SIGINT/SIGTERM; `ps`/`logs`/`run` talk to
  a running daemon over HTTP (contract §7 CLI section).

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 11: `examples/os-template` + end-to-end acceptance

**Files:** Create: `examples/os-template/os/CLAUDE.md`, `examples/os-template/os/raw/.gitkeep`, `examples/os-template/os/wiki/index.md`, `examples/os-template/os/wiki/log.md`, `examples/os-template/os/wiki/business-brain.md`, `examples/os-template/os/wiki/{projects,agents,concepts,decisions}/.gitkeep`, `examples/os-template/os/output/{approvals,reports,digests}/.gitkeep`, `examples/os-template/os/skills/heartbeat/skill.md`, `examples/os-template/os/skills/heartbeat/learnings.md`, `examples/os-template/os/skills/heartbeat/eval.json`, `examples/os-template/os/skills/heartbeat/last-output.md`, `examples/os-template/os/skills/heartbeat/context/handoff.md`, `examples/os-template/os/agents/ops/AGENT.md`, `examples/os-template/os/agents/ops/workspace/.gitkeep`, `examples/os-template/os/routines.yaml`. Test: `packages/cli/src/acceptance.e2e.test.ts`.
**Interfaces:** Consumes: `createKernel, loadKernelConfig` (Task 9), `ApiClient` (Task 10), `tools/fake-claude` (Task 7). Produces: nothing new — this is the milestone's acceptance gate.

- [ ] **Step 1: template files**

  ```
  # examples/os-template/os/CLAUDE.md
  # agent-os instance schema
  ```

  ```
  # examples/os-template/os/wiki/index.md
  # Wiki index

  (empty — populated starting M2)
  ```

  ```
  # examples/os-template/os/wiki/log.md
  # Wiki log

  (empty — populated starting M2)
  ```

  ```
  # examples/os-template/os/wiki/business-brain.md
  # Business brain

  (empty — populated starting M2)
  ```

  Create empty `.gitkeep` files at: `examples/os-template/os/raw/.gitkeep`, `examples/os-template/os/wiki/projects/.gitkeep`, `examples/os-template/os/wiki/agents/.gitkeep`, `examples/os-template/os/wiki/concepts/.gitkeep`, `examples/os-template/os/wiki/decisions/.gitkeep`, `examples/os-template/os/output/approvals/.gitkeep`, `examples/os-template/os/output/reports/.gitkeep`, `examples/os-template/os/output/digests/.gitkeep`, `examples/os-template/os/agents/ops/workspace/.gitkeep`.

  ```
  # examples/os-template/os/agents/ops/AGENT.md
  # ops agent

  Operational agent responsible for heartbeat checks and daily digest
  runs in this agent-os instance. Full role definition lands in M3
  (docs/superpowers/plans/2026-09-08-agent-os-m3-scheduler-heartbeat.md).
  ```

  ```
  # examples/os-template/os/skills/heartbeat/skill.md
  # heartbeat skill

  Cheap, frequent check-in. Full step list (raw/ diffing, routine status,
  lint scheduling, log.md entry) lands in M3 per spec §4.5. For M1 this
  file exists so assemblePrompt has real content to read.
  ```

  ```
  # examples/os-template/os/skills/heartbeat/learnings.md
  # heartbeat learnings

  (none yet)
  ```

  ```json
  // examples/os-template/os/skills/heartbeat/eval.json
  { "criteria": [] }
  ```

  ```
  # examples/os-template/os/skills/heartbeat/last-output.md
  # heartbeat last output

  (none yet)
  ```

  ```
  # examples/os-template/os/skills/heartbeat/context/handoff.md
  # heartbeat handoff

  (none yet)
  ```

  ```yaml
  # examples/os-template/os/routines.yaml
  defaults:
    model: sonnet
    permission_mode: plan
    allowed_tools: [Read, Glob, Grep, WebFetch, WebSearch]
    max_attempts: 2
    timeout_ms: 300000

  routines:
    - name: heartbeat
      every: 30m
      skill: heartbeat
      agent: ops
      model: haiku
  ```

- [ ] **Step 2: failing acceptance test**

  ```ts
  // packages/cli/src/acceptance.e2e.test.ts
  import { describe, expect, it, afterEach } from 'vitest'
  import fs from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { createKernel, loadKernelConfig, type Kernel } from '@agentos/kernel'
  import { ApiClient } from './client.js'

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const templateOsRoot = path.resolve(__dirname, '../../../examples/os-template/os')
  const fakeClaudeBin = path.resolve(__dirname, '../../../tools/fake-claude/bin.js')
  const fixturesDir = path.resolve(__dirname, '../../../tools/fake-claude/fixtures')

  function copyDir(src: string, dest: string) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name)
      const to = path.join(dest, entry.name)
      if (entry.isDirectory()) copyDir(from, to)
      else fs.copyFileSync(from, to)
    }
  }

  describe('M1 acceptance: up -> run heartbeat -> logs', () => {
    let tmpRoot: string
    let osRoot: string
    let kernel: Kernel

    afterEach(async () => {
      await kernel?.stop()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
      delete process.env.FAKE_CLAUDE_FIXTURE
    })

    it('starts the daemon, runs heartbeat through the fake claude, and lists its events', async () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-acceptance-'))
      osRoot = path.join(tmpRoot, 'os')
      copyDir(templateOsRoot, osRoot)
      process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'init-success.jsonl')

      const port = 45450 + Math.floor(Math.random() * 500)
      const cfg = loadKernelConfig(osRoot, { claudeBin: fakeClaudeBin, port })
      kernel = createKernel(cfg)
      await kernel.start()

      const client = new ApiClient({ baseUrl: `http://127.0.0.1:${port}` })
      expect(await client.health()).toEqual({ ok: true, version: '0.1.0' })

      const { runId } = await client.createRun({ skill: 'heartbeat', agent: 'ops' })
      expect(runId).toBeTruthy()

      let run = await client.getRun(runId)
      for (let i = 0; i < 20 && run.status !== 'success' && run.status !== 'failed'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        run = await client.getRun(runId)
      }
      expect(run.status).toBe('success')

      const events = await client.getRunEvents(runId)
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining(['run.started', 'run.stream', 'run.finished'])
      )
    })
  })
  ```

- [ ] **Step 3: run it, expect failure**
  `pnpm --filter @agentos/kernel build`
  `pnpm --filter @agentos/cli test -- src/acceptance.e2e.test.ts`
  Expected: fails at this point only if any earlier task's artifact is stale — since Tasks 1-10 are already implemented, this should actually pass once `@agentos/shared` and `@agentos/kernel` are built. If it fails, the failure will point at whichever file is missing or stale; rebuild with `pnpm --filter @agentos/shared build` then `pnpm --filter @agentos/kernel build` and retry.

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/cli test -- src/acceptance.e2e.test.ts`

- [ ] **Step 5: manual verification of the literal CLI binary**

  In one PowerShell terminal:
  ```powershell
  pnpm --filter @agentos/shared build
  pnpm --filter @agentos/kernel build
  pnpm --filter @agentos/cli build
  $env:AGENTOS_CLAUDE_BIN = (Resolve-Path "tools\fake-claude\bin.js").Path
  $env:FAKE_CLAUDE_FIXTURE = (Resolve-Path "tools\fake-claude\fixtures\init-success.jsonl").Path
  node packages\cli\dist\bin.js up --root examples\os-template\os
  ```
  Expected: prints `agent-os daemon listening on http://127.0.0.1:4545 (osRoot=...)` and keeps running.

  In a second PowerShell terminal (same repo root):
  ```powershell
  node packages\cli\dist\bin.js run heartbeat --agent ops
  ```
  Expected: prints `started run <runId>`. Copy that id, then:
  ```powershell
  node packages\cli\dist\bin.js logs <runId>
  node packages\cli\dist\bin.js ps
  ```
  Expected: `logs` prints `run.started`, `run.stream`, and `run.finished` event lines; `ps` shows the run with status `success`. Stop the daemon with Ctrl+C in the first terminal — it should print the shutdown message and exit cleanly.

- [ ] **Step 6: run the full test suite and full build once more**
  `pnpm test`
  `pnpm build`
  Expected: all packages' tests pass; `dist/` exists for `shared`, `kernel`, `cli`.

- [ ] **Step 7: commit**
  ```
  git add examples/os-template packages/cli/src/acceptance.e2e.test.ts
  git commit -m "$(cat <<'EOF'
  feat(examples): add minimal os-template and M1 acceptance test

  examples/os-template/os has the CLAUDE.md placeholder, the ops agent,
  the heartbeat skill, and routines.yaml defaults needed for
  `agentos up` -> `agentos run heartbeat --agent ops` -> `agentos logs`
  to work end to end against the fake claude. The acceptance test
  exercises that exact path through the kernel in-process.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Self-review

**Spec coverage (M1 items from spec §11.1 "shared + kernel core"):**
- `shared` types/schemas — done (Task 2), all 8 contract §3 types + schemas + `parseRoutinesFile`.
- `EventLog` — done (Task 4), full method surface from contract §4 and schema.sql from contract §8, verbatim.
- `ProcessManager` with fake `claude` — done (Tasks 7-8), builds the exact argv from spec §4.2 (`-p --output-format stream-json --include-partial-messages --mcp-config ... --strict-mcp-config --permission-mode ... --allowedTools ... --add-dir ... --model ...`), streams stdout through `parseStreamLine`, finalizes success/failed/killed.
- CLI `up/ps/logs/run` — done (Task 10).
- Runs-only API + `/api/health` + `/ws` — done (Task 9), matches contract §7's runs section exactly; no decisions/routines/wiki/skills/agents/costs/projects/internal routes (correctly deferred to M2-M5).
- `Scheduler`/`WikiService`/`AdapterHost` stubbed with contract-exact signatures, each with an explicit "replaced in M<n>" comment — done (Task 9).
- `examples/os-template` minimal instance — done (Task 11), matches contract §2 layout with only CLAUDE.md/ops agent/heartbeat skill/routines.yaml given real content, everything else as empty placeholders per instructions.
- Milestone-ending acceptance criterion (`agentos up` -> `agentos run heartbeat --agent ops` -> `agentos logs <runId>`) — done as both an automated test (Task 11 Step 2-4) and a manual verification script against the literal built CLI binary (Task 11 Step 5).

**Explicitly out of scope for M1 (per milestone boundary, not omissions):** `syscall/*`, `wiki/redact.ts`, `wiki/index.ts`, `process/mcpConfig.ts` (M2); `scheduler/triggers.ts`, real cron/heartbeat routine execution, `routines` API routes (M3); `packages/adapters`, decisions API/CLI (M4); dashboard (M5); README/CI gitleaks/`agentos init` (M6). `pino` was not added as an explicit dependency — Fastify's built-in logger (backed by pino) covers M1's logging; a standalone pino logger is introduced when a non-HTTP consumer needs it (e.g. Scheduler in M3).

**Placeholder scan:** no "TBD", "TODO", or "similar to Task N" appears in any code block above; every step's implementation is complete, runnable code. The only intentionally-unimplemented bodies are the Task 9 stub classes (`Scheduler`, `WikiService`, `AdapterHost`), which are not placeholders in the forbidden sense — each method has a real, typed, no-op or clearly-erroring body matching its exact contract signature, and each class carries a comment naming the milestone and plan file that replaces it.

**Type-consistency check against the contract:** `KernelConfig`, `loadKernelConfig`, `EventLog`, `ProcessManager`/`SpawnSpec`/`RunResult`, `parseStreamLine`, `assemblePrompt`/`wrapUpPrompt`, `Scheduler`, `WikiService`/`WritePageInput`, `AdapterHost`, `ProjectAdapter`/`AdapterContext`/`SyncResult`, `Kernel`/`createKernel` all match contract §4/§5 signatures verbatim (parameter names differ in a few no-op stub bodies only where the contract itself doesn't name parameters, e.g. `Scheduler.onEvent`). `schema.sql` is copied byte-for-byte from contract §8. Every shared type in contract §3 is reproduced exactly, field-for-field.

## Contract additions

- `packages/shared/src/types/api.ts` (M1 subset only — later milestones append more entries for their own routes):
  ```ts
  export interface HealthResponse { ok: true; version: string }
  export interface ErrorResponse { error: string }
  export interface ListRunsQuery { status?: RunStatus; routine?: string; limit?: number }
  export interface ListRunEventsQuery { sinceId?: number }
  export interface CreateRunRequest { skill: string; agent?: string; payload?: Record<string, unknown> }
  export interface CreateRunResponse { runId: string }
  export interface KillRunResponse { ok: boolean }
  ```
- `packages/kernel/src/api/server.ts`:
  ```ts
  export function buildServer(kernel: Kernel): FastifyInstance   // canonical for M1–M5; body destructures { cfg, log, pm } from kernel; server.ts uses `import type { Kernel } from '../kernel.js'`
  ```
  (the contract names the file and its routes but not an exported factory function; this is needed so tests can build the app without binding a real port).
- `packages/kernel/src/api/server.ts` internal helper (M1-only stand-in for M2's `process/mcpConfig.ts#writeRunMcpConfig`):
  ```ts
  async function writeStubMcpConfig(runtimeDir: string, runId: string): Promise<string>
  ```
  Writes `{ mcpServers: {} }` to `<runtimeDir>/runs/<runId>/mcp.json` (matching the contract §2 runtime layout) and returns the path, so `ProcessManager` has a real `--mcp-config` value before the SyscallServer exists.
- `packages/cli/src/client.ts`:
  ```ts
  export interface ApiClientOptions { baseUrl: string; token?: string }
  export class ApiClient {
    constructor(opts: ApiClientOptions)
    health(): Promise<HealthResponse>
    listRuns(opts?: { status?: string; routine?: string; limit?: number }): Promise<Run[]>
    getRun(id: string): Promise<Run>
    getRunEvents(id: string, sinceId?: number): Promise<Event[]>
    createRun(body: CreateRunRequest): Promise<CreateRunResponse>
  }
  ```
  (the contract says only "client.ts # ApiClient (fetch wrapper for §7)" without naming its constructor or methods).
