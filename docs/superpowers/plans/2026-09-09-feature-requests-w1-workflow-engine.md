# agent-os W1 — Durable Workflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agent-os a durable, replay-based workflow engine (`packages/kernel/src/workflow/`) — the kernel subsystem that a feature request (W3) and future multi-step jobs run on top of. W1 delivers the tables, the engine (steps, retries, sleep, waitForEvent, pause/resume/terminate, replay-on-restart), the `workflow.*` events, the HTTP API, the CLI, and full unit/integration test coverage. No dashboard UI — that is W4.

**Architecture:** `workflow/types.ts` defines the pure authoring surface (`WorkflowDefinition`, `WorkflowContext`, `StepOptions`, `StepRunSpec`) that a definition (e.g. W3's `feature-request`) is written against, plus `WorkflowRuntimeDeps`, the dependency bag threaded through the engine into the context. `workflow/store.ts` is a thin domain facade over `EventLog`'s new `workflows`/`workflow_steps` CRUD, adding name-addressed step lookups and the "delete a failed step so replay retries it fresh" operation the engine needs. `workflow/registry.ts` is a `kind -> WorkflowDefinition` map. `workflow/context.ts` implements the four `step.*` primitives and `emit` as closures over one instance's `WorkflowRuntimeDeps`; every primitive follows the same replay rule — look up the step row by name, return the persisted output if it already succeeded, otherwise do the work (or park by throwing the internal `WorkflowSuspended` signal). `workflow/engine.ts` is the scheduler: it owns the per-instance mutex, the `max_concurrent` queue, the 5-second alarm tick that wakes due `sleeping`/`waiting` instances, the `EventLog` subscription that wakes `waiting` instances on a matching event, and `create`/`pause`/`resume`/`terminate`. Because `run()` is replayed from the top on every (re)invocation rather than resumed mid-stack, a daemon restart is handled the same way as a normal wake-up: `engine.start()` just re-schedules every `running`/`waiting`/`sleeping` instance and replay does the rest — no separate recovery code path.

**Tech Stack:** `better-sqlite3` (existing `EventLog` connection, no new dependency), Vitest with `vi.useFakeTimers()` for backoff/alarm tests, the existing `tools/fake-claude` test double for `step.run`'s `ProcessManager.runToCompletion` integration.

**Spec:** `docs/superpowers/specs/2026-09-09-feature-requests-design.md` (sections 2, 3, 8, 9, 10)
**Contract:** `docs/superpowers/plans/2026-09-08-agent-os-00-contract.md`

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome (single tool) — single quotes, no semicolons, 2-space indent, LF line endings.
- Tests live next to source as `*.test.ts` in `packages/shared/src/`; in `packages/kernel/test/` and `packages/cli/test/` mirroring the existing layout (this repo's kernel/cli packages already keep tests in a sibling `test/` tree, not next to `src/` — this plan follows that existing layout for those two packages and the shared-package convention for `packages/shared/src/schemas.test.ts`).
- No new runtime dependencies (every dependency used below — `better-sqlite3`, `nanoid`, `zod`, `croner` is not touched — is already a pinned dependency of `@agentos/kernel`/`@agentos/shared`/`@agentos/cli` per the contract's §0 dependency list).
- No absolute local paths or secrets anywhere in committed files or plan text.
- Additive SQLite migration: new tables (`workflows`, `workflow_steps`) are added to `log/schema.sql` behind `CREATE TABLE IF NOT EXISTS`, exactly like the existing `schedules`/`run_tokens` tables — this alone is the "migration" for a pre-existing database (no `ALTER TABLE`/`PRAGMA table_info` step is needed for a brand-new table; `EventLog.migrate()`'s `PRAGMA table_info` pattern is reserved for adding a column to an *existing* table, as it already does for `decisions.project`).
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`). Every commit message ends with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## File structure

- `packages/shared/src/types/event.ts` — modify: `EventType` gains a `` `workflow.${string}` `` template member.
- `packages/shared/src/types/routine.ts` — modify: add `WorkflowsConfig` and `RoutinesFile.workflows?`.
- `packages/shared/src/types/workflow.ts` — create: `WorkflowStatus`, `WorkflowInstance`, `WorkflowStepStatus`, `WorkflowStep` (the persisted row shapes, mirroring how `Run`/`Decision` live in shared).
- `packages/shared/src/types/api.ts` — modify: `CreateWorkflowRequest/Response`, `GetWorkflowResponse`, `ListWorkflowsQuery`, `DeliverWorkflowEventRequest`.
- `packages/shared/src/schemas.ts` — modify: `WorkflowStatusSchema`, `WorkflowSchema`, `WorkflowStepStatusSchema`, `WorkflowStepSchema`, `WorkflowsConfigSchema`; extend `EventTypeSchema` and `RoutinesFileSchema`.
- `packages/shared/src/index.ts` — modify: re-export `./types/workflow.js`.
- `packages/shared/src/schemas.test.ts` — modify: add coverage for the above.
- `packages/kernel/src/log/schema.sql` — modify: `workflows`, `workflow_steps` tables + indexes.
- `packages/kernel/src/log/eventLog.ts` — modify: row mappers + 8 CRUD methods for the two new tables.
- `packages/kernel/test/log/eventLog.workflow.test.ts` — create.
- `packages/kernel/test/helpers/fakeEventLog.ts` — modify: mirror the 8 new methods.
- `packages/kernel/src/workflow/types.ts` — create: `StepOptions`, `StepRunSpec`, `WorkflowStepApi`, `WorkflowContext`, `WorkflowDefinition`, `WorkflowRuntimeDeps`.
- `packages/kernel/src/workflow/registry.ts` — create: `WorkflowRegistry`.
- `packages/kernel/src/workflow/store.ts` — create: `WorkflowStore`.
- `packages/kernel/test/workflow/registry.test.ts` — create.
- `packages/kernel/test/workflow/store.test.ts` — create.
- `packages/kernel/src/workflow/context.ts` — create: `WorkflowSuspended`, `createWorkflowContext` (`step.do`/`sleep`/`waitForEvent`/`run`, `checkPause`).
- `packages/kernel/test/workflow/context.test.ts` — create.
- `packages/kernel/src/workflow/engine.ts` — create: `WorkflowEngine` (create/get/list/steps, `start`/`stop`, `onEvent`/`tick`, `pause`/`resume`/`terminate`, per-instance mutex + `max_concurrent` queue).
- `packages/kernel/test/workflow/engine.test.ts` — create.
- `packages/kernel/test/workflow/engine.run.test.ts` — create.
- `packages/kernel/test/workflow/engine.integration.test.ts` — create.
- `packages/kernel/src/api/workflows.ts` — create: `registerWorkflowRoutes`.
- `packages/kernel/src/api/server.ts` — modify: call `registerWorkflowRoutes`.
- `packages/kernel/test/api/workflows.routes.test.ts` — create.
- `packages/kernel/src/kernel.ts` — modify: `Kernel.workflows: WorkflowEngine`, construct/`load`/`start`/`stop`, `createKernel`'s third `workflowDefinitions` param.
- `packages/kernel/test/workflow/kernel.wiring.test.ts` — create.
- `packages/kernel/src/index.ts` — modify: re-export `workflow/types.js`, `workflow/engine.js`.
- `examples/os-template/os/routines.yaml` — modify: add a `workflows: { max_concurrent: 2 }` block.
- `packages/cli/src/client.ts` — modify: `listWorkflows`, `getWorkflow`, `createWorkflow`, `pauseWorkflow`, `resumeWorkflow`, `terminateWorkflow`.
- `packages/cli/src/commands/workflows.ts` — create: `agentos workflows [list|show|pause|resume|terminate]`.
- `packages/cli/src/bin.ts` — modify: register the command.
- `packages/cli/test/workflows.command.test.ts` — create.

### Design decisions not spelled out in the contract (documented here, not new contract surface)

- **Replay via a thrown signal, not a dangling promise.** When `step.sleep`/`step.waitForEvent` determine their step isn't resolved yet, they throw a private `WorkflowSuspended` error rather than returning a promise that never settles. `WorkflowEngine.executeInstance` catches it and returns cleanly (releasing the per-instance mutex) instead of leaking an unresolved `definition.run()` call. A real error from `step.do`/`step.run` (retries exhausted, or a thrown error the definition itself doesn't catch) is a distinct, ordinary `Error` and fails the instance — that distinction is exactly how the engine tells "parked" from "failed".
- **`step.waitForEvent`'s `match` function is never persisted.** It can't be (functions aren't JSON). Instead, on every replay the engine re-invokes `definition.run()` from the top, which re-creates the same `match` closure from source and re-scans `EventLog.listEvents` for events of that type with `ts >= step.startedAt`, applying `match` in-process. This is what makes "replay, not resume" (spec §3.3) work uniformly for `waitForEvent` too, including across a daemon restart.
- **`step.run` has no built-in retry.** Spec §5.2's "one retry of `build` with the failure output injected" is workflow-*definition* logic (the definition calls `step.run` a second time itself, in W3), not an engine feature — `step.run` executes once and caches its result like `step.do` with `retries: 0`.
- **`WorkflowEngine.load(defaults, maxConcurrent?)` mirrors `Scheduler.load(file)`.** `WorkflowEngine`'s constructor takes no defaults; `kernel.ts` calls `workflows.load(routinesFile.defaults, routinesFile.workflows?.max_concurrent)` in `start()`, once `routines.yaml` is actually read — the same two-phase construct-then-load pattern `Scheduler` already uses, for the same reason (the file isn't read yet when the kernel's constructor runs).
- **`resume()` on a `failed` instance resets only the failed step's row** (`WorkflowStore.resetFailedStep`, a `DELETE` of that one row) so replay treats it as never-started; every earlier succeeded step still replays from its cached output. This implements spec §8's "Retry from this step" button.
- **`terminate()` marks the in-flight step `skipped`** (a `WorkflowStepStatus` value otherwise unused by the engine itself) and calls `ProcessManager.kill` on its `run_id` if the current step was a `step.run`. Steps not yet reached have no row and need no marking.
- **`WorkflowContext.id` (the instance's own `workflows.id`) is exposed even though spec §3.2's context listing shows only `{ input, state, step, emit }`.** A definition needs a stable, collision-free key for output paths it writes itself (spec §5.2 steps `brief` and `done` write `output/requests/<id>/proposal.md` and `.../summary.md`); the workflow instance id is the only value that is unique per instance, known before the definition runs, and stable across every replay — `input` is caller-supplied and not guaranteed unique, and threading an id through `input` would make every definition responsible for generating and de-duplicating its own ids. `createWorkflowContext` sets it once from `instance.id` (Task 4) and it is read-only for the lifetime of the context.
- **W3's containment guard is a wiring point into `stepRun`, not something this plan builds.** Spec §5.3 requires that a `step.run` spawn with `cwd` outside `agents/<agent>/workspace` (i.e. into a project clone) only when that workflow's project has `build.enabled: true`, and only at exactly `project.clone`. `stepRun` (`context.ts`, Task 8) is the single place a `StepRunSpec` becomes a `SpawnSpec.cwd`, immediately before `await fs.mkdir(cwd, { recursive: true })` — that is the line a later milestone's guard call is expected to precede. This plan does not add the guard itself (the check needs `ProjectConfig.build`, which is W2/W4 surface); a later plan that adds it should treat `stepRun`'s `cwd` computation as the one call site to gate, not re-derive `cwd` resolution elsewhere.

---

### Task 1: Shared contract additions — `EventType`, `RoutinesFile.workflows`, workflow row types + schemas

**Files:** Modify `packages/shared/src/types/event.ts`, `packages/shared/src/types/routine.ts`, `packages/shared/src/types/api.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/index.ts`, `packages/shared/src/schemas.test.ts`; Create `packages/shared/src/types/workflow.ts`
**Interfaces:**
- Consumes: nothing new (pure additive types).
- Produces: `WorkflowStatus`, `WorkflowInstance`, `WorkflowStepStatus`, `WorkflowStep`, `WorkflowsConfig`, `WorkflowStatusSchema`, `WorkflowSchema`, `WorkflowStepStatusSchema`, `WorkflowStepSchema`, `WorkflowsConfigSchema`, `CreateWorkflowRequest`, `CreateWorkflowResponse`, `GetWorkflowResponse`, `ListWorkflowsQuery`, `DeliverWorkflowEventRequest`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/shared/src/schemas.test.ts -- add these imports and describe blocks
import {
  DecisionSchema,
  EvalCriteriaSchema,
  EventSchema,
  MessageSchema,
  ProjectConfigSchema,
  RoutineConfigSchema,
  RoutinesFileSchema,
  RunSchema,
  WorkflowSchema,
  WorkflowStepSchema,
  parseRoutinesFile,
} from './schemas.js'

describe('EventTypeSchema workflow.* events', () => {
  it('accepts a workflow.* event type', () => {
    expect(() =>
      EventSchema.parse({
        id: 1,
        ts: new Date().toISOString(),
        type: 'workflow.step.started',
        payload: {},
      }),
    ).not.toThrow()
  })
})

describe('WorkflowSchema', () => {
  const base = {
    id: 'wf1',
    kind: 'feature-request',
    title: 'Add dark mode',
    input: {},
    state: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  it('accepts a minimal queued workflow instance', () => {
    expect(() => WorkflowSchema.parse({ ...base, status: 'queued' })).not.toThrow()
  })
  it('rejects an unknown status', () => {
    expect(() => WorkflowSchema.parse({ ...base, status: 'nope' })).toThrow()
  })
})

describe('WorkflowStepSchema', () => {
  it('accepts a minimal succeeded step', () => {
    expect(() =>
      WorkflowStepSchema.parse({
        id: 's1',
        workflowId: 'wf1',
        name: 'brief',
        seq: 1,
        status: 'succeeded',
        attempt: 1,
        startedAt: new Date().toISOString(),
      }),
    ).not.toThrow()
  })
})

describe('RoutinesFileSchema workflows block', () => {
  const yaml = (extra: string) =>
    `defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 1000\nroutines: []\n${extra}`

  it('accepts an optional workflows.max_concurrent', () => {
    const file = parseRoutinesFile(yaml('workflows:\n  max_concurrent: 3\n'))
    expect(file.workflows?.max_concurrent).toBe(3)
  })
  it('is optional -- an absent workflows block parses fine', () => {
    const file = parseRoutinesFile(yaml(''))
    expect(file.workflows).toBeUndefined()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/shared test`
Expected: fails to even compile/run — `WorkflowSchema`/`WorkflowStepSchema` are not exported from `./schemas.js`, and `workflows:` is rejected as an unknown key by the current strict `RoutinesFileSchema` (zod's default `.object()` strips unknown keys rather than throwing, so this specific assertion actually fails on `file.workflows?.max_concurrent` being `undefined`, not on a thrown error — either way, red).
- [ ] **Step 3: Implement**
```ts
// packages/shared/src/types/workflow.ts
export type WorkflowStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'sleeping'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'terminated'

export interface WorkflowInstance {
  id: string
  kind: string
  status: WorkflowStatus
  project?: string
  title: string
  input: Record<string, unknown>
  state: Record<string, unknown>
  currentStep?: string
  wakeAt?: string
  waitEvent?: string
  error?: string
  createdAt: string
  startedAt?: string
  endedAt?: string
  updatedAt: string
}

export type WorkflowStepStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting'
  | 'sleeping'

export interface WorkflowStep {
  id: string
  workflowId: string
  name: string
  seq: number
  status: WorkflowStepStatus
  attempt: number
  runId?: string
  output?: unknown
  error?: string
  startedAt: string
  endedAt?: string
}
```
```ts
// packages/shared/src/types/event.ts -- add one union member to EventType
export type EventType =
  | 'run.queued'
  | 'run.started'
  | 'run.stream'
  | 'run.wrapup'
  | 'run.finished'
  | 'run.failed'
  | 'run.killed'
  | 'raw.added'
  | 'raw.changed'
  | 'proposal.changed'
  | 'decision.created'
  | 'decision.updated'
  | 'decision.resolved'
  | 'message.sent'
  | 'wiki.written'
  | 'schedule.created'
  | 'git.commit'
  | 'git.push'
  | 'ops.alert'
  | 'security.redacted'
  | `custom.${string}`
  | `workflow.${string}`
```
```ts
// packages/shared/src/types/routine.ts -- add WorkflowsConfig and the RoutinesFile field
export interface WorkflowsConfig {
  max_concurrent: number
}

export interface RoutinesFile {
  defaults: RoutineDefaults
  routines: RoutineConfig[]
  workflows?: WorkflowsConfig
}
```
```ts
// packages/shared/src/types/api.ts -- append
import type { WorkflowInstance, WorkflowStatus, WorkflowStep } from './workflow.js'

export interface CreateWorkflowRequest {
  kind: string
  project?: string
  title?: string
  input: Record<string, unknown>
}

export interface CreateWorkflowResponse {
  workflowId: string
}

export interface GetWorkflowResponse {
  workflow: WorkflowInstance
  steps: WorkflowStep[]
}

export interface ListWorkflowsQuery {
  status?: WorkflowStatus
  project?: string
  kind?: string
}

export interface DeliverWorkflowEventRequest {
  type: string
  payload?: Record<string, unknown>
}
```
```ts
// packages/shared/src/schemas.ts -- extend the custom-only regex to accept workflow.* too
export const EventTypeSchema = z.union([
  z.enum(BUILTIN_EVENT_TYPES),
  z
    .string()
    .regex(
      /^(custom|workflow)\..+$/,
      'custom/workflow event types must start with "custom." or "workflow."',
    ),
])
```
```ts
// packages/shared/src/schemas.ts -- append near RoutinesFileSchema
export const WorkflowStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'sleeping',
  'paused',
  'succeeded',
  'failed',
  'terminated',
])

export const WorkflowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: WorkflowStatusSchema,
  project: z.string().optional(),
  title: z.string(),
  input: z.record(z.unknown()),
  state: z.record(z.unknown()),
  currentStep: z.string().optional(),
  wakeAt: z.string().optional(),
  waitEvent: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  updatedAt: z.string(),
})

export const WorkflowStepStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'skipped',
  'waiting',
  'sleeping',
])

export const WorkflowStepSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  name: z.string(),
  seq: z.number().int(),
  status: WorkflowStepStatusSchema,
  attempt: z.number().int(),
  runId: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
})

export const WorkflowsConfigSchema = z.object({
  max_concurrent: z.number().int().positive(),
})
```
```ts
// packages/shared/src/schemas.ts -- RoutinesFileSchema gains the optional field
export const RoutinesFileSchema = z.object({
  defaults: RoutineDefaultsSchema,
  routines: z.array(RoutineConfigSchema),
  workflows: WorkflowsConfigSchema.optional(),
})
```
```ts
// packages/shared/src/index.ts -- add alongside the other type re-exports
export * from './types/workflow.js'
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/shared test`
Expected: `PASS` — all existing schema tests plus the new ones.
- [ ] **Step 5: Commit**
```
git add packages/shared/src/types/workflow.ts packages/shared/src/types/event.ts packages/shared/src/types/routine.ts packages/shared/src/types/api.ts packages/shared/src/schemas.ts packages/shared/src/index.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): add workflow row types, workflow.* event type, and routines.yaml workflows block

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `workflows`/`workflow_steps` SQL tables + `EventLog` CRUD

**Files:** Modify `packages/kernel/src/log/schema.sql`, `packages/kernel/src/log/eventLog.ts`; Create `packages/kernel/test/log/eventLog.workflow.test.ts`
**Interfaces:**
- Consumes: `WorkflowInstance`, `WorkflowStatus`, `WorkflowStep`, `WorkflowStepStatus` from `@agentos/shared`.
- Produces: `EventLog.createWorkflow`, `getWorkflow`, `listWorkflows`, `updateWorkflow`, `createWorkflowStep`, `listWorkflowSteps`, `updateWorkflowStep`, `deleteWorkflowStep`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/log/eventLog.workflow.test.ts
import { describe, expect, it } from 'vitest'
import { EventLog } from '../../src/log/eventLog.js'

describe('EventLog workflow CRUD', () => {
  it('creates, reads, updates, and lists a workflow instance', () => {
    const log = new EventLog(':memory:')
    const wf = log.createWorkflow({
      kind: 'feature-request',
      title: 'Add dark mode',
      input: { title: 'dark mode' },
    })
    expect(wf.status).toBe('queued')
    expect(wf.state).toEqual({})
    expect(wf.input).toEqual({ title: 'dark mode' })

    expect(log.getWorkflow(wf.id)?.id).toBe(wf.id)

    const updated = log.updateWorkflow(wf.id, {
      status: 'running',
      startedAt: '2026-09-09T00:00:00.000Z',
      state: { a: 1 },
    })
    expect(updated.status).toBe('running')
    expect(updated.state).toEqual({ a: 1 })
    expect(updated.updatedAt).not.toBe(wf.updatedAt)

    expect(log.listWorkflows({ status: 'running' }).map((w) => w.id)).toContain(wf.id)
    expect(log.listWorkflows({ status: 'succeeded' })).toEqual([])

    log.close()
  })

  it('creates, updates, and deletes workflow steps ordered by seq', () => {
    const log = new EventLog(':memory:')
    const wf = log.createWorkflow({ kind: 'feature-request', title: 't', input: {} })
    const s2 = log.createWorkflowStep({ workflowId: wf.id, name: 'push-proposal', seq: 2, status: 'running' })
    const s1 = log.createWorkflowStep({ workflowId: wf.id, name: 'brief', seq: 1, status: 'succeeded' })

    expect(log.listWorkflowSteps(wf.id).map((s) => s.name)).toEqual(['brief', 'push-proposal'])

    const updated = log.updateWorkflowStep(s2.id, {
      status: 'succeeded',
      output: { sha: 'abc' },
      endedAt: '2026-09-09T00:00:01.000Z',
    })
    expect(updated.status).toBe('succeeded')
    expect(updated.output).toEqual({ sha: 'abc' })

    log.deleteWorkflowStep(s1.id)
    expect(log.listWorkflowSteps(wf.id).map((s) => s.name)).toEqual(['push-proposal'])

    log.close()
  })

  it('throws for an unknown workflow or step id', () => {
    const log = new EventLog(':memory:')
    expect(() => log.updateWorkflow('nope', { status: 'running' })).toThrow(/Workflow not found/)
    expect(() => log.updateWorkflowStep('nope', { status: 'succeeded' })).toThrow(/Workflow step not found/)
    log.close()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- eventLog.workflow`
Expected: fails — `EventLog` has no `createWorkflow`/etc. methods and the tables don't exist yet.
- [ ] **Step 3: Implement**
```sql
-- packages/kernel/src/log/schema.sql -- append
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
  project TEXT, title TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL,
  current_step TEXT, wake_at TEXT, wait_event TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT, ended_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS workflows_kind ON workflows(kind);
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, name TEXT NOT NULL, seq INTEGER NOT NULL,
  status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, run_id TEXT, output TEXT, error TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT);
CREATE INDEX IF NOT EXISTS workflow_steps_workflow ON workflow_steps(workflow_id);
```
```ts
// packages/kernel/src/log/eventLog.ts -- extend the import list
import type {
  Decision,
  DecisionStatus,
  Event,
  EventType,
  Message,
  Run,
  RunStatus,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
} from '@agentos/shared'
```
```ts
// packages/kernel/src/log/eventLog.ts -- add row mappers near rowToMessage
// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToWorkflow(row: any): WorkflowInstance {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as WorkflowStatus,
    project: row.project ?? undefined,
    title: row.title,
    input: JSON.parse(row.input),
    state: JSON.parse(row.state),
    currentStep: row.current_step ?? undefined,
    wakeAt: row.wake_at ?? undefined,
    waitEvent: row.wait_event ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    updatedAt: row.updated_at,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: raw better-sqlite3 rows
function rowToWorkflowStep(row: any): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    name: row.name,
    seq: row.seq,
    status: row.status as WorkflowStepStatus,
    attempt: row.attempt,
    runId: row.run_id ?? undefined,
    output:
      row.output !== null && row.output !== undefined
        ? JSON.parse(row.output)
        : undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
  }
}
```
```ts
// packages/kernel/src/log/eventLog.ts -- add methods inside the EventLog class, before close()
createWorkflow(w: {
  kind: string
  project?: string
  title: string
  input: Record<string, unknown>
}): WorkflowInstance {
  const id = genId()
  this.db
    .prepare(
      `INSERT INTO workflows (id, kind, status, project, title, input, state)
       VALUES (?, ?, 'queued', ?, ?, ?, '{}')`,
    )
    .run(id, w.kind, w.project ?? null, w.title, JSON.stringify(w.input))
  // biome-ignore lint/style/noNonNullAssertion: just inserted
  return this.getWorkflow(id)!
}

getWorkflow(id: string): WorkflowInstance | undefined {
  const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id)
  return row ? rowToWorkflow(row) : undefined
}

listWorkflows(
  opts: { status?: WorkflowStatus; kind?: string; project?: string } = {},
): WorkflowInstance[] {
  let sql = 'SELECT * FROM workflows WHERE 1=1'
  const params: unknown[] = []
  if (opts.status) {
    sql += ' AND status = ?'
    params.push(opts.status)
  }
  if (opts.kind) {
    sql += ' AND kind = ?'
    params.push(opts.kind)
  }
  if (opts.project) {
    sql += ' AND project = ?'
    params.push(opts.project)
  }
  sql += ' ORDER BY created_at DESC'
  return this.db.prepare(sql).all(...params).map(rowToWorkflow)
}

updateWorkflow(id: string, patch: Partial<WorkflowInstance>): WorkflowInstance {
  const existing = this.getWorkflow(id)
  if (!existing) throw new Error(`Workflow not found: ${id}`)
  const merged: WorkflowInstance = { ...existing, ...patch, updatedAt: nowIso() }
  this.db
    .prepare(
      `UPDATE workflows SET kind=@kind, status=@status, project=@project, title=@title, input=@input, state=@state,
       current_step=@currentStep, wake_at=@wakeAt, wait_event=@waitEvent, error=@error,
       started_at=@startedAt, ended_at=@endedAt, updated_at=@updatedAt WHERE id=@id`,
    )
    .run({
      id,
      kind: merged.kind,
      status: merged.status,
      project: merged.project ?? null,
      title: merged.title,
      input: JSON.stringify(merged.input),
      state: JSON.stringify(merged.state),
      currentStep: merged.currentStep ?? null,
      wakeAt: merged.wakeAt ?? null,
      waitEvent: merged.waitEvent ?? null,
      error: merged.error ?? null,
      startedAt: merged.startedAt ?? null,
      endedAt: merged.endedAt ?? null,
      updatedAt: merged.updatedAt,
    })
  // biome-ignore lint/style/noNonNullAssertion: just updated
  return this.getWorkflow(id)!
}

createWorkflowStep(s: {
  workflowId: string
  name: string
  seq: number
  status: WorkflowStepStatus
  attempt?: number
}): WorkflowStep {
  const id = genId()
  this.db
    .prepare(
      'INSERT INTO workflow_steps (id, workflow_id, name, seq, status, attempt) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, s.workflowId, s.name, s.seq, s.status, s.attempt ?? 1)
  // biome-ignore lint/style/noNonNullAssertion: just inserted
  return this.listWorkflowSteps(s.workflowId).find((row) => row.id === id)!
}

listWorkflowSteps(workflowId: string): WorkflowStep[] {
  return this.db
    .prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY seq ASC')
    .all(workflowId)
    .map(rowToWorkflowStep)
}

updateWorkflowStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep {
  const row = this.db.prepare('SELECT * FROM workflow_steps WHERE id = ?').get(id)
  if (!row) throw new Error(`Workflow step not found: ${id}`)
  const existing = rowToWorkflowStep(row)
  const merged: WorkflowStep = { ...existing, ...patch }
  this.db
    .prepare(
      'UPDATE workflow_steps SET status=@status, attempt=@attempt, run_id=@runId, output=@output, error=@error, ended_at=@endedAt WHERE id=@id',
    )
    .run({
      id,
      status: merged.status,
      attempt: merged.attempt,
      runId: merged.runId ?? null,
      output: merged.output !== undefined ? JSON.stringify(merged.output) : null,
      error: merged.error ?? null,
      endedAt: merged.endedAt ?? null,
    })
  // biome-ignore lint/style/noNonNullAssertion: just updated
  return this.listWorkflowSteps(merged.workflowId).find((r) => r.id === id)!
}

deleteWorkflowStep(id: string): void {
  this.db.prepare('DELETE FROM workflow_steps WHERE id = ?').run(id)
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- eventLog.workflow`
Expected: `PASS` — 3 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/log/schema.sql packages/kernel/src/log/eventLog.ts packages/kernel/test/log/eventLog.workflow.test.ts
git commit -m "feat(kernel): add workflows/workflow_steps tables and EventLog CRUD

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Engine foundations — `types.ts`, `registry.ts`, `store.ts`, `FakeEventLog` extension

**Files:** Create `packages/kernel/src/workflow/types.ts`, `packages/kernel/src/workflow/registry.ts`, `packages/kernel/src/workflow/store.ts`, `packages/kernel/test/workflow/registry.test.ts`, `packages/kernel/test/workflow/store.test.ts`; Modify `packages/kernel/test/helpers/fakeEventLog.ts`
**Interfaces:**
- Consumes: `WorkflowInstance`, `WorkflowStatus`, `WorkflowStep`, `WorkflowStepStatus`, `Event`, `EventType`, `PermissionMode`, `RoutineDefaults` from `@agentos/shared`; `EventLog`, `KernelConfig`, `ProcessManager`, `RunResult`.
- Produces: `StepOptions`, `StepRunSpec`, `WorkflowStepApi`, `WorkflowContext<I>`, `WorkflowDefinition<I>`, `WorkflowRuntimeDeps`, `WorkflowRegistry`, `WorkflowStore`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/registry.test.ts
import { describe, expect, it } from 'vitest'
import { WorkflowRegistry } from '../../src/workflow/registry.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

const fakeDef: WorkflowDefinition<{ title: string }> = {
  kind: 'fake',
  async run(ctx) {
    ctx.state.done = true
  },
}

describe('WorkflowRegistry', () => {
  it('registers and looks up a definition by kind', () => {
    const registry = new WorkflowRegistry()
    registry.register(fakeDef)
    expect(registry.get('fake')).toBe(fakeDef)
    expect(registry.list()).toEqual(['fake'])
  })
  it('rejects a duplicate kind', () => {
    const registry = new WorkflowRegistry()
    registry.register(fakeDef)
    expect(() => registry.register(fakeDef)).toThrow(/already registered/)
  })
  it('get returns undefined for an unknown kind', () => {
    const registry = new WorkflowRegistry()
    expect(registry.get('nope')).toBeUndefined()
  })
})
```
```ts
// packages/kernel/test/workflow/store.test.ts
import { describe, expect, it } from 'vitest'
import { WorkflowStore } from '../../src/workflow/store.js'
import { FakeEventLog } from '../helpers/fakeEventLog.js'

describe('WorkflowStore', () => {
  it('creates an instance and looks up steps by name', () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
    const store = new WorkflowStore(log as any)
    const wf = store.create({ kind: 'feature-request', title: 't', input: {} })
    expect(store.getStep(wf.id, 'brief')).toBeUndefined()
    const step = store.createStep(wf.id, 'brief', 1)
    expect(store.getStep(wf.id, 'brief')?.id).toBe(step.id)
    expect(store.steps(wf.id)).toHaveLength(1)
  })

  it('resetFailedStep deletes a failed step so replay starts it fresh, but leaves a succeeded step alone', () => {
    const log = new FakeEventLog()
    // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
    const store = new WorkflowStore(log as any)
    const wf = store.create({ kind: 'feature-request', title: 't', input: {} })
    const failed = store.createStep(wf.id, 'validate', 1)
    store.updateStep(failed.id, { status: 'failed', error: 'checks failed' })
    const succeeded = store.createStep(wf.id, 'brief', 0)
    store.updateStep(succeeded.id, { status: 'succeeded', output: { ok: true } })

    store.resetFailedStep(wf.id, 'validate')
    store.resetFailedStep(wf.id, 'brief') // no-op: not failed

    expect(store.getStep(wf.id, 'validate')).toBeUndefined()
    expect(store.getStep(wf.id, 'brief')?.status).toBe('succeeded')
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflow/registry workflow/store`
Expected: fails — none of `workflow/{types,registry,store}.ts` exist yet, and `FakeEventLog` has no workflow methods.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/workflow/types.ts
import type { Event, EventType, PermissionMode, RoutineDefaults } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { ProcessManager, RunResult } from '../process/processManager.js'
import type { WorkflowStore } from './store.js'

export interface StepOptions {
  retries?: number
  backoffMs?: number
  timeoutMs?: number
}

export interface StepRunSpec {
  skill: string
  agent: string
  task?: Record<string, unknown>
  cwd?: string
  addDirs?: string[]
  model?: string
  permissionMode?: PermissionMode
  allowedTools?: string[]
  timeoutMs?: number
}

export interface WorkflowStepApi {
  do<T>(name: string, opts: StepOptions, fn: () => Promise<T>): Promise<T>
  sleep(name: string, ms: number): Promise<void>
  waitForEvent<T = Record<string, unknown>>(
    name: string,
    eventType: EventType,
    opts: { match?: (e: Event) => boolean; timeoutMs: number },
  ): Promise<T>
  run(name: string, spec: StepRunSpec): Promise<RunResult>
}

export interface WorkflowContext<I = Record<string, unknown>> {
  /** The workflow instance's own id (the `workflows.id` row) -- stable across every replay, so a definition can key collision-free output paths (e.g. `output/requests/<id>/proposal.md`) off it without threading an id through `input`. */
  readonly id: string
  input: I
  state: Record<string, unknown>
  step: WorkflowStepApi
  emit(type: EventType, payload: Record<string, unknown>): void
}

export interface WorkflowDefinition<I = Record<string, unknown>> {
  kind: string
  run(ctx: WorkflowContext<I>): Promise<void>
}

export interface WorkflowRuntimeDeps {
  cfg: KernelConfig
  log: EventLog
  store: WorkflowStore
  pm: ProcessManager
  defaults: RoutineDefaults
  daemonUrl: string
  onStepEvent: (type: EventType, extra: Record<string, unknown>) => void
}
```
```ts
// packages/kernel/src/workflow/registry.ts
import type { WorkflowDefinition } from './types.js'

export class WorkflowRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: definitions are keyed by kind and used generically; callers narrow via their own input type
  private definitions = new Map<string, WorkflowDefinition<any>>()

  register<I>(def: WorkflowDefinition<I>): void {
    if (this.definitions.has(def.kind)) {
      throw new Error(`workflow kind already registered: ${def.kind}`)
    }
    this.definitions.set(def.kind, def)
  }

  // biome-ignore lint/suspicious/noExplicitAny: see field comment
  get(kind: string): WorkflowDefinition<any> | undefined {
    return this.definitions.get(kind)
  }

  list(): string[] {
    return [...this.definitions.keys()]
  }
}
```
```ts
// packages/kernel/src/workflow/store.ts
import type {
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
} from '@agentos/shared'
import type { EventLog } from '../log/eventLog.js'

/**
 * Thin domain facade over EventLog's raw workflow CRUD: adds the
 * name-addressed step lookups and attempt-reset behaviour the engine needs
 * for replay, without teaching EventLog itself about replay semantics.
 */
export class WorkflowStore {
  constructor(private log: EventLog) {}

  create(i: {
    kind: string
    project?: string
    title: string
    input: Record<string, unknown>
  }): WorkflowInstance {
    return this.log.createWorkflow(i)
  }

  get(id: string): WorkflowInstance | undefined {
    return this.log.getWorkflow(id)
  }

  list(
    opts: { status?: WorkflowStatus; kind?: string; project?: string } = {},
  ): WorkflowInstance[] {
    return this.log.listWorkflows(opts)
  }

  update(id: string, patch: Partial<WorkflowInstance>): WorkflowInstance {
    return this.log.updateWorkflow(id, patch)
  }

  steps(workflowId: string): WorkflowStep[] {
    return this.log.listWorkflowSteps(workflowId)
  }

  getStep(workflowId: string, name: string): WorkflowStep | undefined {
    return this.steps(workflowId).find((s) => s.name === name)
  }

  createStep(
    workflowId: string,
    name: string,
    seq: number,
    status: WorkflowStepStatus = 'running',
  ): WorkflowStep {
    return this.log.createWorkflowStep({ workflowId, name, seq, status })
  }

  updateStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep {
    return this.log.updateWorkflowStep(id, patch)
  }

  /** Deletes a failed step's row so a replay treats it as never-started (fresh attempt 1). */
  resetFailedStep(workflowId: string, name: string): void {
    const step = this.getStep(workflowId, name)
    if (step && step.status === 'failed') this.log.deleteWorkflowStep(step.id)
  }
}
```
```ts
// packages/kernel/test/helpers/fakeEventLog.ts -- add import and fields/methods to FakeEventLog
import type {
  Event,
  Run,
  RunStatus,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
} from '@agentos/shared'

// -- inside class FakeEventLog, alongside `schedules` --
workflows: WorkflowInstance[] = []
workflowSteps: WorkflowStep[] = []

createWorkflow(w: {
  kind: string
  project?: string
  title: string
  input: Record<string, unknown>
}): WorkflowInstance {
  const now = new Date().toISOString()
  const wf: WorkflowInstance = {
    id: `wf-${++this.seq}`,
    kind: w.kind,
    status: 'queued',
    project: w.project,
    title: w.title,
    input: w.input,
    state: {},
    createdAt: now,
    updatedAt: now,
  }
  this.workflows.push(wf)
  return wf
}
getWorkflow(id: string): WorkflowInstance | undefined {
  return this.workflows.find((w) => w.id === id)
}
listWorkflows(
  opts: { status?: WorkflowStatus; kind?: string; project?: string } = {},
): WorkflowInstance[] {
  return this.workflows.filter(
    (w) =>
      (!opts.status || w.status === opts.status) &&
      (!opts.kind || w.kind === opts.kind) &&
      (!opts.project || w.project === opts.project),
  )
}
updateWorkflow(id: string, patch: Partial<WorkflowInstance>): WorkflowInstance {
  const wf = this.workflows.find((w) => w.id === id)
  if (!wf) throw new Error(`no workflow ${id}`)
  Object.assign(wf, patch, { updatedAt: new Date().toISOString() })
  return wf
}
createWorkflowStep(s: {
  workflowId: string
  name: string
  seq: number
  status: WorkflowStepStatus
  attempt?: number
}): WorkflowStep {
  const step: WorkflowStep = {
    id: `wfs-${++this.seq}`,
    workflowId: s.workflowId,
    name: s.name,
    seq: s.seq,
    status: s.status,
    attempt: s.attempt ?? 1,
    startedAt: new Date().toISOString(),
  }
  this.workflowSteps.push(step)
  return step
}
listWorkflowSteps(workflowId: string): WorkflowStep[] {
  return this.workflowSteps
    .filter((s) => s.workflowId === workflowId)
    .slice()
    .sort((a, b) => a.seq - b.seq)
}
updateWorkflowStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep {
  const step = this.workflowSteps.find((s) => s.id === id)
  if (!step) throw new Error(`no workflow step ${id}`)
  Object.assign(step, patch)
  return step
}
deleteWorkflowStep(id: string): void {
  this.workflowSteps = this.workflowSteps.filter((s) => s.id !== id)
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflow/registry workflow/store`
Expected: `PASS` — 5 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/types.ts packages/kernel/src/workflow/registry.ts packages/kernel/src/workflow/store.ts packages/kernel/test/workflow/registry.test.ts packages/kernel/test/workflow/store.test.ts packages/kernel/test/helpers/fakeEventLog.ts
git commit -m "feat(kernel): add workflow definition types, registry, and store

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `context.ts` — `step.do` (execute, replay, retry with exponential backoff, timeout)

**Files:** Create `packages/kernel/src/workflow/context.ts`, `packages/kernel/test/workflow/context.test.ts`
**Interfaces:** Consumes `WorkflowRuntimeDeps`, `StepOptions`, `StepRunSpec`, `WorkflowContext` from `./types.js`; `WorkflowInstance` from `@agentos/shared`; `RunResult` from `../process/processManager.js`. Produces `WorkflowSuspended`, `createWorkflowContext<I>(deps, instance): WorkflowContext<I>` with a working `step.do` (`step.sleep`/`step.waitForEvent`/`step.run` still stub).

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/context.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkflowContext } from '../../src/workflow/context.js'
import { WorkflowStore } from '../../src/workflow/store.js'
import { FakeEventLog } from '../helpers/fakeEventLog.js'
import type { KernelConfig } from '../../src/config.js'

const cfg = {
  osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude',
  host: '127.0.0.1', port: 4545, logLevel: 'info',
} as KernelConfig
const defaults = { model: 'sonnet', permission_mode: 'plan' as const, allowed_tools: [], max_attempts: 2, timeout_ms: 60_000 }

function makeDeps(log: FakeEventLog) {
  // biome-ignore lint/suspicious/noExplicitAny: FakeEventLog is a structural EventLog double
  const store = new WorkflowStore(log as any)
  const onStepEvent = vi.fn()
  return {
    // biome-ignore lint/suspicious/noExplicitAny: not exercised by step.do
    deps: { cfg, log: log as any, store, pm: {} as any, defaults, daemonUrl: 'http://127.0.0.1:4545', onStepEvent },
    store,
    onStepEvent,
  }
}

describe('createWorkflowContext: step.do', () => {
  it('executes a step once and persists its output', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    expect(ctx.id).toBe(instance.id)
    const fn = vi.fn().mockResolvedValue({ ok: true })

    const result = await ctx.step.do('brief', {}, fn)

    expect(result).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.getStep(instance.id, 'brief')?.status).toBe('succeeded')
    expect(ctx.state.brief).toEqual({ ok: true })
  })

  it('replay: a second context for the same instance returns the persisted output without re-running fn', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const fn = vi.fn().mockResolvedValue('first')
    await createWorkflowContext(deps, instance).step.do('brief', {}, fn)

    // biome-ignore lint/style/noNonNullAssertion: just created above
    const replayCtx = createWorkflowContext(deps, store.get(instance.id)!)
    const replayFn = vi.fn().mockResolvedValue('second')
    const result = await replayCtx.step.do('brief', {}, replayFn)

    expect(result).toBe('first')
    expect(replayFn).not.toHaveBeenCalled()
  })

  it('retries with exponential backoff from backoffMs, then succeeds', async () => {
    vi.useFakeTimers()
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')

    const promise = ctx.step.do('brief', { retries: 2, backoffMs: 1000 }, fn)
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.getStep(instance.id, 'brief')?.attempt).toBe(2)
    vi.useRealTimers()
  })

  it('fails the step and throws once retries are exhausted', async () => {
    vi.useFakeTimers()
    const log = new FakeEventLog()
    const { deps, store, onStepEvent } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))

    const promise = ctx.step.do('brief', { retries: 1, backoffMs: 500 }, fn)
    const assertion = expect(promise).rejects.toThrow('always fails')
    await vi.advanceTimersByTimeAsync(500)
    await assertion

    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.getStep(instance.id, 'brief')?.status).toBe('failed')
    expect(onStepEvent).toHaveBeenCalledWith(
      'workflow.step.failed',
      expect.objectContaining({ step: 'brief', error: 'always fails' }),
    )
    vi.useRealTimers()
  })

  it('applies opts.timeoutMs to fn', async () => {
    const log = new FakeEventLog()
    const { deps } = makeDeps(log)
    const instance = deps.store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)
    const neverResolves = () => new Promise<never>(() => {})

    await expect(
      ctx.step.do('brief', { retries: 0, timeoutMs: 20 }, neverResolves),
    ).rejects.toThrow(/timed out/)
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflow/context`
Expected: fails — `context.ts` does not exist.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/workflow/context.ts
import type { Event, EventType } from '@agentos/shared'
import type { WorkflowInstance } from '@agentos/shared'
import type { RunResult } from '../process/processManager.js'
import type {
  StepOptions,
  StepRunSpec,
  WorkflowContext,
  WorkflowRuntimeDeps,
} from './types.js'

export class WorkflowSuspended extends Error {
  constructor() {
    super('workflow suspended')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`step timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    // biome-ignore lint/style/noNonNullAssertion: assigned synchronously above
    clearTimeout(handle!)
  }
}

export function createWorkflowContext<I = Record<string, unknown>>(
  deps: WorkflowRuntimeDeps,
  instance: WorkflowInstance,
): WorkflowContext<I> {
  let seq = 0
  const state: Record<string, unknown> = { ...instance.state }

  async function stepDo<T>(
    name: string,
    opts: StepOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    seq += 1
    const mySeq = seq
    let row = deps.store.getStep(instance.id, name)
    if (row?.status === 'succeeded') return row.output as T
    if (!row) {
      row = deps.store.createStep(instance.id, name, mySeq)
      deps.store.update(instance.id, { currentStep: name })
      deps.onStepEvent('workflow.step.started', { step: name, seq: mySeq })
    }
    const maxAttempts = 1 + (opts.retries ?? 2)
    const backoffMs = opts.backoffMs ?? 10_000
    let lastErr: unknown
    for (let attempt = row.attempt; attempt <= maxAttempts; attempt++) {
      try {
        const result = opts.timeoutMs ? await withTimeout(fn(), opts.timeoutMs) : await fn()
        deps.store.updateStep(row.id, {
          status: 'succeeded',
          output: result,
          endedAt: new Date().toISOString(),
        })
        state[name] = result
        deps.store.update(instance.id, { state })
        deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
        return result
      } catch (err) {
        lastErr = err
        if (attempt < maxAttempts) {
          deps.store.updateStep(row.id, { attempt: attempt + 1 })
          await sleep(backoffMs * 2 ** (attempt - 1))
        }
      }
    }
    const errorMsg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    deps.store.updateStep(row.id, {
      status: 'failed',
      error: errorMsg,
      endedAt: new Date().toISOString(),
    })
    deps.onStepEvent('workflow.step.failed', { step: name, seq: mySeq, error: errorMsg })
    throw lastErr instanceof Error ? lastErr : new Error(errorMsg)
  }

  async function stepSleep(_name: string, _ms: number): Promise<void> {
    throw new Error('not implemented until Task 5')
  }

  async function stepWaitForEvent<T>(
    _name: string,
    _eventType: EventType,
    _opts: { match?: (e: Event) => boolean; timeoutMs: number },
  ): Promise<T> {
    throw new Error('not implemented until Task 5')
  }

  async function stepRun(_name: string, _spec: StepRunSpec): Promise<RunResult> {
    throw new Error('not implemented until Task 7')
  }

  return {
    id: instance.id,
    input: instance.input as I,
    state,
    step: { do: stepDo, sleep: stepSleep, waitForEvent: stepWaitForEvent, run: stepRun },
    emit: (type, payload) => deps.onStepEvent(type, payload),
  }
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflow/context`
Expected: `PASS` — 5 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/context.ts packages/kernel/test/workflow/context.test.ts
git commit -m "feat(kernel): add workflow step.do with replay, exponential backoff, and timeout

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `context.ts` — `step.sleep` and `step.waitForEvent`

**Files:** Modify `packages/kernel/src/workflow/context.ts`, `packages/kernel/test/workflow/context.test.ts`
**Interfaces:** Fills in the two remaining stubs from Task 4; introduces `WorkflowSuspended` as the actual parking signal for both.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/context.test.ts -- add these describe blocks and import WorkflowSuspended
import { createWorkflowContext, WorkflowSuspended } from '../../src/workflow/context.js'

describe('createWorkflowContext: step.sleep', () => {
  it('suspends on first call and sets the instance to sleeping with a wakeAt', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)

    await expect(ctx.step.sleep('cooldown', 5000)).rejects.toBeInstanceOf(WorkflowSuspended)

    const updated = store.get(instance.id)
    expect(updated?.status).toBe('sleeping')
    expect(updated?.currentStep).toBe('cooldown')
    expect(updated?.wakeAt).toBeDefined()
    expect(store.getStep(instance.id, 'cooldown')?.status).toBe('sleeping')
  })

  it('re-suspends on replay before wakeAt, and resolves once wakeAt has passed', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    await createWorkflowContext(deps, instance).step.sleep('cooldown', 50).catch(() => {})

    // biome-ignore lint/style/noNonNullAssertion: created above
    const tooSoon = createWorkflowContext(deps, store.get(instance.id)!)
    await expect(tooSoon.step.sleep('cooldown', 50)).rejects.toBeInstanceOf(WorkflowSuspended)

    await new Promise((r) => setTimeout(r, 60))
    // biome-ignore lint/style/noNonNullAssertion: created above
    const dueCtx = createWorkflowContext(deps, store.get(instance.id)!)
    await expect(dueCtx.step.sleep('cooldown', 50)).resolves.toBeUndefined()
    expect(store.getStep(instance.id, 'cooldown')?.status).toBe('succeeded')
  })
})

describe('createWorkflowContext: step.waitForEvent', () => {
  it('suspends and records wait_event on the instance', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    const ctx = createWorkflowContext(deps, instance)

    await expect(
      ctx.step.waitForEvent('await-approval', 'decision.resolved', { timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(WorkflowSuspended)

    const updated = store.get(instance.id)
    expect(updated?.status).toBe('waiting')
    expect(updated?.waitEvent).toBe('decision.resolved')
  })

  it('resolves with the matching event payload once one arrives, applying opts.match', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    await createWorkflowContext(deps, instance)
      .step.waitForEvent('await-approval', 'decision.resolved', { timeoutMs: 60_000 })
      .catch(() => {})

    log.append({ type: 'decision.resolved', payload: { id: 'other-decision' } })
    log.append({ type: 'decision.resolved', payload: { id: 'd1', ref: '001-slug.md' } })

    // biome-ignore lint/style/noNonNullAssertion: created above
    const replay = createWorkflowContext(deps, store.get(instance.id)!)
    const result = await replay.step.waitForEvent('await-approval', 'decision.resolved', {
      timeoutMs: 60_000,
      match: (e) => (e.payload as { ref?: string }).ref === '001-slug.md',
    })

    expect(result).toEqual({ id: 'd1', ref: '001-slug.md' })
    expect(store.getStep(instance.id, 'await-approval')?.status).toBe('succeeded')
  })

  it('fails the step with a timeout error once wakeAt has passed with no match', async () => {
    const log = new FakeEventLog()
    const { deps, store } = makeDeps(log)
    const instance = store.create({ kind: 'fake', title: 't', input: {} })
    await createWorkflowContext(deps, instance)
      .step.waitForEvent('await-approval', 'decision.resolved', { timeoutMs: 30 })
      .catch(() => {})

    await new Promise((r) => setTimeout(r, 40))
    // biome-ignore lint/style/noNonNullAssertion: created above
    const replay = createWorkflowContext(deps, store.get(instance.id)!)

    await expect(
      replay.step.waitForEvent('await-approval', 'decision.resolved', { timeoutMs: 30 }),
    ).rejects.toThrow(/timed out/)
    expect(store.getStep(instance.id, 'await-approval')?.status).toBe('failed')
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflow/context`
Expected: `step.do` tests still pass; the new `sleep`/`waitForEvent` tests fail with `Error: not implemented until Task 5`.
- [ ] **Step 3: Implement — replace the two stubs in `context.ts`**
```ts
// packages/kernel/src/workflow/context.ts -- replace stepSleep and stepWaitForEvent
async function stepSleep(name: string, ms: number): Promise<void> {
  seq += 1
  const mySeq = seq
  const row = deps.store.getStep(instance.id, name)
  if (row?.status === 'succeeded') return
  if (!row) {
    const wakeAt = new Date(Date.now() + ms).toISOString()
    deps.store.createStep(instance.id, name, mySeq, 'sleeping')
    deps.store.update(instance.id, {
      status: 'sleeping',
      currentStep: name,
      wakeAt,
      waitEvent: undefined,
    })
    deps.onStepEvent('workflow.waiting', { step: name, seq: mySeq, mode: 'sleep', wakeAt })
    throw new WorkflowSuspended()
  }
  const current = deps.store.get(instance.id)
  if (current?.wakeAt && Date.now() < new Date(current.wakeAt).getTime()) {
    throw new WorkflowSuspended()
  }
  deps.store.updateStep(row.id, { status: 'succeeded', endedAt: new Date().toISOString() })
  deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
}

async function stepWaitForEvent<T>(
  name: string,
  eventType: EventType,
  opts: { match?: (e: Event) => boolean; timeoutMs: number },
): Promise<T> {
  seq += 1
  const mySeq = seq
  let row = deps.store.getStep(instance.id, name)
  if (row?.status === 'succeeded') return row.output as T
  if (!row) {
    const wakeAt = new Date(Date.now() + opts.timeoutMs).toISOString()
    row = deps.store.createStep(instance.id, name, mySeq, 'waiting')
    deps.store.update(instance.id, {
      status: 'waiting',
      currentStep: name,
      wakeAt,
      waitEvent: eventType,
    })
    deps.onStepEvent('workflow.waiting', { step: name, seq: mySeq, mode: 'event', eventType, wakeAt })
  }
  const since = row.startedAt
  const matches = deps.log
    .listEvents({ types: [eventType] })
    .filter((e) => e.ts >= since && (!opts.match || opts.match(e)))
  const match = matches[0]
  if (match) {
    deps.store.updateStep(row.id, {
      status: 'succeeded',
      output: match.payload,
      endedAt: new Date().toISOString(),
    })
    state[name] = match.payload
    deps.store.update(instance.id, { state })
    deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
    return match.payload as T
  }
  const current = deps.store.get(instance.id)
  if (current?.wakeAt && Date.now() >= new Date(current.wakeAt).getTime()) {
    deps.store.updateStep(row.id, {
      status: 'failed',
      error: 'timeout',
      endedAt: new Date().toISOString(),
    })
    deps.onStepEvent('workflow.step.failed', { step: name, seq: mySeq, error: 'timeout' })
    throw new Error(`workflow step '${name}' timed out waiting for ${eventType}`)
  }
  throw new WorkflowSuspended()
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflow/context`
Expected: `PASS` — 10 tests total.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/context.ts packages/kernel/test/workflow/context.test.ts
git commit -m "feat(kernel): add workflow step.sleep and step.waitForEvent with replay-based matching

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `WorkflowEngine` core — create/get/list/executeInstance

**Files:** Create `packages/kernel/src/workflow/engine.ts`, `packages/kernel/test/workflow/engine.test.ts`
**Interfaces:** Consumes `createWorkflowContext`, `WorkflowSuspended` from `./context.js`; `WorkflowRegistry`, `WorkflowStore`. Produces `class WorkflowEngine { registry; constructor(cfg, log, pm); load(defaults, maxConcurrent?); create(kind, input, opts?); get(id); list(opts?); steps(id) }` (no `start`/`stop`/`pause`/`resume`/`terminate` yet).

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/engine.test.ts
import { describe, expect, it } from 'vitest'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'
import type { KernelConfig } from '../../src/config.js'

const cfg = {
  osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'claude',
  host: '127.0.0.1', port: 4545, logLevel: 'info',
} as KernelConfig

function makeEngine() {
  const log = new EventLog(':memory:')
  const pm = new ProcessManager(cfg, log)
  const engine = new WorkflowEngine(cfg, log, pm)
  return { engine, log, pm }
}

describe('WorkflowEngine core', () => {
  it('create() rejects an unregistered kind', async () => {
    const { engine } = makeEngine()
    await expect(engine.create('nope', {})).rejects.toThrow(/unknown workflow kind/)
  })

  it('runs a fake definition to completion and emits workflow.created/succeeded', async () => {
    const { engine, log } = makeEngine()
    const fakeDef: WorkflowDefinition<{ title: string }> = {
      kind: 'fake',
      async run(ctx) {
        const brief = await ctx.step.do('brief', {}, async () => ({ slug: 'my-feature' }))
        ctx.state.slug = (brief as { slug: string }).slug
      },
    }
    engine.registry.register(fakeDef)

    const instance = await engine.create('fake', { title: 'Add dark mode' })
    await new Promise((r) => setTimeout(r, 20))

    const final = engine.get(instance.id)
    expect(final?.status).toBe('succeeded')
    expect(final?.state.slug).toBe('my-feature')
    const types = log.listEvents({}).map((e) => e.type)
    expect(types).toContain('workflow.created')
    expect(types).toContain('workflow.step.succeeded')
    expect(types).toContain('workflow.succeeded')
  })

  it('fails the instance and emits workflow.failed when a step exhausts retries', async () => {
    const { engine } = makeEngine()
    const failingDef: WorkflowDefinition = {
      kind: 'failing',
      async run(ctx) {
        await ctx.step.do('boom', { retries: 0 }, async () => {
          throw new Error('nope')
        })
      },
    }
    engine.registry.register(failingDef)

    const instance = await engine.create('failing', {})
    await new Promise((r) => setTimeout(r, 20))

    const final = engine.get(instance.id)
    expect(final?.status).toBe('failed')
    expect(final?.error).toBe('nope')
  })

  it('list()/steps() reflect the persisted instance and its step rows', async () => {
    const { engine } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'listed',
      async run(ctx) {
        await ctx.step.do('a', {}, async () => 'a')
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('listed', {}, { project: 'techpulse', title: 'Listed' })
    await new Promise((r) => setTimeout(r, 20))

    expect(engine.list({ status: 'succeeded' }).map((w) => w.id)).toContain(instance.id)
    expect(engine.list({ project: 'techpulse' }).map((w) => w.id)).toContain(instance.id)
    expect(engine.steps(instance.id).map((s) => s.name)).toEqual(['a'])
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflow/engine`
Expected: fails — `engine.ts` does not exist.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/workflow/engine.ts
import type {
  Event,
  EventType,
  RoutineDefaults,
  WorkflowInstance,
  WorkflowStatus,
} from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { ProcessManager } from '../process/processManager.js'
import { WorkflowSuspended, createWorkflowContext } from './context.js'
import { WorkflowRegistry } from './registry.js'
import { WorkflowStore } from './store.js'

const DEFAULT_MAX_CONCURRENT = 2

export class WorkflowEngine {
  readonly registry = new WorkflowRegistry()
  private store: WorkflowStore
  private inFlight = new Set<string>()
  private queue: string[] = []
  private defaults: RoutineDefaults = {
    model: 'sonnet',
    permission_mode: 'plan',
    allowed_tools: [],
    max_attempts: 2,
    timeout_ms: 600_000,
  }
  private maxConcurrent = DEFAULT_MAX_CONCURRENT

  constructor(
    private cfg: KernelConfig,
    private log: EventLog,
    private pm: ProcessManager,
  ) {
    this.store = new WorkflowStore(log)
  }

  load(defaults: RoutineDefaults, maxConcurrent?: number): void {
    this.defaults = defaults
    this.maxConcurrent = maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  }

  // -- filled in by Task 7 --
  start(): void {}
  stop(): void {}

  async create(
    kind: string,
    input: Record<string, unknown>,
    opts: { project?: string; title?: string } = {},
  ): Promise<WorkflowInstance> {
    if (!this.registry.get(kind)) {
      throw new Error(`unknown workflow kind: ${kind}`)
    }
    const instance = this.store.create({
      kind,
      project: opts.project,
      title: opts.title ?? kind,
      input,
    })
    this.emitEvent(instance, 'workflow.created', {})
    this.schedule(instance.id)
    return instance
  }

  get(id: string): WorkflowInstance | undefined {
    return this.store.get(id)
  }

  list(
    opts?: { status?: WorkflowStatus; kind?: string; project?: string },
  ): WorkflowInstance[] {
    return this.store.list(opts)
  }

  steps(id: string) {
    return this.store.steps(id)
  }

  private emitEvent(
    instance: WorkflowInstance,
    type: EventType,
    extra: Record<string, unknown>,
  ): void {
    this.log.append({
      type,
      payload: {
        workflowId: instance.id,
        kind: instance.kind,
        project: instance.project ?? null,
        ...extra,
      },
    })
  }

  private schedule(id: string): void {
    if (this.inFlight.has(id)) return
    if (this.inFlight.size >= this.maxConcurrent) {
      if (!this.queue.includes(id)) this.queue.push(id)
      return
    }
    this.launch(id)
  }

  private launch(id: string): void {
    this.inFlight.add(id)
    this.executeInstance(id).finally(() => {
      this.inFlight.delete(id)
      const next = this.queue.shift()
      if (next) this.launch(next)
    })
  }

  private async executeInstance(id: string): Promise<void> {
    const instance = this.store.get(id)
    if (!instance || instance.status === 'paused') return
    const definition = this.registry.get(instance.kind)
    if (!definition) {
      this.store.update(id, {
        status: 'failed',
        error: `no workflow definition registered for kind '${instance.kind}'`,
        endedAt: new Date().toISOString(),
      })
      return
    }
    if (instance.status === 'queued') {
      this.store.update(id, { status: 'running', startedAt: new Date().toISOString() })
    }
    const ctx = createWorkflowContext(
      {
        cfg: this.cfg,
        log: this.log,
        store: this.store,
        pm: this.pm,
        defaults: this.defaults,
        daemonUrl: `http://${this.cfg.host}:${this.cfg.port}`,
        onStepEvent: (type, extra) => {
          const current = this.store.get(id)
          if (current) this.emitEvent(current, type, extra)
        },
      },
      // biome-ignore lint/style/noNonNullAssertion: fetched at the top of this method
      this.store.get(id)!,
    )
    try {
      await definition.run(ctx)
      this.store.update(id, {
        status: 'succeeded',
        state: ctx.state,
        endedAt: new Date().toISOString(),
      })
      // biome-ignore lint/style/noNonNullAssertion: just updated
      this.emitEvent(this.store.get(id)!, 'workflow.succeeded', {})
    } catch (err) {
      if (err instanceof WorkflowSuspended) return
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.store.update(id, {
        status: 'failed',
        error: errorMsg,
        endedAt: new Date().toISOString(),
      })
      // biome-ignore lint/style/noNonNullAssertion: just updated
      this.emitEvent(this.store.get(id)!, 'workflow.failed', { error: errorMsg })
    }
  }
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflow/engine`
Expected: `PASS` — 4 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/engine.ts packages/kernel/test/workflow/engine.test.ts
git commit -m "feat(kernel): add WorkflowEngine core (create/get/list/executeInstance)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `WorkflowEngine` — `start`/`stop`, the 5s alarm tick, event-driven wake-ups, boot resume

**Files:** Modify `packages/kernel/src/workflow/engine.ts`, `packages/kernel/test/workflow/engine.test.ts`
**Interfaces:** Fills in `start()`/`stop()`; adds private `onEvent(e)`/`tick()`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/engine.test.ts -- add
import { vi } from 'vitest'

describe('WorkflowEngine wake-ups', () => {
  it('wakes a sleeping instance once its wakeAt has passed via the 5s alarm tick', async () => {
    vi.useFakeTimers()
    const { engine } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'napper',
      async run(ctx) {
        await ctx.step.sleep('nap', 8_000)
        ctx.state.woke = true
      },
    }
    engine.registry.register(def)
    engine.start()

    const instance = await engine.create('napper', {})
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.get(instance.id)?.status).toBe('sleeping')

    await vi.advanceTimersByTimeAsync(10_000) // past wakeAt, at least one 5s alarm tick
    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(engine.get(instance.id)?.state.woke).toBe(true)
    engine.stop()
    vi.useRealTimers()
  })

  it('wakes a waiting instance as soon as a matching event is appended', async () => {
    const { engine, log } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'waiter',
      async run(ctx) {
        const payload = await ctx.step.waitForEvent<{ approved: boolean }>(
          'gate', 'decision.resolved', { timeoutMs: 60_000 },
        )
        ctx.state.approved = payload.approved
      },
    }
    engine.registry.register(def)
    engine.start()

    const instance = await engine.create('waiter', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.get(instance.id)?.status).toBe('waiting')

    log.append({ type: 'decision.resolved', payload: { approved: true } })
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(engine.get(instance.id)?.state.approved).toBe(true)
    engine.stop()
  })

  it('resumes running|waiting|sleeping instances on start() (boot recovery)', async () => {
    const { engine, log } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'resumable',
      async run(ctx) {
        await ctx.step.do('step-a', {}, async () => 'a')
      },
    }
    engine.registry.register(def)
    const stuck = log.createWorkflow({ kind: 'resumable', title: 't', input: {} })
    log.updateWorkflow(stuck.id, { status: 'running', startedAt: new Date().toISOString() })

    engine.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(engine.get(stuck.id)?.status).toBe('succeeded')
    engine.stop()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflow/engine`
Expected: the three new tests fail — `start()`/`stop()` are no-ops, so nothing ever wakes a parked or restart-stranded instance.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/workflow/engine.ts -- add fields and replace the two stubs
private alarmHandle?: NodeJS.Timeout
private unsubscribe?: () => void

start(): void {
  this.unsubscribe = this.log.subscribe((e) => this.onEvent(e))
  this.alarmHandle = setInterval(() => this.tick(), 5_000)
  for (const inst of [
    ...this.store.list({ status: 'running' }),
    ...this.store.list({ status: 'waiting' }),
    ...this.store.list({ status: 'sleeping' }),
  ]) {
    this.schedule(inst.id)
  }
}

stop(): void {
  this.unsubscribe?.()
  if (this.alarmHandle) clearInterval(this.alarmHandle)
}

private onEvent(e: Event): void {
  for (const inst of this.store.list({ status: 'waiting' })) {
    if (inst.waitEvent === e.type) this.schedule(inst.id)
  }
}

private tick(): void {
  const now = Date.now()
  for (const inst of [
    ...this.store.list({ status: 'sleeping' }),
    ...this.store.list({ status: 'waiting' }),
  ]) {
    if (inst.wakeAt && now >= new Date(inst.wakeAt).getTime()) this.schedule(inst.id)
  }
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflow/engine`
Expected: `PASS` — 7 tests total.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/engine.ts packages/kernel/test/workflow/engine.test.ts
git commit -m "feat(kernel): wire WorkflowEngine start/stop, alarm tick, and event-driven wake-ups

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `context.ts` `step.run` — spawn a kernel `Run` via `ProcessManager.runToCompletion`

**Files:** Modify `packages/kernel/src/workflow/context.ts`; Create `packages/kernel/test/workflow/engine.run.test.ts`
**Interfaces:** Consumes `assemblePrompt`, `writeRunMcpConfig`, `nanoid`. Fills in the `stepRun` stub from Task 4.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/engine.run.test.ts
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'
import type { KernelConfig } from '../../src/config.js'

const fakeClaudeBin = fileURLToPath(new URL('../../../../tools/fake-claude/bin.js', import.meta.url))
const fixturesDir = fileURLToPath(new URL('../../../../tools/fake-claude/fixtures', import.meta.url))

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-wf-'))
  await fs.mkdir(path.join(dir, 'agents', 'ops', 'workspace'), { recursive: true })
  await fs.writeFile(path.join(dir, 'agents', 'ops', 'AGENT.md'), '# ops\n')
  await fs.mkdir(path.join(dir, 'skills', 'brief', 'context'), { recursive: true })
  await fs.writeFile(path.join(dir, 'skills', 'brief', 'skill.md'), '# brief\n')
  await fs.writeFile(path.join(dir, 'skills', 'brief', 'learnings.md'), '')
  return dir
}

describe('WorkflowEngine step.run', () => {
  it('spawns a kernel Run via ProcessManager.runToCompletion and records run_id on the step', async () => {
    const osRoot = await makeOsRoot()
    const cfg = {
      osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:',
      claudeBin: 'node', host: '127.0.0.1', port: 4545, logLevel: 'info',
    } as KernelConfig
    const log = new EventLog(':memory:')
    const pm = new ProcessManager(cfg, log)
    pm.runToCompletion = vi
      .fn()
      .mockResolvedValue({ status: 'success', sessionId: 's1', costUsd: 0.01, resultText: 'done' })
    const engine = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition<{ title: string }> = {
      kind: 'brief-only',
      async run(ctx) {
        const result = await ctx.step.run('brief', {
          skill: 'brief', agent: 'ops', task: { title: ctx.input.title },
        })
        ctx.state.sessionId = result.sessionId
      },
    }
    engine.registry.register(def)

    const instance = await engine.create('brief-only', { title: 'Add dark mode' })
    await new Promise((r) => setTimeout(r, 20))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(engine.get(instance.id)?.state.sessionId).toBe('s1')
    const step = engine.steps(instance.id).find((s) => s.name === 'brief')
    expect(step?.runId).toBeDefined()
    // biome-ignore lint/suspicious/noExplicitAny: asserting against a vi.fn() mock's captured call args
    expect((pm.runToCompletion as any).mock.calls[0][1].model).toBe('sonnet')
  })

  it('fails the step and the instance when the run does not succeed', async () => {
    const osRoot = await makeOsRoot()
    const cfg = {
      osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:',
      claudeBin: 'node', host: '127.0.0.1', port: 4545, logLevel: 'info',
    } as KernelConfig
    const log = new EventLog(':memory:')
    const pm = new ProcessManager(cfg, log)
    pm.runToCompletion = vi.fn().mockResolvedValue({ status: 'failed', error: 'brief crashed' })
    const engine = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition = {
      kind: 'brief-fails',
      async run(ctx) {
        await ctx.step.run('brief', { skill: 'brief', agent: 'ops' })
      },
    }
    engine.registry.register(def)

    const instance = await engine.create('brief-fails', {})
    await new Promise((r) => setTimeout(r, 20))

    expect(engine.get(instance.id)?.status).toBe('failed')
    expect(engine.get(instance.id)?.error).toBe('brief crashed')
  })

  it('runs a real step.run through fake-claude end to end', async () => {
    const osRoot = await makeOsRoot()
    const cfg = {
      osRoot, runtimeDir: path.join(osRoot, '..', '.agentos-wf-e2e'), dbPath: ':memory:',
      claudeBin: fakeClaudeBin, host: '127.0.0.1', port: 4546, logLevel: 'info',
    } as KernelConfig
    process.env.AGENTOS_CLAUDE_BIN = fakeClaudeBin
    process.env.FAKE_CLAUDE_FIXTURE = path.join(fixturesDir, 'init-success.jsonl')
    const log = new EventLog(':memory:')
    const pm = new ProcessManager(cfg, log)
    const engine = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition = {
      kind: 'brief-real',
      async run(ctx) {
        await ctx.step.run('brief', { skill: 'brief', agent: 'ops' })
      },
    }
    engine.registry.register(def)

    const instance = await engine.create('brief-real', {})
    await new Promise((r) => setTimeout(r, 500))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
  }, 10_000)
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- engine.run`
Expected: fails — `step.run` throws `not implemented until Task 7`.
- [ ] **Step 3: Implement — add imports and replace the `stepRun` stub in `context.ts`**
```ts
// packages/kernel/src/workflow/context.ts -- add imports at the top
import fs from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { writeRunMcpConfig } from '../process/mcpConfig.js'
import { assemblePrompt } from '../process/promptAssembler.js'
```
```ts
// packages/kernel/src/workflow/context.ts -- replace stepRun
async function stepRun(name: string, spec: StepRunSpec): Promise<RunResult> {
  seq += 1
  const mySeq = seq
  let row = deps.store.getStep(instance.id, name)
  if (row?.status === 'succeeded') return row.output as RunResult
  if (!row) {
    row = deps.store.createStep(instance.id, name, mySeq)
    deps.store.update(instance.id, { currentStep: name })
    deps.onStepEvent('workflow.step.started', { step: name, seq: mySeq })
  }
  const kernelRun = deps.log.createRun({
    routine: `workflow:${instance.kind}:${name}`,
    skill: spec.skill,
    agent: spec.agent,
    payload: spec.task,
  })
  deps.store.updateStep(row.id, { runId: kernelRun.id })
  const assembled = await assemblePrompt({
    osRoot: deps.cfg.osRoot,
    skill: spec.skill,
    agent: spec.agent,
    task: spec.task ? JSON.stringify(spec.task) : undefined,
  })
  const runToken = nanoid()
  deps.log.createRunToken(kernelRun.id, runToken)
  const mcpConfigPath = await writeRunMcpConfig(
    deps.cfg.runtimeDir,
    kernelRun,
    deps.daemonUrl,
    runToken,
  )
  const cwd = spec.cwd ?? path.join(deps.cfg.osRoot, 'agents', spec.agent, 'workspace')
  // A later milestone gates any spec.cwd outside the default agent workspace
  // (a project clone) behind that project's build.enabled + project.clone
  // (spec §5.3) with a guard call inserted right here, before the spawn --
  // this line is that wiring point; W1 does not implement the check itself.
  await fs.mkdir(cwd, { recursive: true })
  const common = {
    cwd,
    model: spec.model ?? deps.defaults.model,
    permissionMode: spec.permissionMode ?? deps.defaults.permission_mode,
    allowedTools: spec.allowedTools ?? deps.defaults.allowed_tools,
    addDirs: [deps.cfg.osRoot, ...(spec.addDirs ?? [])],
    mcpConfigPath,
    timeoutMs: spec.timeoutMs ?? deps.defaults.timeout_ms,
  }
  const result = await deps.pm.runToCompletion(
    kernelRun,
    { prompt: assembled.prompt, systemPromptAppend: assembled.systemPromptAppend, ...common },
    { skill: spec.skill, osRoot: deps.cfg.osRoot, ...common },
  )
  if (result.status !== 'success') {
    const errorMsg = result.error ?? `run ended with status ${result.status}`
    deps.store.updateStep(row.id, {
      status: 'failed',
      error: errorMsg,
      endedAt: new Date().toISOString(),
    })
    deps.onStepEvent('workflow.step.failed', { step: name, seq: mySeq, error: errorMsg })
    throw new Error(errorMsg)
  }
  deps.store.updateStep(row.id, {
    status: 'succeeded',
    output: result,
    endedAt: new Date().toISOString(),
  })
  state[name] = result
  deps.store.update(instance.id, { state })
  deps.onStepEvent('workflow.step.succeeded', { step: name, seq: mySeq })
  return result
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- engine.run`
Expected: `PASS` — 3 tests.
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/context.ts packages/kernel/test/workflow/engine.run.test.ts
git commit -m "feat(kernel): wire workflow step.run to ProcessManager.runToCompletion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `WorkflowEngine` pause/resume/terminate + `max_concurrent` queue

**Files:** Modify `packages/kernel/src/workflow/context.ts` (add `checkPause`), `packages/kernel/src/workflow/engine.ts`, `packages/kernel/test/workflow/engine.test.ts`
**Interfaces:** Produces `WorkflowEngine.pause(id)`, `resume(id)`, `terminate(id)`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/workflow/engine.test.ts -- add
describe('WorkflowEngine pause/resume/terminate and max_concurrent', () => {
  it('pause stops further steps from starting; an already in-flight step still finishes', async () => {
    const { engine } = makeEngine()
    let resolveStepA: (v: string) => void = () => {}
    const stepAPromise = new Promise<string>((r) => { resolveStepA = r })
    const def: WorkflowDefinition = {
      kind: 'pausable',
      async run(ctx) {
        await ctx.step.do('step-a', {}, () => stepAPromise)
        await ctx.step.do('step-b', {}, async () => 'b')
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('pausable', {})
    await new Promise((r) => setTimeout(r, 10)) // step-a is now in flight

    await engine.pause(instance.id)
    expect(engine.get(instance.id)?.status).toBe('paused')

    resolveStepA('a')
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.steps(instance.id).find((s) => s.name === 'step-a')?.status).toBe('succeeded')
    expect(engine.steps(instance.id).find((s) => s.name === 'step-b')).toBeUndefined()
    expect(engine.get(instance.id)?.status).toBe('paused')
  })

  it('resume replays a paused instance to completion', async () => {
    const { engine } = makeEngine()
    const def: WorkflowDefinition = {
      kind: 'resume-me',
      async run(ctx) {
        await ctx.step.do('step-a', {}, async () => 'a')
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('resume-me', {})
    await engine.pause(instance.id)
    await new Promise((r) => setTimeout(r, 10))

    await engine.resume(instance.id)
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
  })

  it('resume from failed resets the failed step and retries it', async () => {
    const { engine } = makeEngine()
    let attempts = 0
    const def: WorkflowDefinition = {
      kind: 'flaky',
      async run(ctx) {
        await ctx.step.do('validate', { retries: 0 }, async () => {
          attempts++
          if (attempts === 1) throw new Error('checks failed')
          return 'ok'
        })
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('flaky', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.get(instance.id)?.status).toBe('failed')

    await engine.resume(instance.id)
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(instance.id)?.status).toBe('succeeded')
    expect(attempts).toBe(2)
  })

  it('resume rejects an instance that is neither paused nor failed', async () => {
    const { engine } = makeEngine()
    const def: WorkflowDefinition = { kind: 'done-already', async run() {} }
    engine.registry.register(def)
    const instance = await engine.create('done-already', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.get(instance.id)?.status).toBe('succeeded')
    await expect(engine.resume(instance.id)).rejects.toThrow(/cannot resume/)
  })

  it('terminate kills the current step run and marks the instance terminated', async () => {
    const { engine, pm } = makeEngine()
    const killSpy = vi.spyOn(pm, 'kill').mockReturnValue(true)
    pm.runToCompletion = vi.fn().mockImplementation(() => new Promise(() => {}))
    const def: WorkflowDefinition = {
      kind: 'long-build',
      async run(ctx) {
        await ctx.step.run('build', { skill: 'build', agent: 'ops' })
      },
    }
    engine.registry.register(def)
    const instance = await engine.create('long-build', {})
    await new Promise((r) => setTimeout(r, 10))

    await engine.terminate(instance.id)

    expect(killSpy).toHaveBeenCalled()
    expect(engine.get(instance.id)?.status).toBe('terminated')
    expect(engine.steps(instance.id).find((s) => s.name === 'build')?.status).toBe('skipped')
  })

  it('runs at most max_concurrent instances at once, queuing the rest', async () => {
    const { engine } = makeEngine()
    engine.load({ model: 'sonnet', permission_mode: 'plan', allowed_tools: [], max_attempts: 2, timeout_ms: 60_000 }, 1)
    let concurrent = 0
    let maxSeen = 0
    const gate: Array<() => void> = []
    const def: WorkflowDefinition = {
      kind: 'slow',
      async run() {
        concurrent++
        maxSeen = Math.max(maxSeen, concurrent)
        await new Promise<void>((resolve) => gate.push(resolve))
        concurrent--
      },
    }
    engine.registry.register(def)
    const a = await engine.create('slow', {})
    const b = await engine.create('slow', {})
    await new Promise((r) => setTimeout(r, 10))

    expect(maxSeen).toBe(1) // max_concurrent: 1 -- b has not started yet
    gate.shift()?.()
    await new Promise((r) => setTimeout(r, 10))
    gate.shift()?.()
    await new Promise((r) => setTimeout(r, 10))

    expect(engine.get(a.id)?.status).toBe('succeeded')
    expect(engine.get(b.id)?.status).toBe('succeeded')
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflow/engine`
Expected: fails — `pause`/`resume`/`terminate` don't exist yet, and nothing enforces `max_concurrent`.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/workflow/context.ts -- add near the other helpers, and call it from every `!row` branch
function checkPause(deps: import('./types.js').WorkflowRuntimeDeps, instanceId: string): void {
  const current = deps.store.get(instanceId)
  if (current?.status === 'paused') throw new WorkflowSuspended()
}
```
In `stepDo`, `stepSleep`, `stepWaitForEvent`, and `stepRun`, add `checkPause(deps, instance.id)` as the first line inside each `if (!row) { ... }` block (before creating the new step row) — this is what makes `pause()` (Step 3 of engine.ts below) actually stop the *next* step from starting while letting an already-running step finish undisturbed.
```ts
// packages/kernel/src/workflow/engine.ts -- add methods
async pause(id: string): Promise<WorkflowInstance> {
  this.requireInstance(id)
  const updated = this.store.update(id, { status: 'paused' })
  this.emitEvent(updated, 'workflow.paused', {})
  return updated
}

async resume(id: string): Promise<WorkflowInstance> {
  const instance = this.requireInstance(id)
  if (instance.status !== 'paused' && instance.status !== 'failed') {
    throw new Error(`cannot resume workflow ${id} from status ${instance.status}`)
  }
  if (instance.status === 'failed' && instance.currentStep) {
    this.store.resetFailedStep(id, instance.currentStep)
  }
  const updated = this.store.update(id, { status: 'running', error: undefined })
  this.emitEvent(updated, 'workflow.resumed', {})
  this.schedule(id)
  return updated
}

async terminate(id: string): Promise<WorkflowInstance> {
  const instance = this.requireInstance(id)
  const current = instance.currentStep
    ? this.store.getStep(id, instance.currentStep)
    : undefined
  if (current?.runId) this.pm.kill(current.runId)
  if (current && current.status !== 'succeeded' && current.status !== 'failed') {
    this.store.updateStep(current.id, { status: 'skipped', endedAt: new Date().toISOString() })
  }
  const updated = this.store.update(id, {
    status: 'terminated',
    endedAt: new Date().toISOString(),
  })
  this.emitEvent(updated, 'workflow.terminated', {})
  return updated
}

private requireInstance(id: string): WorkflowInstance {
  const instance = this.store.get(id)
  if (!instance) throw new Error(`unknown workflow: ${id}`)
  return instance
}
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflow/engine engine.run`
Expected: `PASS` — 13 tests in `engine.test.ts`, 3 in `engine.run.test.ts` (no regressions).
- [ ] **Step 5: Commit**
```
git add packages/kernel/src/workflow/context.ts packages/kernel/src/workflow/engine.ts packages/kernel/test/workflow/engine.test.ts
git commit -m "feat(kernel): add WorkflowEngine pause/resume/terminate and max_concurrent queuing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: HTTP API (`GET/POST /api/workflows*`) + kernel wiring + `routines.yaml`

**Files:** Create `packages/kernel/src/api/workflows.ts`, `packages/kernel/test/api/workflows.routes.test.ts`, `packages/kernel/test/workflow/kernel.wiring.test.ts`; Modify `packages/kernel/src/api/server.ts`, `packages/kernel/src/kernel.ts`, `packages/kernel/src/index.ts`, `examples/os-template/os/routines.yaml`
**Interfaces:** Consumes `WorkflowEngine`; `CreateWorkflowRequest/Response`, `GetWorkflowResponse`, `DeliverWorkflowEventRequest`, `ErrorResponse` from `@agentos/shared`. Produces `registerWorkflowRoutes(app, { engine, log })`; `Kernel.workflows: WorkflowEngine`; `createKernel(cfg, adapterRegistry?, workflowDefinitions?)`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/kernel/test/api/workflows.routes.test.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/api/server.js'
import { AdapterHost } from '../../src/adapters/adapterHost.js'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { Scheduler } from '../../src/scheduler/scheduler.js'
import { WikiService } from '../../src/wiki/wikiService.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'
import type { Kernel } from '../../src/kernel.js'

function makeKernel(): { kernel: Kernel } {
  const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
  const cfg = {
    osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:',
    claudeBin: 'true', host: '127.0.0.1' as const, port: 0, logLevel: 'info' as const,
  }
  const log = new EventLog(cfg.dbPath)
  const pm = new ProcessManager(cfg, log)
  const wiki = new WikiService(osRoot, log)
  const adapters = new AdapterHost(cfg, log, wiki, {})
  const scheduler = new Scheduler(cfg, log, async () => {})
  const workflows = new WorkflowEngine(cfg, log, pm)
  const def: WorkflowDefinition = {
    kind: 'fake',
    async run(ctx) {
      await ctx.step.do('brief', {}, async () => 'ok')
    },
  }
  workflows.registry.register(def)
  // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for buildServer's Kernel param
  const kernel = { cfg, log, pm, wiki, adapters, scheduler, workflows } as any as Kernel
  return { kernel }
}

describe('workflow routes', () => {
  it('creates, lists, and reads a workflow instance, and delivers an external event', async () => {
    const { kernel } = makeKernel()
    const app = buildServer(kernel)

    const create = await app.inject({
      method: 'POST', url: '/api/workflows', payload: { kind: 'fake', input: { title: 't' } },
    })
    expect(create.statusCode).toBe(202)
    const { workflowId } = create.json()

    await new Promise((r) => setTimeout(r, 20))

    const get = await app.inject({ method: 'GET', url: `/api/workflows/${workflowId}` })
    expect(get.json().workflow.status).toBe('succeeded')
    expect(get.json().steps).toHaveLength(1)

    const list = await app.inject({ method: 'GET', url: '/api/workflows?status=succeeded' })
    expect(list.json().map((w: { id: string }) => w.id)).toContain(workflowId)

    const event = await app.inject({
      method: 'POST', url: `/api/workflows/${workflowId}/events`,
      payload: { type: 'custom.ping', payload: { ok: true } },
    })
    expect(event.statusCode).toBe(202)
  })

  it('404s pause/resume/terminate for an unknown workflow, and 409s an invalid resume', async () => {
    const { kernel } = makeKernel()
    const app = buildServer(kernel)

    const missing = await app.inject({ method: 'POST', url: '/api/workflows/nope/pause' })
    expect(missing.statusCode).toBe(404)

    const create = await app.inject({
      method: 'POST', url: '/api/workflows', payload: { kind: 'fake', input: {} },
    })
    const { workflowId } = create.json()
    await new Promise((r) => setTimeout(r, 20))

    const resume = await app.inject({ method: 'POST', url: `/api/workflows/${workflowId}/resume` })
    expect(resume.statusCode).toBe(409) // already succeeded, not paused/failed
  })

  it('400s a create with no kind', async () => {
    const { kernel } = makeKernel()
    const app = buildServer(kernel)
    const res = await app.inject({ method: 'POST', url: '/api/workflows', payload: {} })
    expect(res.statusCode).toBe(400)
  })
})
```
```ts
// packages/kernel/test/workflow/kernel.wiring.test.ts
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createKernel } from '../../src/kernel.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'

async function makeOsRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-wf-kernel-'))
  await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
  await fs.mkdir(path.join(dir, 'wiki'), { recursive: true })
  await fs.writeFile(path.join(dir, 'wiki', 'index.md'), '# index\n')
  await fs.writeFile(path.join(dir, 'wiki', 'log.md'), '')
  await fs.mkdir(path.join(dir, 'agents', 'ops', 'workspace'), { recursive: true })
  await fs.writeFile(path.join(dir, 'agents', 'ops', 'AGENT.md'), '# ops\n')
  await fs.writeFile(
    path.join(dir, 'routines.yaml'),
    'defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 60000\nroutines: []\nworkflows:\n  max_concurrent: 3\n',
  )
  return dir
}

describe('kernel workflow wiring', () => {
  it('starts and stops the WorkflowEngine, loading max_concurrent from routines.yaml, and runs a registered definition', async () => {
    const osRoot = await makeOsRoot()
    const def: WorkflowDefinition = {
      kind: 'smoke',
      async run(ctx) {
        await ctx.step.do('a', {}, async () => 'ok')
      },
    }
    const kernel = createKernel(
      { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1', port: 4991, logLevel: 'info' },
      {},
      [def],
    )
    await kernel.start()

    const instance = await kernel.workflows.create('smoke', {})
    await new Promise((r) => setTimeout(r, 20))
    expect(kernel.workflows.get(instance.id)?.status).toBe('succeeded')

    await kernel.stop()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/kernel test -- workflows.routes kernel.wiring`
Expected: fails — `Kernel` has no `workflows` property, `/api/workflows*` routes don't exist, `createKernel` has no third parameter.
- [ ] **Step 3: Implement**
```ts
// packages/kernel/src/api/workflows.ts
import type {
  CreateWorkflowRequest,
  CreateWorkflowResponse,
  DeliverWorkflowEventRequest,
  ErrorResponse,
  GetWorkflowResponse,
  WorkflowStatus,
} from '@agentos/shared'
import type { FastifyInstance } from 'fastify'
import type { EventLog } from '../log/eventLog.js'
import type { WorkflowEngine } from '../workflow/engine.js'

export interface WorkflowRouteDeps {
  engine: WorkflowEngine
  log: EventLog
}

export function registerWorkflowRoutes(app: FastifyInstance, deps: WorkflowRouteDeps): void {
  const { engine, log } = deps

  app.get('/api/workflows', async (req) => {
    const q = req.query as { status?: WorkflowStatus; project?: string; kind?: string }
    return engine.list({ status: q.status, project: q.project, kind: q.kind })
  })

  app.get('/api/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const workflow = engine.get(id)
    if (!workflow)
      return reply.code(404).send({ error: 'workflow not found' } satisfies ErrorResponse)
    return { workflow, steps: engine.steps(id) } satisfies GetWorkflowResponse
  })

  app.post('/api/workflows', async (req, reply) => {
    const body = req.body as CreateWorkflowRequest
    if (!body?.kind)
      return reply.code(400).send({ error: 'kind is required' } satisfies ErrorResponse)
    try {
      const workflow = await engine.create(body.kind, body.input ?? {}, {
        project: body.project,
        title: body.title,
      })
      return reply
        .code(202)
        .send({ workflowId: workflow.id } satisfies CreateWorkflowResponse)
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) } satisfies ErrorResponse)
    }
  })

  app.post('/api/workflows/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply.code(404).send({ error: 'workflow not found' } satisfies ErrorResponse)
    return engine.pause(id)
  })

  app.post('/api/workflows/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply.code(404).send({ error: 'workflow not found' } satisfies ErrorResponse)
    try {
      return await engine.resume(id)
    } catch (err) {
      return reply
        .code(409)
        .send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/workflows/:id/terminate', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply.code(404).send({ error: 'workflow not found' } satisfies ErrorResponse)
    return engine.terminate(id)
  })

  app.post('/api/workflows/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.get(id))
      return reply.code(404).send({ error: 'workflow not found' } satisfies ErrorResponse)
    const body = req.body as DeliverWorkflowEventRequest
    if (!body?.type)
      return reply.code(400).send({ error: 'type is required' } satisfies ErrorResponse)
    // biome-ignore lint/suspicious/noExplicitAny: an operator-delivered event's type is validated as non-empty above, not against the closed EventType union -- waitForEvent matches by exact string regardless
    const event = log.append({ type: body.type as any, payload: body.payload ?? {} })
    return reply.code(202).send({ id: event.id })
  })
}
```
```ts
// packages/kernel/src/api/server.ts -- import and register, next to registerInternalRoutes
import { registerWorkflowRoutes } from './workflows.js'
// ...
registerInternalRoutes(app, { log, wiki, scheduler, osRoot: cfg.osRoot })
registerWorkflowRoutes(app, { engine: kernel.workflows, log })
```
```ts
// packages/kernel/src/kernel.ts -- add import, Kernel field, constructor/start/stop wiring, createKernel param
import { WorkflowEngine } from './workflow/engine.js'
import type { WorkflowDefinition } from './workflow/types.js'

export interface Kernel {
  cfg: KernelConfig
  log: EventLog
  pm: ProcessManager
  scheduler: Scheduler
  wiki: WikiService
  adapters: AdapterHost
  workflows: WorkflowEngine
  start(): Promise<void>
  stop(): Promise<void>
}

class KernelImpl implements Kernel {
  log: EventLog
  pm: ProcessManager
  scheduler: Scheduler
  wiki: WikiService
  adapters: AdapterHost
  workflows: WorkflowEngine
  private server: FastifyInstance | undefined
  private routinesFile: RoutinesFile | undefined

  constructor(
    public cfg: KernelConfig,
    registry: Record<string, ProjectAdapter> = {},
    workflowDefinitions: WorkflowDefinition[] = [],
  ) {
    this.log = new EventLog(cfg.dbPath)
    this.pm = new ProcessManager(cfg, this.log)
    this.wiki = new WikiService(cfg.osRoot, this.log)
    this.adapters = new AdapterHost(cfg, this.log, this.wiki, registry)
    this.scheduler = new Scheduler(cfg, this.log, (routine, payload) =>
      this.exec(routine, payload),
    )
    this.workflows = new WorkflowEngine(cfg, this.log, this.pm)
    for (const def of workflowDefinitions) this.workflows.registry.register(def)
  }

  // ... exec() unchanged ...

  async start(): Promise<void> {
    await fs.mkdir(this.cfg.runtimeDir, { recursive: true })
    this.routinesFile = await loadRoutinesFile(this.cfg.osRoot)
    this.scheduler.load(this.routinesFile)
    this.workflows.load(this.routinesFile.defaults, this.routinesFile.workflows?.max_concurrent)
    this.server = buildServer(this)
    await this.server.listen({ host: this.cfg.host, port: this.cfg.port })
    this.scheduler.start()
    this.workflows.start()
  }

  async stop(): Promise<void> {
    this.workflows.stop()
    this.scheduler.stop()
    await this.server?.close()
    this.log.close()
  }
}

export function createKernel(
  cfg: KernelConfig,
  registry: Record<string, ProjectAdapter> = {},
  workflowDefinitions: WorkflowDefinition[] = [],
): Kernel {
  return new KernelImpl(cfg, registry, workflowDefinitions)
}
```
```ts
// packages/kernel/src/index.ts -- add re-exports
export * from './workflow/types.js'
export * from './workflow/engine.js'
```
```yaml
# examples/os-template/os/routines.yaml -- append at the end of the file
workflows:
  max_concurrent: 2
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/kernel test -- workflows.routes kernel.wiring`
Expected: `PASS` — 3 + 1 tests.
- [ ] **Step 5: Run the full kernel suite**
Run: `pnpm --filter @agentos/kernel test`
Expected: `PASS`, no regressions.
- [ ] **Step 6: Commit**
```
git add packages/kernel/src/api/workflows.ts packages/kernel/src/api/server.ts packages/kernel/src/kernel.ts packages/kernel/src/index.ts packages/kernel/test/api/workflows.routes.test.ts packages/kernel/test/workflow/kernel.wiring.test.ts examples/os-template/os/routines.yaml
git commit -m "feat(kernel): add /api/workflows* routes and wire WorkflowEngine into the Kernel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: CLI `agentos workflows [list|show|pause|resume|terminate]`

**Files:** Modify `packages/cli/src/client.ts`, `packages/cli/src/bin.ts`; Create `packages/cli/src/commands/workflows.ts`, `packages/cli/test/workflows.command.test.ts`
**Interfaces:** Consumes `WorkflowInstance`, `WorkflowStatus`, `WorkflowStep` from `@agentos/shared`. Produces `ApiClient.listWorkflows/getWorkflow/createWorkflow/pauseWorkflow/resumeWorkflow/terminateWorkflow`; `registerWorkflowsCommand(program, client)`.

- [ ] **Step 1: Write failing tests**
```ts
// packages/cli/test/workflows.command.test.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AdapterHost,
  EventLog,
  type Kernel,
  ProcessManager,
  Scheduler,
  WikiService,
  WorkflowEngine,
  buildServer,
} from '@agentos/kernel'
import type { WorkflowDefinition } from '@agentos/kernel'
import { Command } from 'commander'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../src/client.js'
import { registerWorkflowsCommand } from '../src/commands/workflows.js'

describe('cli workflows', () => {
  let app: ReturnType<typeof buildServer>
  let client: ApiClient

  beforeAll(async () => {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const cfg = {
      osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:',
      claudeBin: 'true', host: '127.0.0.1' as const, port: 0, logLevel: 'info' as const,
    }
    const log = new EventLog(cfg.dbPath)
    const pm = new ProcessManager(cfg, log)
    const wiki = new WikiService(osRoot, log)
    const adapters = new AdapterHost(cfg, log, wiki, {})
    const scheduler = new Scheduler(cfg, log, async () => {})
    const workflows = new WorkflowEngine(cfg, log, pm)
    const def: WorkflowDefinition = {
      kind: 'fake',
      async run(ctx) {
        await ctx.step.do('brief', {}, async () => 'ok')
      },
    }
    workflows.registry.register(def)
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for buildServer's Kernel param
    app = buildServer({ cfg, log, pm, wiki, adapters, scheduler, workflows } as any as Kernel)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    client = new ApiClient({ baseUrl: `http://127.0.0.1:${port}` })
  })

  afterAll(async () => {
    await app.close()
  })

  it('creates via the API, lists, and shows a workflow instance', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { workflowId } = await client.createWorkflow({ kind: 'fake', input: {} })
    await new Promise((r) => setTimeout(r, 20))

    const program = new Command()
    registerWorkflowsCommand(program, client)
    await program.parseAsync(['node', 'agentos', 'workflows', 'list'])
    await program.parseAsync(['node', 'agentos', 'workflows', 'show', workflowId])

    expect(logSpy.mock.calls.some((c) => String(c[0]).includes(workflowId))).toBe(true)
    logSpy.mockRestore()
  })
})
```
- [ ] **Step 2: Run it, confirm failure**
Run: `pnpm --filter @agentos/cli test -- workflows.command`
Expected: fails — `client.createWorkflow`, `registerWorkflowsCommand`, and the `@agentos/kernel` export of `WorkflowEngine` don't exist from the CLI's perspective yet (Task 10 already exported `WorkflowEngine`/`WorkflowDefinition` from kernel's `index.ts`, so only the CLI-side pieces are missing here).
- [ ] **Step 3: Implement**
```ts
// packages/cli/src/client.ts -- extend the import list and add methods
import type {
  CreateRunRequest,
  CreateRunResponse,
  Decision,
  DecisionStatus,
  Event,
  HealthResponse,
  RoutineConfig,
  Run,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
} from '@agentos/shared'

// -- inside class ApiClient --
listWorkflows(
  opts: { status?: WorkflowStatus; project?: string; kind?: string } = {},
): Promise<WorkflowInstance[]> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.project) params.set('project', opts.project)
  if (opts.kind) params.set('kind', opts.kind)
  const qs = params.toString()
  return this.request(`/api/workflows${qs ? `?${qs}` : ''}`)
}

getWorkflow(id: string): Promise<{ workflow: WorkflowInstance; steps: WorkflowStep[] }> {
  return this.request(`/api/workflows/${id}`)
}

createWorkflow(body: {
  kind: string
  project?: string
  title?: string
  input: Record<string, unknown>
}): Promise<{ workflowId: string }> {
  return this.request('/api/workflows', { method: 'POST', body: JSON.stringify(body) })
}

pauseWorkflow(id: string): Promise<WorkflowInstance> {
  return this.request(`/api/workflows/${id}/pause`, { method: 'POST' })
}

resumeWorkflow(id: string): Promise<WorkflowInstance> {
  return this.request(`/api/workflows/${id}/resume`, { method: 'POST' })
}

terminateWorkflow(id: string): Promise<WorkflowInstance> {
  return this.request(`/api/workflows/${id}/terminate`, { method: 'POST' })
}
```
```ts
// packages/cli/src/commands/workflows.ts
import type { WorkflowStatus } from '@agentos/shared'
import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerWorkflowsCommand(program: Command, client: ApiClient): void {
  const workflows = program.command('workflows').description('Manage workflow instances')

  workflows
    .command('list')
    .description('List workflow instances')
    .option('--status <status>', 'filter by status')
    .option('--project <project>', 'filter by project')
    .option('--kind <kind>', 'filter by kind')
    .action(async (opts: { status?: WorkflowStatus; project?: string; kind?: string }) => {
      const list = await client.listWorkflows(opts)
      for (const w of list) {
        console.log(`${w.id}\t[${w.status}]\t${w.kind}\t${w.title}`)
      }
    })

  workflows
    .command('show <id>')
    .description('Show a workflow instance and its steps')
    .action(async (id: string) => {
      const { workflow, steps } = await client.getWorkflow(id)
      console.log(`${workflow.id}  [${workflow.status}]  ${workflow.kind}  ${workflow.title}`)
      for (const s of steps) {
        console.log(
          `  ${s.seq}. ${s.name}\t[${s.status}]\tattempt ${s.attempt}${s.runId ? `\trun=${s.runId}` : ''}`,
        )
      }
    })

  workflows
    .command('pause <id>')
    .description('Pause a workflow instance')
    .action(async (id: string) => {
      await client.pauseWorkflow(id)
      console.log(`paused ${id}`)
    })

  workflows
    .command('resume <id>')
    .description('Resume a paused or failed workflow instance')
    .action(async (id: string) => {
      await client.resumeWorkflow(id)
      console.log(`resumed ${id}`)
    })

  workflows
    .command('terminate <id>')
    .description('Terminate a workflow instance')
    .action(async (id: string) => {
      await client.terminateWorkflow(id)
      console.log(`terminated ${id}`)
    })
}
```
```ts
// packages/cli/src/bin.ts -- import and register
import { registerWorkflowsCommand } from './commands/workflows.js'
// ...
registerRoutinesCommand(program, client())
registerWorkflowsCommand(program, client())
registerDecisions(program, client())
```
- [ ] **Step 4: Run tests, confirm pass**
Run: `pnpm --filter @agentos/cli test`
Expected: `PASS`, no regressions.
- [ ] **Step 5: Commit**
```
git add packages/cli/src/client.ts packages/cli/src/commands/workflows.ts packages/cli/src/bin.ts packages/cli/test/workflows.command.test.ts
git commit -m "feat(cli): add agentos workflows [list|show|pause|resume|terminate]

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Restart-resume integration coverage for every resumable status

**Files:** Create `packages/kernel/test/workflow/engine.integration.test.ts`
**Interfaces:** No new production code — this task closes the one spec §9 item not yet directly exercised: "restart-resume from every status", proven with two independent `WorkflowEngine` instances sharing one `EventLog`/database (simulating two daemon processes).

- [ ] **Step 1: Write the tests**
```ts
// packages/kernel/test/workflow/engine.integration.test.ts
import { describe, expect, it } from 'vitest'
import { EventLog } from '../../src/log/eventLog.js'
import { ProcessManager } from '../../src/process/processManager.js'
import { WorkflowEngine } from '../../src/workflow/engine.js'
import type { WorkflowDefinition } from '../../src/workflow/types.js'
import type { KernelConfig } from '../../src/config.js'

const cfg = {
  osRoot: 'C:/os', runtimeDir: 'C:/.agentos', dbPath: ':memory:', claudeBin: 'true',
  host: '127.0.0.1', port: 4547, logLevel: 'info',
} as KernelConfig

describe('WorkflowEngine restart-resume from every resumable status', () => {
  it('resumes a running instance (interrupted mid step.do) without re-running the already-succeeded step', async () => {
    const log = new EventLog(':memory:')
    const stuckDef: WorkflowDefinition = {
      kind: 'restart-running',
      async run(ctx) {
        await ctx.step.do('a', {}, async () => 'a')
        // never resolves -- simulates a daemon process that died mid-step
        await ctx.step.do('b', { retries: 0 }, () => new Promise<string>(() => {}))
      },
    }
    const first = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    first.registry.register(stuckDef)
    const instance = await first.create('restart-running', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(log.getWorkflow(instance.id)?.status).toBe('running')
    expect(log.listWorkflowSteps(instance.id).find((s) => s.name === 'a')?.status).toBe('succeeded')

    const workingDef: WorkflowDefinition = {
      kind: 'restart-running',
      async run(ctx) {
        const a = await ctx.step.do('a', {}, async () => 'a')
        const b = await ctx.step.do('b', {}, async () => 'b') // this time it actually resolves
        ctx.state.result = `${a}${b}`
      },
    }
    const second = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    second.registry.register(workingDef)
    second.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(second.get(instance.id)?.status).toBe('succeeded')
    expect(second.get(instance.id)?.state.result).toBe('ab')
    second.stop()
  })

  it('resumes a waiting instance once the second engine boots, replaying the same match predicate against events recorded while it was down', async () => {
    const log = new EventLog(':memory:')
    const def: WorkflowDefinition = {
      kind: 'restart-waiting',
      async run(ctx) {
        const payload = await ctx.step.waitForEvent<{ ref: string }>('gate', 'decision.resolved', {
          timeoutMs: 60_000,
          match: (e) => (e.payload as { ref?: string }).ref === '001-slug.md',
        })
        ctx.state.ref = payload.ref
      },
    }
    const first = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    first.registry.register(def)
    const instance = await first.create('restart-waiting', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(first.get(instance.id)?.status).toBe('waiting')

    // Arrives while no engine is running -- proves resume scans EventLog history, not a live callback.
    log.append({ type: 'decision.resolved', payload: { ref: '001-slug.md' } })

    const second = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    second.registry.register(def)
    second.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(second.get(instance.id)?.status).toBe('succeeded')
    expect(second.get(instance.id)?.state.ref).toBe('001-slug.md')
    second.stop()
  })

  it('resumes a sleeping instance once its wakeAt has passed', async () => {
    const log = new EventLog(':memory:')
    const def: WorkflowDefinition = {
      kind: 'restart-sleeping',
      async run(ctx) {
        await ctx.step.sleep('cooldown', 30)
        ctx.state.done = true
      },
    }
    const first = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    first.registry.register(def)
    const instance = await first.create('restart-sleeping', {})
    await new Promise((r) => setTimeout(r, 10))
    expect(first.get(instance.id)?.status).toBe('sleeping')

    await new Promise((r) => setTimeout(r, 40)) // past wakeAt while no engine is running

    const second = new WorkflowEngine(cfg, log, new ProcessManager(cfg, log))
    second.registry.register(def)
    second.start()
    await new Promise((r) => setTimeout(r, 20))

    expect(second.get(instance.id)?.status).toBe('succeeded')
    second.stop()
  })
})
```
- [ ] **Step 2: Run it, confirm it passes on the first run**
Run: `pnpm --filter @agentos/kernel test -- engine.integration`
Expected: if Tasks 1–11 are correctly wired, `PASS` — 3 tests — on the first run, since every piece it exercises (replay caching, `waitForEvent` event-history rescanning, `sleeping`/`wakeAt` recovery) was already built and unit-tested individually; this test only proves they compose correctly across two independent `WorkflowEngine` instances sharing one database.
- [ ] **Step 3: Run the entire kernel + cli + shared suites once more**
Run: `pnpm --filter @agentos/shared test && pnpm --filter @agentos/kernel test && pnpm --filter @agentos/cli test`
Expected: `PASS`, no regressions from Tasks 1–12.
- [ ] **Step 4: Commit**
```
git add packages/kernel/test/workflow/engine.integration.test.ts
git commit -m "test(kernel): cover workflow restart-resume from running/waiting/sleeping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (W1 items, spec §§2, 3, 8, 9, 10):**
- §3.1 tables + additive migration — Task 2 (`CREATE TABLE IF NOT EXISTS` in `schema.sql`, the additive mechanism itself; no `ALTER`/`migrate()` needed for brand-new tables).
- §3.2 `WorkflowDefinition`/`WorkflowContext`/`StepOptions` exactly as specified, plus `step.run` spawning a kernel `Run` through `ProcessManager.runToCompletion` and recording `run_id` — Task 3 (types), Task 8 (`step.run` wiring), `run_id` recorded via `WorkflowStore.updateStep(row.id, { runId })`.
- §3.3 replay semantics (re-invoke `run()` from the top; completed steps return persisted output) — Task 4/5 (`step.do`'s `row?.status === 'succeeded'` short-circuit; every `context.test.ts` "replay" test builds a second `createWorkflowContext` against the same persisted instance to prove `fn` is not re-invoked); per-instance mutex — Task 6 (`inFlight` set keyed by instance id); `max_concurrent` from routines.yaml defaults (default 2) — Task 1 (`WorkflowsConfigSchema`), Task 9 (`WorkflowEngine.load`), Task 10 (kernel reads `routinesFile.workflows?.max_concurrent`); retries with exponential backoff — Task 4 (`backoffMs * 2 ** (attempt - 1)`); `waitForEvent` via matching persisted events with `timeoutMs` — Task 5; `sleep` with a 5s alarm timer — Task 5 (`stepSleep`), Task 7 (`tick()` on a 5s `setInterval`); pause/resume/terminate semantics (pause does not interrupt a running claude process; terminate kills the current step's run) — Task 9; resume-on-boot for `running`/`waiting`/`sleeping` — Task 7 (`start()`'s three `store.list` loops), proven end-to-end by Task 12.
- §3.4 API routes including `POST /api/workflows/:id/events` — Task 10.
- `EventType` gains `` `workflow.${string}` `` — Task 1.
- The `workflow.*` events with the payload fields listed (`workflowId`, `kind`, `project`, `step`, `seq`) — every `emitEvent`/`onStepEvent` call site across Tasks 4–9 passes `{ step, seq, ... }` as `extra`, merged with `{ workflowId, kind, project }` in `WorkflowEngine.emitEvent`; instance-level events (`created`/`succeeded`/`failed`/`paused`/`resumed`/`terminated`) correctly omit `step`/`seq` since they are not step-scoped.
- CLI `agentos workflows [list|show|pause|resume|terminate]` — Task 11.
- Engine unit tests listed in §9 (fake definition; replay; retries/backoff; waitForEvent match/timeout; sleep/alarm; pause blocks the next step; terminate kills the current run; restart-resume from every status) — Tasks 4, 5, 6, 7, 9, 12; a fake `claude` (`tools/fake-claude`) is used for the one `step.run` integration test in Task 8 exactly as the existing scheduler tests use it.
- Wired into `Kernel` (constructed in `createKernel`, started in `kernel.start()`, stopped in `kernel.stop()`) and a `workflows` block in `routines.yaml` defaults (`max_concurrent`) — Task 10.

**Out of scope for W1 (explicitly, per spec §10):** the `feature-request` workflow definition itself, its four skills, and the CLI `agentos request` command are W3. The Requests/Projects dashboard panels are W4. `packages/kernel/src/workflow/registry.ts` and `WorkflowEngine`'s `registry` are deliberately empty of any concrete definition at the end of W1 — `createKernel`'s `workflowDefinitions` parameter is the seam W3 plugs into, exercised in this plan only by test-local fake definitions.

**Placeholder scan:** no `TBD`/`TODO`/"similar to Task N" in any code block. The two stub methods that exist mid-plan (`step.sleep`/`step.waitForEvent`/`step.run` throwing `not implemented until Task N` in Task 4; `WorkflowEngine.start`/`stop` as no-ops in Task 6) are the same deliberate "fill in next task" pattern the M3 plan uses for `Scheduler.scheduleOnce`/`setEnabled`/`list` — each has a real interface, a real (if minimal) body, and a test in the *current* task proving its actual behavior, with the stub's error message naming exactly which later task completes it.

**Type consistency vs. the contract and spec:** `WorkflowDefinition<I>`/`WorkflowContext<I>`/`StepOptions` match spec §3.2 exactly, field-for-field. `WorkflowInstance`/`WorkflowStep` mirror the `workflows`/`workflow_steps` table columns from spec §3.1 one-to-one (camelCase, per the same convention `Run`/`Decision` already use in `EventLog`'s row mappers). `EventLog`'s eight new methods follow the exact same signature shape as the existing `createRun`/`updateRun`/`getRun`/`listRuns` and `createSchedule`/`dueSchedules`/`markScheduleFired` precedents (merge-existing-then-full-`UPDATE`, `Partial<T>` patches, `genId()`/`nowIso()` helpers). `WorkflowEngine`'s public surface (`create`, `get`, `list`, `steps`, `pause`, `resume`, `terminate`, `load`, `start`, `stop`) has no untyped `any` outside the two documented `biome-ignore` cases (`WorkflowRegistry`'s internal map, which is inherently kind-polymorphic like `AdapterHost`'s adapter registry; and the handful of "fetched immediately above, must exist" non-null assertions matching the existing `EventLog.createRun`/`updateRun` style).

## Contract additions

`EventLog` (`packages/kernel/src/log/eventLog.ts`) gains eight methods not listed in contract §4, required because the `workflows`/`workflow_steps` tables (new, this plan) need accessors, following the same pattern contract §10a already documents for the `schedules` table's three methods:
```ts
createWorkflow(w: { kind: string; project?: string; title: string; input: Record<string, unknown> }): WorkflowInstance
getWorkflow(id: string): WorkflowInstance | undefined
listWorkflows(opts?: { status?: WorkflowStatus; kind?: string; project?: string }): WorkflowInstance[]
updateWorkflow(id: string, patch: Partial<WorkflowInstance>): WorkflowInstance
createWorkflowStep(s: { workflowId: string; name: string; seq: number; status: WorkflowStepStatus; attempt?: number }): WorkflowStep
listWorkflowSteps(workflowId: string): WorkflowStep[]
updateWorkflowStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep
deleteWorkflowStep(id: string): void
```

`packages/kernel/src/workflow/{types,registry,store,context,engine}.ts` are new modules, not amendments to any existing contract file — their exact public surface is captured in this plan's "File structure" and per-task "Interfaces" lines rather than restated here.

`Kernel` (contract §4) gains one field and `createKernel` gains one parameter:
```ts
export interface Kernel {
  // ...existing fields...
  workflows: WorkflowEngine
}
export function createKernel(
  cfg: KernelConfig,
  registry?: Record<string, ProjectAdapter>,
  workflowDefinitions?: WorkflowDefinition[],
): Kernel
```

`RoutinesFile` (contract §3) gains one optional field, and `RoutineDefaults` is unchanged (the new `max_concurrent` setting is workflow-engine-wide, not per-routine, so it is a sibling of `defaults`/`routines`, not a member of `RoutineDefaults`):
```ts
export interface RoutinesFile {
  defaults: RoutineDefaults
  routines: RoutineConfig[]
  workflows?: { max_concurrent: number }
}
```

`EventType` (contract §3) gains one template-literal member: `` | `workflow.${string}` ``, alongside the existing `` | `custom.${string}` ``.

Consequences applied in this plan: `packages/kernel/src/index.ts` re-exports `workflow/types.js` and `workflow/engine.js` (Task 10) so `@agentos/kernel/adapters/types`'s existing subpath-export precedent did **not** need a new subpath — `WorkflowInstance`/`WorkflowStep`/`WorkflowStatus` live in `@agentos/shared` (imported directly by `packages/cli/src/client.ts`, matching how `Run`/`Decision` are imported there today) while only the kernel-internal authoring surface (`WorkflowDefinition`, `WorkflowContext`, `WorkflowEngine`) is re-exported from the package root, consumed by `packages/cli/test/workflows.command.test.ts` and by W3's future `createKernel(cfg, adapters, [featureRequestDefinition])` call.
