# Feature requests W4 — Requests panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dashboard's Requests panel — a "New request" form that starts a `feature-request` workflow, a list of workflow instances, and a `RequestView` detail pane with a live stepper, an inline stream of the active step's run, Pause/Resume/Terminate controls, and a Retry-from-failure path — wired entirely off the `workflow.*` events and `/api/workflows` routes W1 ships, plus an Overview "Requests in flight" stat and feed lines.

**Architecture:** Follows M5's established shape exactly: a typed `ApiClient` extension is the only way the UI calls `/api/workflows` and `/api/projects`, and `useEvents` is the only way it hears about change — no polling anywhere. `RequestsPanel` reuses the list-plus-reading-pane layout `DecisionsPanel` already established (`packages/dashboard/src/panels/DecisionsPanel.tsx`); `RequestView` reuses `RunStream`, `ConfirmSheet`, and `StatusBadge` the way `RunsPanel`/`DecisionCard` already do, rather than inventing new interaction patterns. A step's "active" run is shown as a single inline `RunStream` block beneath the stepper (not an expand/collapse per row) — this is the plan's concrete reading of spec §6's "active step expanded to show its `RunStream` inline". New pure logic (elapsed/cost/current-step derivation, `workflow.*` → feed classification) lives in `src/lib/workflow.ts` and an extension to the existing `src/lib/events.ts`, unit-tested without React, matching how `src/lib/time.ts` and `src/lib/proposal.ts` are already tested. **All row and API types (`WorkflowInstance`, `WorkflowStep`, `WorkflowStatus`, `WorkflowStepStatus`, `GetWorkflowResponse`, `CreateWorkflowRequest`, `CreateWorkflowResponse`, `ListWorkflowsQuery`, `DeliverWorkflowEventRequest`) are owned by W1 in `packages/shared/src/types/workflow.ts` / `packages/shared/src/types/api.ts` — this plan imports them, it does not define them.**

**Tech Stack:** No new runtime or dev dependencies. Reuses `react@^18`, `@testing-library/react`, `@testing-library/user-event`, `vitest`, `@playwright/test` already in `packages/dashboard`. One tooling-only addition: `better-sqlite3` (already pinned `^12` for `@agentos/kernel` per the contract) is added to the **root** `package.json` `devDependencies` so `tools/seed-workflow.mjs` can seed the e2e kernel's `workflows`/`workflow_steps` tables directly by SQL — see Task 9's rationale for why this avoids guessing at W1's `EventLog` method names.

**Spec:** `docs/superpowers/specs/2026-09-09-feature-requests-design.md` (this plan implements §6 Requests panel + Overview changes, the `RequestView` error row in §8, and the Requests-panel slice of the e2e in §9)
**Contract:** `docs/superpowers/plans/2026-09-08-agent-os-00-contract.md`
**Conventions:** `docs/superpowers/plans/2026-09-08-agent-os-m5-dashboard.md` (dashboard file layout, test patterns, mock-server shape)

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Biome is the single lint/format tool: single quotes, no semicolons, LF line endings (repo-wide `biome.json`, unchanged by this plan).
- Test runner: Vitest for units/components, Playwright for e2e. Tests live next to their source as `*.test.ts`/`*.test.tsx`, following every existing file under `packages/dashboard/src`.
- No new runtime dependencies for the dashboard bundle. The one tooling addition (Task 9) is a root-only devDependency already pinned by the contract for `@agentos/kernel`, not a new library.
- Design tokens only from `packages/dashboard/src/index.css` (`--color-*`, `.btn`/`.card`/`.chip`/`.tab`/`.skeleton`/`.prose-agentos` classes) — no inline hex colors, no ad-hoc Tailwind color utilities.
- `signal` (amber) is reserved for things that need a human. In this plan that means the `waiting` workflow status (parked on `waitForEvent('decision.resolved')`) — everything else uses `accent`/`success`/`danger`/`muted` per the existing convention.
- Every interactive control must be reachable by keyboard (native `button`/`select`/`input`/`textarea`/`label htmlFor`, no click-only `div`s) and every animation already respects `prefers-reduced-motion` via the global rule in `index.css` — nothing in this plan adds a new animation.
- No absolute local paths, hostnames, tokens, or secrets in any committed file.
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`); every commit message ends with the line:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
  (this is `agent-os`'s own contract convention — see contract §0 — and applies to every commit template below, independent of any other repo's attribution rules)

**Cross-milestone dependencies this plan assumes are already merged:**
- **W1** (`docs/superpowers/plans/2026-09-09-feature-requests-w1-workflow-engine.md`): the `workflows`/`workflow_steps` tables (spec §3.1), the `EventType` union in `packages/shared/src/types/event.ts` gaining a `` `workflow.${string}` `` member, and — the part this plan depends on directly — `packages/shared/src/types/workflow.ts` (`WorkflowStatus`, `WorkflowInstance`, `WorkflowStepStatus`, `WorkflowStep`) and the workflow additions to `packages/shared/src/types/api.ts` (`CreateWorkflowRequest`, `CreateWorkflowResponse`, `GetWorkflowResponse`, `ListWorkflowsQuery`, `DeliverWorkflowEventRequest`), plus the six live `/api/workflows*` routes (`packages/kernel/src/api/workflows.ts`). This plan imports every one of those names from `@agentos/shared` — it defines none of them. Task 3's event-classification test and Task 9's seed script both need the real schema and event type merged to run for real.
- **W3** (`docs/superpowers/plans/2026-09-09-feature-requests-w3-request-workflow.md`): the `feature-request` workflow definition, so a `POST /api/workflows { kind: 'feature-request', ... }` submitted through `NewRequestForm` does something once registered. **Open gap, flagged rather than silently resolved:** this plan imports `FeatureRequestInput` from `@agentos/shared` per direction from the team lead, but W3's plan as currently written (`docs/superpowers/plans/2026-09-09-feature-requests-w3-request-workflow.md:1719`) defines `FeatureRequestInput` only inside `packages/kernel/src/workflow/definitions/featureRequest.ts` — not re-exported from `packages/shared`. Task 1 below still imports it from `@agentos/shared` as instructed; W3 needs a corresponding revision (move or re-export the interface from `packages/shared/src/types/workflow.ts`) for this plan's import to compile. Until that lands, Task 5's `NewRequestForm` type-checking is blocked on that one name — everything else in this plan (all the `WorkflowInstance`/`WorkflowStep`/`GetWorkflowResponse`/etc. imports) is unaffected, since those are confirmed already in W1's shared file.
- **W2** (GitHub projects, nav slot 8): `NewRequestForm`'s project picker calls `GET /api/projects`, which is W2's route. This plan adds the client method and mock/e2e fixtures needed to build and test independently of W2's landing order; in a tree without W2 merged yet, the picker will show an `ErrorState` until it does. The nav insertion in Task 8 is written as an array append, not a fixed index, so it does not conflict with PR #6 (Messages, already present in `App.tsx`'s `NAV` array as of this writing) or with W2's own Projects entry landing before or after this one.

---

## File structure

```
packages/dashboard/src/api/client.ts         # MODIFIED: workflow + project ApiClient methods
packages/dashboard/src/api/client.test.ts    # MODIFIED: tests for the new methods
packages/dashboard/tests/mockServer.ts       # MODIFIED: workflow/step/project fixtures + routes

packages/dashboard/src/lib/workflow.ts       # NEW: elapsed/cost/current-step derivation, event helpers
packages/dashboard/src/lib/workflow.test.ts  # NEW

packages/dashboard/src/lib/events.ts         # MODIFIED: classifyEvent/describeEvent for workflow.*
packages/dashboard/src/lib/events.test.ts    # MODIFIED

packages/dashboard/src/components/StatusBadge.tsx       # MODIFIED: colors for the four new statuses
packages/dashboard/src/components/StatusBadge.test.tsx  # NEW
packages/dashboard/src/components/WorkflowStepper.tsx        # NEW
packages/dashboard/src/components/WorkflowStepper.test.tsx   # NEW
packages/dashboard/src/components/NewRequestForm.tsx          # NEW
packages/dashboard/src/components/NewRequestForm.test.tsx     # NEW
packages/dashboard/src/components/RequestView.tsx             # NEW
packages/dashboard/src/components/RequestView.test.tsx        # NEW
packages/dashboard/src/components/RunStream.tsx               # MODIFIED: optional showClose prop for inline embedding
packages/dashboard/src/panels/RequestsPanel.tsx                # NEW
packages/dashboard/src/panels/RequestsPanel.test.tsx           # NEW

packages/dashboard/src/App.tsx                # MODIFIED: nav entry + route for Requests
packages/dashboard/src/App.test.tsx           # MODIFIED
packages/dashboard/src/components/Icon.tsx    # MODIFIED: 'requests' icon
packages/dashboard/src/panels/OverviewPanel.tsx        # MODIFIED: "Requests in flight" stat
packages/dashboard/src/panels/OverviewPanel.test.tsx   # MODIFIED

tools/seed-workflow.mjs                       # NEW: seeds one running feature-request instance for e2e
tools/e2e-kernel.mjs                          # MODIFIED: calls seedWorkflow
packages/dashboard/e2e/dashboard.spec.ts      # MODIFIED: Requests-panel e2e test
package.json                                  # MODIFIED: root devDependency on better-sqlite3
```

Note: **no file under `packages/shared/` is created or modified by this plan.** `packages/shared/src/types/workflow.ts` and the workflow additions to `packages/shared/src/types/api.ts` are entirely W1's, already defined by the time this plan's Task 1 runs. This plan only imports from `@agentos/shared`.

---

### Task 1: `ApiClient` methods + mock fixtures, against W1's shared types

**Files:**
- Modify: `packages/dashboard/src/api/client.ts`
- Modify: `packages/dashboard/src/api/client.test.ts`
- Modify: `packages/dashboard/tests/mockServer.ts`

**Interfaces:**
- Consumes (all from `@agentos/shared`, defined by W1 — see `docs/superpowers/plans/2026-09-09-feature-requests-w1-workflow-engine.md` Task 1 and its route handlers in `packages/kernel/src/api/workflows.ts`):
```ts
type WorkflowStatus = 'queued' | 'running' | 'waiting' | 'sleeping' | 'paused' | 'succeeded' | 'failed' | 'terminated'
interface WorkflowInstance {
  id: string; kind: string; status: WorkflowStatus; project?: string; title: string
  input: Record<string, unknown>; state: Record<string, unknown>
  currentStep?: string; wakeAt?: string; waitEvent?: string; error?: string
  createdAt: string; startedAt?: string; endedAt?: string; updatedAt: string
}
type WorkflowStepStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting' | 'sleeping'
interface WorkflowStep {
  id: string; workflowId: string; name: string; seq: number; status: WorkflowStepStatus; attempt: number
  runId?: string; output?: unknown; error?: string; startedAt: string; endedAt?: string
}
interface CreateWorkflowRequest { kind: string; project?: string; title?: string; input: Record<string, unknown> }
interface CreateWorkflowResponse { workflowId: string }
interface GetWorkflowResponse { workflow: WorkflowInstance; steps: WorkflowStep[] }
interface ListWorkflowsQuery { status?: WorkflowStatus; project?: string; kind?: string }
interface DeliverWorkflowEventRequest { type: string; payload?: Record<string, unknown> }
```
  and, from spec §4.2 (W2's `GET /api/projects` route), the already-shared `ProjectConfig`.
- Produces (used by every later task) — note `pauseWorkflow`/`resumeWorkflow`/`terminateWorkflow` return the **updated `WorkflowInstance`**, exactly matching what `packages/kernel/src/api/workflows.ts` sends back (`return engine.pause(id)` etc., all typed `Promise<WorkflowInstance>` on the engine), and `sendWorkflowEvent` returns `{ id: number }`, matching that route's `reply.code(202).send({ id: event.id })`:
```ts
listWorkflows(opts?: ListWorkflowsQuery): Promise<WorkflowInstance[]>
getWorkflow(id: string): Promise<GetWorkflowResponse>
createWorkflow(body: CreateWorkflowRequest): Promise<CreateWorkflowResponse>
pauseWorkflow(id: string): Promise<WorkflowInstance>
resumeWorkflow(id: string): Promise<WorkflowInstance>
terminateWorkflow(id: string): Promise<WorkflowInstance>
sendWorkflowEvent(id: string, event: DeliverWorkflowEventRequest): Promise<{ id: number }>
listProjects(): Promise<ProjectConfig[]>
```

- [ ] **Step 1: Write the failing client test**

  Append to `packages/dashboard/src/api/client.test.ts`:
  ```ts
  it('lists, creates, and controls workflows', async () => {
    const client = new ApiClient()
    const workflows = await client.listWorkflows()
    expect(workflows).toEqual([fixtures.workflow])
    const detail = await client.getWorkflow('wf_1')
    expect(detail.steps).toEqual(fixtures.workflowSteps)
    const created = await client.createWorkflow({
      kind: 'feature-request',
      project: 'techpulse',
      title: 'Add a widget',
      input: {
        project: 'techpulse',
        title: 'Add a widget',
        description: 'A short description.',
        autoApprove: true,
      },
    })
    expect(created.workflowId).toBe('wf_2')
    expect(await client.pauseWorkflow('wf_1')).toMatchObject({ status: 'paused' })
    expect(await client.resumeWorkflow('wf_1')).toMatchObject({ status: 'running' })
    expect(await client.terminateWorkflow('wf_1')).toMatchObject({ status: 'terminated' })
    expect(
      await client.sendWorkflowEvent('wf_1', {
        type: 'decision.resolved',
        payload: { status: 'approved' },
      }),
    ).toEqual({ id: 2 })
  })

  it('lists projects', async () => {
    const client = new ApiClient()
    const projects = await client.listProjects()
    expect(projects).toEqual([fixtures.project])
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`ApiClient` has no `listWorkflows`/`listProjects`, `fixtures.workflow`/`fixtures.project` don't exist).

- [ ] **Step 2: Extend `ApiClient`**

  In `packages/dashboard/src/api/client.ts`, widen the type import — everything workflow-related comes from `@agentos/shared`, nothing is declared locally:
  ```ts
  import type {
    CreateWorkflowRequest,
    CreateWorkflowResponse,
    Decision,
    DecisionStatus,
    DeliverWorkflowEventRequest,
    EvalCriteria,
    Event,
    GetWorkflowResponse,
    ListWorkflowsQuery,
    Message,
    ProjectConfig,
    RoutineConfig,
    Run,
    RunStatus,
    SkillMeta,
    WorkflowInstance,
  } from '@agentos/shared'
  ```
  Add to the `ApiClient` class body (after `messages(...)`):
  ```ts
    listWorkflows(opts: ListWorkflowsQuery = {}) {
      const qs = new URLSearchParams(opts as Record<string, string>).toString()
      return this.req<WorkflowInstance[]>(
        'GET',
        `/api/workflows${qs ? `?${qs}` : ''}`,
      )
    }
    getWorkflow(id: string) {
      return this.req<GetWorkflowResponse>('GET', `/api/workflows/${id}`)
    }
    createWorkflow(body: CreateWorkflowRequest) {
      return this.req<CreateWorkflowResponse>('POST', '/api/workflows', body)
    }
    pauseWorkflow(id: string) {
      return this.req<WorkflowInstance>('POST', `/api/workflows/${id}/pause`)
    }
    resumeWorkflow(id: string) {
      return this.req<WorkflowInstance>('POST', `/api/workflows/${id}/resume`)
    }
    terminateWorkflow(id: string) {
      return this.req<WorkflowInstance>('POST', `/api/workflows/${id}/terminate`)
    }
    sendWorkflowEvent(id: string, event: DeliverWorkflowEventRequest) {
      return this.req<{ id: number }>(
        'POST',
        `/api/workflows/${id}/events`,
        event,
      )
    }

    listProjects() {
      return this.req<ProjectConfig[]>('GET', '/api/projects')
    }
  ```
  No new interfaces are declared in this file — `GetWorkflowResponse` etc. are used directly from the `@agentos/shared` import.

- [ ] **Step 3: Add fixtures and routes to the mock server**

  In `packages/dashboard/tests/mockServer.ts`, widen the type import:
  ```ts
  import type {
    Decision,
    Event,
    Message,
    ProjectConfig,
    RoutineConfig,
    Run,
    SkillMeta,
    WorkflowInstance,
    WorkflowStep,
  } from '@agentos/shared'
  ```
  Add to `fixtures` — every `WorkflowStep` includes `startedAt`, which W1's type requires (a step row is only ever created once it starts):
  ```ts
    workflow: {
      id: 'wf_1',
      kind: 'feature-request',
      status: 'running',
      project: 'techpulse',
      title: 'Add a personalized company digest',
      input: {
        project: 'techpulse',
        title: 'Add a personalized company digest',
        description: 'Summarize the week per company the user follows.',
        autoApprove: true,
      },
      state: { brief: { costUsd: 0.08 } },
      currentStep: 'build',
      createdAt: '2026-09-08T00:00:00Z',
      startedAt: '2026-09-08T00:00:00Z',
      updatedAt: '2026-09-08T00:05:00Z',
    } satisfies WorkflowInstance,
    workflowSteps: [
      {
        id: 'wfs_1',
        workflowId: 'wf_1',
        name: 'brief',
        seq: 1,
        status: 'succeeded',
        attempt: 1,
        output: { costUsd: 0.08 },
        startedAt: '2026-09-08T00:00:00Z',
        endedAt: '2026-09-08T00:01:00Z',
      },
      {
        id: 'wfs_2',
        workflowId: 'wf_1',
        name: 'build',
        seq: 2,
        status: 'running',
        attempt: 1,
        runId: 'run_1',
        startedAt: '2026-09-08T00:01:00Z',
      },
    ] satisfies WorkflowStep[],
    project: {
      name: 'techpulse',
      adapter: 'techpulse-coo',
      repo: 'ductringuyen-0618/techpulse',
      clone: '/clones/techpulse',
      base_branch: 'main',
      options: {},
    } satisfies ProjectConfig,
  ```
  Add to the `routes` object in `installMockFetch` — `pause`/`resume`/`terminate` answer with the updated instance (matching `packages/kernel/src/api/workflows.ts`'s `return engine.pause(id)` etc.), and `events` answers with `{ id }` (matching `reply.code(202).send({ id: event.id })`):
  ```ts
      'GET /api/workflows': () => [fixtures.workflow],
      'GET /api/workflows/wf_1': () => ({
        workflow: fixtures.workflow,
        steps: fixtures.workflowSteps,
      }),
      'POST /api/workflows': () => ({ workflowId: 'wf_2' }),
      'POST /api/workflows/wf_1/pause': () => ({
        ...fixtures.workflow,
        status: 'paused',
      }),
      'POST /api/workflows/wf_1/resume': () => ({
        ...fixtures.workflow,
        status: 'running',
      }),
      'POST /api/workflows/wf_1/terminate': () => ({
        ...fixtures.workflow,
        status: 'terminated',
      }),
      'POST /api/workflows/wf_1/events': () => ({ id: 2 }),
      'GET /api/projects': () => [fixtures.project],
  ```

- [ ] **Step 4: Run tests, verify pass**

  Run: `pnpm --filter @agentos/dashboard test` — PASS (all existing tests still pass; 2 new tests pass).

- [ ] **Step 5: Commit**
  ```bash
  git add packages/dashboard/src/api/client.ts packages/dashboard/src/api/client.test.ts packages/dashboard/tests/mockServer.ts
  git commit -m "feat(dashboard): add ApiClient workflow/project methods against W1's shared types

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 2: `lib/workflow.ts` — elapsed/cost/current-step derivation

**Files:**
- Create: `packages/dashboard/src/lib/workflow.ts`
- Create: `packages/dashboard/src/lib/workflow.test.ts`

**Interfaces:**
- Consumes: `WorkflowInstance`, `WorkflowStep`, `WorkflowStatus`, `Event` from `@agentos/shared` (W1).
- Produces (used by `WorkflowStepper`, `RequestView`, `RequestsPanel`, `OverviewPanel`):
```ts
export const IN_FLIGHT_STATUSES: WorkflowStatus[]
export function isInFlight(status: WorkflowStatus): boolean
export function isTerminal(status: WorkflowStatus): boolean
export function elapsedMs(workflow: WorkflowInstance, now: number): number
export function workflowCostUsd(workflow: WorkflowInstance): number
export function stepCostUsd(step: WorkflowStep): number
export function totalStepCostUsd(steps: WorkflowStep[]): number
export function currentStepIndex(workflow: WorkflowInstance, steps: WorkflowStep[]): number
export function workflowIdOf(e: Event): string | undefined
export function isWorkflowEvent(e: Event): boolean
```

- [ ] **Step 1: Write the failing test**

  `packages/dashboard/src/lib/workflow.test.ts`:
  ```ts
  import type { Event, WorkflowInstance, WorkflowStep } from '@agentos/shared'
  import { describe, expect, it } from 'vitest'
  import {
    currentStepIndex,
    elapsedMs,
    isInFlight,
    isTerminal,
    isWorkflowEvent,
    stepCostUsd,
    totalStepCostUsd,
    workflowCostUsd,
    workflowIdOf,
  } from './workflow'

  function wf(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
    return {
      id: 'wf_1',
      kind: 'feature-request',
      status: 'running',
      title: 'Add dark mode',
      input: {},
      state: {},
      createdAt: '2026-09-09T10:00:00Z',
      updatedAt: '2026-09-09T10:00:00Z',
      ...overrides,
    }
  }

  describe('elapsedMs', () => {
    it('counts from startedAt to endedAt', () => {
      const w = wf({
        startedAt: '2026-09-09T10:00:00Z',
        endedAt: '2026-09-09T10:00:30Z',
      })
      expect(elapsedMs(w, Date.now())).toBe(30_000)
    })
    it('counts up to now while still open', () => {
      const now = Date.parse('2026-09-09T10:01:00Z')
      expect(elapsedMs(wf({ startedAt: '2026-09-09T10:00:00Z' }), now)).toBe(
        60_000,
      )
    })
    it('is zero before the instance starts', () => {
      expect(elapsedMs(wf(), Date.now())).toBe(0)
    })
  })

  describe('workflowCostUsd', () => {
    it('sums costUsd across every value stored in state', () => {
      const w = wf({
        state: { brief: { costUsd: 0.12 }, build: { costUsd: 0.5, branch: 'req/x' } },
      })
      expect(workflowCostUsd(w)).toBeCloseTo(0.62)
    })
    it('ignores state entries with no cost', () => {
      expect(workflowCostUsd(wf({ state: { note: 'hi' } }))).toBe(0)
    })
  })

  describe('step cost helpers', () => {
    const steps: WorkflowStep[] = [
      {
        id: 's1',
        workflowId: 'wf_1',
        name: 'brief',
        seq: 1,
        status: 'succeeded',
        attempt: 1,
        output: { costUsd: 0.1 },
        startedAt: '2026-09-09T10:00:00Z',
      },
      {
        id: 's2',
        workflowId: 'wf_1',
        name: 'build',
        seq: 2,
        status: 'running',
        attempt: 1,
        startedAt: '2026-09-09T10:01:00Z',
      },
    ]
    it('reads cost from a single step output', () => {
      expect(stepCostUsd(steps[0])).toBe(0.1)
      expect(stepCostUsd(steps[1])).toBe(0)
    })
    it('sums cost across steps', () => {
      expect(totalStepCostUsd(steps)).toBe(0.1)
    })
  })

  describe('currentStepIndex', () => {
    const steps: WorkflowStep[] = [
      { id: 's1', workflowId: 'wf_1', name: 'brief', seq: 1, status: 'succeeded', attempt: 1, startedAt: '2026-09-09T10:00:00Z' },
      { id: 's2', workflowId: 'wf_1', name: 'build', seq: 2, status: 'running', attempt: 1, startedAt: '2026-09-09T10:01:00Z' },
    ]
    it('finds the step named by workflow.currentStep', () => {
      expect(currentStepIndex(wf({ currentStep: 'build' }), steps)).toBe(1)
    })
    it('returns -1 when nothing is current', () => {
      expect(currentStepIndex(wf(), steps)).toBe(-1)
    })
  })

  describe('isInFlight / isTerminal', () => {
    it('classifies every status exactly once', () => {
      expect(isInFlight('running')).toBe(true)
      expect(isInFlight('waiting')).toBe(true)
      expect(isInFlight('succeeded')).toBe(false)
      expect(isTerminal('succeeded')).toBe(true)
      expect(isTerminal('failed')).toBe(true)
      expect(isTerminal('terminated')).toBe(true)
      expect(isTerminal('running')).toBe(false)
    })
  })

  describe('workflow event helpers', () => {
    it('reads workflowId from the event payload', () => {
      const e: Event = {
        id: 1,
        ts: 't',
        type: 'workflow.step.started',
        payload: { workflowId: 'wf_1', kind: 'feature-request', step: 'build', seq: 4 },
      }
      expect(workflowIdOf(e)).toBe('wf_1')
      expect(isWorkflowEvent(e)).toBe(true)
      expect(isWorkflowEvent({ ...e, type: 'run.started' })).toBe(false)
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`./workflow` module doesn't exist; requires W1's `EventType` gaining `` `workflow.${string}` `` and `@agentos/shared` exporting `WorkflowInstance`/`WorkflowStep`, both assumed merged per this plan's dependency note).

- [ ] **Step 2: Implement**

  `packages/dashboard/src/lib/workflow.ts`:
  ```ts
  import type {
    Event,
    WorkflowInstance,
    WorkflowStatus,
    WorkflowStep,
  } from '@agentos/shared'

  /** Every status the engine has not yet finished with — still "in flight". */
  export const IN_FLIGHT_STATUSES: WorkflowStatus[] = [
    'queued',
    'running',
    'waiting',
    'sleeping',
    'paused',
  ]

  export function isInFlight(status: WorkflowStatus): boolean {
    return IN_FLIGHT_STATUSES.includes(status)
  }

  /** True once the instance has ended, one way or another. */
  export function isTerminal(status: WorkflowStatus): boolean {
    return status === 'succeeded' || status === 'failed' || status === 'terminated'
  }

  /** Wall-clock time the instance has run, counting up to `now` while open. */
  export function elapsedMs(workflow: WorkflowInstance, now: number): number {
    if (!workflow.startedAt) return 0
    const start = Date.parse(workflow.startedAt)
    const end = workflow.endedAt ? Date.parse(workflow.endedAt) : now
    if (Number.isNaN(start) || Number.isNaN(end)) return 0
    return Math.max(0, end - start)
  }

  function costFromValue(value: unknown): number {
    if (value && typeof value === 'object' && 'costUsd' in value) {
      const c = (value as { costUsd?: unknown }).costUsd
      if (typeof c === 'number' && !Number.isNaN(c)) return c
    }
    return 0
  }

  /**
   * Sum of every step's recorded cost, read from the instance's own working
   * memory (`workflow.state`, which the engine keys by step name per spec
   * §3.1). Works from the list endpoint alone — no per-instance steps fetch.
   */
  export function workflowCostUsd(workflow: WorkflowInstance): number {
    return Object.values(workflow.state ?? {}).reduce(
      (sum, v) => sum + costFromValue(v),
      0,
    )
  }

  /** A single step's own cost, from its persisted `step.run` output. */
  export function stepCostUsd(step: WorkflowStep): number {
    return costFromValue(step.output)
  }

  export function totalStepCostUsd(steps: WorkflowStep[]): number {
    return steps.reduce((sum, s) => sum + stepCostUsd(s), 0)
  }

  /** Index into `steps` of the step named by `workflow.currentStep`, or -1. */
  export function currentStepIndex(
    workflow: WorkflowInstance,
    steps: WorkflowStep[],
  ): number {
    if (!workflow.currentStep) return -1
    return steps.findIndex((s) => s.name === workflow.currentStep)
  }

  /** `payload.workflowId` for any `workflow.*` event, per spec §3.3. */
  export function workflowIdOf(e: Event): string | undefined {
    const id = (e.payload as { workflowId?: unknown }).workflowId
    return typeof id === 'string' ? id : undefined
  }

  export function isWorkflowEvent(e: Event): boolean {
    return e.type.startsWith('workflow.')
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add packages/dashboard/src/lib/workflow.ts packages/dashboard/src/lib/workflow.test.ts
  git commit -m "feat(dashboard): add workflow elapsed/cost/current-step derivation helpers

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 3: `lib/events.ts` — classify and describe `workflow.*` events

**Files:**
- Modify: `packages/dashboard/src/lib/events.ts`
- Modify: `packages/dashboard/src/lib/events.test.ts`

**Interfaces:**
- Consumes: `classifyEvent(type: string): EventKind`, `describeEvent(e: Event): string` (both already exist; `Event`'s `type` field is W1's widened `EventType`, unaffected by this plan otherwise).
- Produces: the same two functions now handle every `workflow.*` type, classified as `EventKind = 'run'` (machine-acting color, per the brief) with one plain-sentence description each.

- [ ] **Step 1: Write the failing test**

  Append to `packages/dashboard/src/lib/events.test.ts`:
  ```ts
  describe('workflow events', () => {
    it('classifies every workflow.* event as run (machine acting)', () => {
      expect(classifyEvent('workflow.created')).toBe('run')
      expect(classifyEvent('workflow.step.started')).toBe('run')
      expect(classifyEvent('workflow.step.failed')).toBe('run')
      expect(classifyEvent('workflow.succeeded')).toBe('run')
    })

    it('writes one plain sentence per workflow event', () => {
      expect(
        describeEvent(ev('workflow.created', { title: 'Add dark mode' })),
      ).toBe('Request started: Add dark mode')
      expect(describeEvent(ev('workflow.step.started', { step: 'build' }))).toBe(
        'build started',
      )
      expect(describeEvent(ev('workflow.step.succeeded', { step: 'build' }))).toBe(
        'build finished',
      )
      expect(describeEvent(ev('workflow.step.failed', { step: 'validate' }))).toBe(
        'validate failed',
      )
      expect(
        describeEvent(ev('workflow.waiting', { step: 'await-approval' })),
      ).toBe('Waiting on await-approval')
      expect(describeEvent(ev('workflow.resumed', {}))).toBe('Request resumed')
      expect(describeEvent(ev('workflow.paused', {}))).toBe('Request paused')
      expect(describeEvent(ev('workflow.succeeded', {}))).toBe(
        'Request completed',
      )
      expect(describeEvent(ev('workflow.failed', { step: 'validate' }))).toBe(
        'Request failed at validate',
      )
      expect(describeEvent(ev('workflow.terminated', {}))).toBe(
        'Request terminated',
      )
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`classifyEvent`/`describeEvent` fall through to their generic `'memory'`/`type.replace('.', ' ')` branches for `workflow.*` today; `ev('workflow.created', ...)`'s literal type also requires W1's `` `workflow.${string}` `` `EventType` member to be merged).

- [ ] **Step 2: Implement**

  In `packages/dashboard/src/lib/events.ts`, extend `classifyEvent`:
  ```ts
  export function classifyEvent(type: string): EventKind {
    if (type === 'run.failed' || type === 'ops.alert') return 'alert'
    if (type === 'security.redacted') return 'alert'
    if (type.startsWith('run.')) return 'run'
    if (type.startsWith('workflow.')) return 'run'
    if (type.startsWith('decision.')) return 'human'
    if (type.startsWith('git.')) return 'git'
    return 'memory'
  }
  ```
  Extend the `switch` in `describeEvent` — add these cases before `default`:
  ```ts
      case 'workflow.created':
        return `Request started: ${str(p.title) ?? str(p.kind) ?? 'a feature request'}`
      case 'workflow.step.started':
        return `${str(p.step) ?? 'a step'} started`
      case 'workflow.step.succeeded':
        return `${str(p.step) ?? 'a step'} finished`
      case 'workflow.step.failed':
        return `${str(p.step) ?? 'a step'} failed`
      case 'workflow.waiting':
        return `Waiting on ${str(p.step) ?? 'an event'}`
      case 'workflow.resumed':
        return 'Request resumed'
      case 'workflow.paused':
        return 'Request paused'
      case 'workflow.succeeded':
        return 'Request completed'
      case 'workflow.failed':
        return `Request failed${str(p.step) ? ` at ${str(p.step)}` : ''}`
      case 'workflow.terminated':
        return 'Request terminated'
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add packages/dashboard/src/lib/events.ts packages/dashboard/src/lib/events.test.ts
  git commit -m "feat(dashboard): classify and describe workflow.* events in the activity feed

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 4: `StatusBadge` colors + `WorkflowStepper`

**Files:**
- Modify: `packages/dashboard/src/components/StatusBadge.tsx`
- Create: `packages/dashboard/src/components/StatusBadge.test.tsx`
- Create: `packages/dashboard/src/components/WorkflowStepper.tsx`
- Create: `packages/dashboard/src/components/WorkflowStepper.test.tsx`

**Interfaces:**
- Consumes: `WorkflowStep` (`@agentos/shared`, W1), `stepCostUsd` (Task 2), `duration`/`usd` (`src/lib/time.ts`, existing).
- Produces: `export function WorkflowStepper(props: { steps: WorkflowStep[]; now?: number }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

  `packages/dashboard/src/components/StatusBadge.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import { describe, expect, it } from 'vitest'
  import { StatusBadge } from './StatusBadge'

  describe('StatusBadge', () => {
    it('marks a request waiting on a human as signal amber', () => {
      render(<StatusBadge status="waiting" />)
      expect(screen.getByText('waiting')).toHaveClass('text-signal')
    })
    it('marks a finished request success-green and a terminated one danger-red', () => {
      const { rerender } = render(<StatusBadge status="succeeded" />)
      expect(screen.getByText('succeeded')).toHaveClass('text-success')
      rerender(<StatusBadge status="terminated" />)
      expect(screen.getByText('terminated')).toHaveClass('text-danger')
    })
    it('marks a paused or sleeping request muted, not urgent', () => {
      const { rerender } = render(<StatusBadge status="paused" />)
      expect(screen.getByText('paused')).toHaveClass('text-muted')
      rerender(<StatusBadge status="sleeping" />)
      expect(screen.getByText('sleeping')).toHaveClass('text-muted')
    })
  })
  ```

  `packages/dashboard/src/components/WorkflowStepper.test.tsx`:
  ```tsx
  import type { WorkflowStep } from '@agentos/shared'
  import { render, screen } from '@testing-library/react'
  import { describe, expect, it } from 'vitest'
  import { WorkflowStepper } from './WorkflowStepper'

  const steps: WorkflowStep[] = [
    {
      id: 's2',
      workflowId: 'wf_1',
      name: 'build',
      seq: 2,
      status: 'running',
      attempt: 2,
      startedAt: '2026-09-09T10:01:00Z',
    },
    {
      id: 's1',
      workflowId: 'wf_1',
      name: 'brief',
      seq: 1,
      status: 'succeeded',
      attempt: 1,
      startedAt: '2026-09-09T10:00:00Z',
      endedAt: '2026-09-09T10:00:40Z',
      output: { costUsd: 0.15 },
    },
  ]

  describe('WorkflowStepper', () => {
    it('orders steps by seq and shows status, retries, duration, and cost', () => {
      const now = Date.parse('2026-09-09T10:02:00Z')
      render(<WorkflowStepper steps={steps} now={now} />)
      const rows = screen.getAllByRole('listitem')
      expect(rows[0]).toHaveTextContent('brief')
      expect(rows[0]).toHaveTextContent('40 s')
      expect(rows[0]).toHaveTextContent('$0.15')
      expect(rows[1]).toHaveTextContent('build')
      expect(rows[1]).toHaveTextContent('retry 2')
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (new statuses aren't colored; `WorkflowStepper` doesn't exist).

- [ ] **Step 2: Implement**

  In `packages/dashboard/src/components/StatusBadge.tsx`, replace the `COLORS` map with:
  ```tsx
  const COLORS: Record<string, string> = {
    idle: 'text-muted',
    working: 'text-accent',
    blocked: 'text-danger',
    queued: 'text-muted',
    running: 'text-accent',
    wrapping_up: 'text-warn',
    success: 'text-success',
    failed: 'text-danger',
    killed: 'text-danger',
    pending: 'text-signal',
    approved: 'text-success',
    rejected: 'text-danger',
    error: 'text-danger',
    waiting: 'text-signal',
    sleeping: 'text-muted',
    paused: 'text-muted',
    succeeded: 'text-success',
    terminated: 'text-danger',
  }
  ```
  (Everything else in the file — `LIVE`, the component body — is unchanged.)

  `packages/dashboard/src/components/WorkflowStepper.tsx`:
  ```tsx
  import type { WorkflowStep } from '@agentos/shared'
  import { duration, usd } from '../lib/time'
  import { stepCostUsd } from '../lib/workflow'
  import { StatusBadge } from './StatusBadge'

  /**
   * One row per step, in seq order: status, name, retry count, how long it
   * took (or has been taking), and what it cost.
   */
  export function WorkflowStepper({
    steps,
    now = Date.now(),
  }: {
    steps: WorkflowStep[]
    now?: number
  }) {
    const ordered = [...steps].sort((a, b) => a.seq - b.seq)
    return (
      <ol className="flex flex-col">
        {ordered.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0"
          >
            <StatusBadge status={s.status} />
            <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
            {s.attempt > 1 && (
              <span className="text-xs text-warn">retry {s.attempt}</span>
            )}
            <span className="font-mono text-xs text-muted">
              {duration(s.startedAt, s.endedAt, now)}
            </span>
            <span className="font-mono text-xs text-muted">
              {usd(stepCostUsd(s))}
            </span>
          </li>
        ))}
      </ol>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add packages/dashboard/src/components/StatusBadge.tsx packages/dashboard/src/components/StatusBadge.test.tsx packages/dashboard/src/components/WorkflowStepper.tsx packages/dashboard/src/components/WorkflowStepper.test.tsx
  git commit -m "feat(dashboard): color workflow statuses and add WorkflowStepper

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 5: `NewRequestForm`

**Files:**
- Create: `packages/dashboard/src/components/NewRequestForm.tsx`
- Create: `packages/dashboard/src/components/NewRequestForm.test.tsx`

**Interfaces:**
- Consumes: `ProjectConfig`, `FeatureRequestInput` (`@agentos/shared` — see the open W3 gap noted in Global Constraints), `ApiClient.createWorkflow` (Task 1, takes W1's `CreateWorkflowRequest`), `useToast` (`src/components/Toast.tsx`, existing).
- Produces: `export function NewRequestForm(props: { projects: ProjectConfig[]; onCreated: (workflowId: string) => void; onCancel?: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

  `packages/dashboard/src/components/NewRequestForm.test.tsx`:
  ```tsx
  import type { ProjectConfig } from '@agentos/shared'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { describe, expect, it, vi } from 'vitest'
  import { installMockFetch } from '../../tests/mockServer'
  import { NewRequestForm } from './NewRequestForm'
  import { ToastProvider } from './Toast'

  const projects: ProjectConfig[] = [
    {
      name: 'techpulse',
      adapter: 'techpulse-coo',
      repo: 'me/techpulse',
      clone: '/clones/techpulse',
      base_branch: 'main',
      options: {},
    },
  ]

  describe('NewRequestForm', () => {
    it('rejects submission with a blank title', async () => {
      installMockFetch()
      const onCreated = vi.fn()
      render(
        <ToastProvider>
          <NewRequestForm projects={projects} onCreated={onCreated} />
        </ToastProvider>,
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Start request' }),
      )
      expect(
        screen.getByText('Give the request a short title.'),
      ).toBeInTheDocument()
      expect(onCreated).not.toHaveBeenCalled()
    })

    it('starts a request and reports the new workflow id', async () => {
      installMockFetch()
      const onCreated = vi.fn()
      render(
        <ToastProvider>
          <NewRequestForm projects={projects} onCreated={onCreated} />
        </ToastProvider>,
      )
      await userEvent.type(
        screen.getByLabelText('Title'),
        'Add a personalized company digest',
      )
      await userEvent.type(
        screen.getByLabelText('Description'),
        'Summarize the week per company the user follows.',
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Start request' }),
      )
      expect(
        await screen.findByText(/Request started: Add a personalized/),
      ).toBeInTheDocument()
      expect(onCreated).toHaveBeenCalledWith('wf_2')
    })

    it('shows a toast when the request fails to start', async () => {
      installMockFetch({
        'POST /api/workflows': () => {
          throw new Error('boom')
        },
      })
      render(
        <ToastProvider>
          <NewRequestForm projects={projects} onCreated={() => {}} />
        </ToastProvider>,
      )
      await userEvent.type(screen.getByLabelText('Title'), 'Add a widget')
      await userEvent.type(
        screen.getByLabelText('Description'),
        'A short description.',
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Start request' }),
      )
      expect(
        await screen.findByText(/Failed to start the request/),
      ).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`./NewRequestForm` doesn't exist).

- [ ] **Step 2: Implement**

  `packages/dashboard/src/components/NewRequestForm.tsx`:
  ```tsx
  import type { FeatureRequestInput, ProjectConfig } from '@agentos/shared'
  import { type FormEvent, useState } from 'react'
  import { ApiClient, ApiError } from '../api/client'
  import { useToast } from './Toast'

  const client = new ApiClient()

  export function NewRequestForm({
    projects,
    onCreated,
    onCancel,
  }: {
    projects: ProjectConfig[]
    onCreated: (workflowId: string) => void
    onCancel?: () => void
  }) {
    const [project, setProject] = useState(projects[0]?.name ?? '')
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [autoApprove, setAutoApprove] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const { push } = useToast()

    async function submit(e: FormEvent) {
      e.preventDefault()
      if (!project) {
        setError('Pick a project.')
        return
      }
      if (!title.trim()) {
        setError('Give the request a short title.')
        return
      }
      if (!description.trim()) {
        setError('Describe what you want built.')
        return
      }
      setError(null)
      setBusy(true)
      const trimmedTitle = title.trim()
      const input: FeatureRequestInput = {
        project,
        title: trimmedTitle,
        description: description.trim(),
        autoApprove,
      }
      try {
        const { workflowId } = await client.createWorkflow({
          kind: 'feature-request',
          project,
          title: trimmedTitle,
          input,
        })
        push(`Request started: ${trimmedTitle}`)
        setTitle('')
        setDescription('')
        onCreated(workflowId)
      } catch (err) {
        push(
          err instanceof ApiError ? err.message : 'Failed to start the request',
          'error',
        )
      } finally {
        setBusy(false)
      }
    }

    return (
      <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="request-project" className="text-xs text-muted">
            Project
          </label>
          <select
            id="request-project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text"
          >
            {projects.length === 0 && (
              <option value="">No projects yet</option>
            )}
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="request-title" className="text-xs text-muted">
            Title
          </label>
          <input
            id="request-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a personalized company digest"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="request-description" className="text-xs text-muted">
            Description
          </label>
          <textarea
            id="request-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Describe the feature in your own words."
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
          />
          Auto-approve (skip the review step, build right away)
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-quiet btn-sm"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="btn btn-accent btn-sm"
          >
            {busy ? 'Starting…' : 'Start request'}
          </button>
        </div>
      </form>
    )
  }
  ```
  This posts a `CreateWorkflowRequest` matching W1's route exactly: `kind` (required), `project`, `title` (the optional top-level field the route also accepts, per `packages/kernel/src/api/workflows.ts`'s `engine.create(body.kind, body.input ?? {}, { project: body.project, title: body.title })`), and `input: FeatureRequestInput`.

  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add packages/dashboard/src/components/NewRequestForm.tsx packages/dashboard/src/components/NewRequestForm.test.tsx
  git commit -m "feat(dashboard): add NewRequestForm to start a feature-request workflow

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 6: `RunStream` inline-embed support + `RequestView`

**Files:**
- Modify: `packages/dashboard/src/components/RunStream.tsx`
- Create: `packages/dashboard/src/components/RequestView.tsx`
- Create: `packages/dashboard/src/components/RequestView.test.tsx`

**Interfaces:**
- Consumes: `GetWorkflowResponse`, `WorkflowStatus` (`@agentos/shared`, W1), `ApiClient` workflow methods (Task 1), `currentStepIndex`/`isTerminal`/`workflowCostUsd` (Task 2), `WorkflowStepper` (Task 4), `RunStream`, `ConfirmSheet`, `StatusBadge`, `ErrorState`, `SkeletonRows`, `useToast` (all existing).
- Produces:
```ts
// RunStream.tsx — backward-compatible addition
export function RunStream(props: { runId: string; onClose: () => void; showClose?: boolean }): JSX.Element
// RequestView.tsx
export function RequestView(props: { workflowId: string }): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

  `packages/dashboard/src/components/RequestView.test.tsx`:
  ```tsx
  import { render, screen, waitFor } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { describe, expect, it, vi } from 'vitest'
  import { MockWebSocket, installMockFetch } from '../../tests/mockServer'
  import { RequestView } from './RequestView'
  import { ToastProvider } from './Toast'

  function setup(overrides = {}) {
    installMockFetch(overrides)
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  }

  describe('RequestView', () => {
    it('shows the stepper, cost, and streams the active run inline', async () => {
      setup({
        'GET /api/workflows/wf_1': () => ({
          workflow: {
            id: 'wf_1',
            kind: 'feature-request',
            status: 'running',
            project: 'techpulse',
            title: 'Add a personalized company digest',
            input: {},
            currentStep: 'build',
            state: { brief: { costUsd: 0.1 } },
            startedAt: '2026-09-09T10:00:00Z',
            createdAt: '2026-09-09T10:00:00Z',
            updatedAt: '2026-09-09T10:01:00Z',
          },
          steps: [
            { id: 's1', workflowId: 'wf_1', name: 'brief', seq: 1, status: 'succeeded', attempt: 1, output: { costUsd: 0.1 }, startedAt: '2026-09-09T10:00:00Z' },
            { id: 's2', workflowId: 'wf_1', name: 'build', seq: 2, status: 'running', attempt: 1, runId: 'run_1', startedAt: '2026-09-09T10:01:00Z' },
          ],
        }),
        'GET /api/runs/run_1/events': () => [],
      })
      render(
        <ToastProvider>
          <RequestView workflowId="wf_1" />
        </ToastProvider>,
      )
      expect(
        await screen.findByText('Add a personalized company digest'),
      ).toBeInTheDocument()
      expect(screen.getByText('running')).toBeInTheDocument()
      expect(screen.getByText('$0.10')).toBeInTheDocument()
      expect(screen.getByText('build')).toBeInTheDocument()
      expect(await screen.findByText(/no output recorded/i)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /close/i }),
      ).not.toBeInTheDocument()
    })

    it('offers Retry from this step on a failed request', async () => {
      setup({
        'GET /api/workflows/wf_1': () => ({
          workflow: {
            id: 'wf_1', kind: 'feature-request', status: 'failed', title: 'Add a widget',
            input: {}, state: {}, error: 'validate check failed',
            createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:01:00Z',
          },
          steps: [
            { id: 's1', workflowId: 'wf_1', name: 'validate', seq: 1, status: 'failed', attempt: 1, error: 'lint failed', startedAt: '2026-09-09T10:00:00Z' },
          ],
        }),
        'POST /api/workflows/wf_1/resume': () => ({
          id: 'wf_1', kind: 'feature-request', status: 'running', title: 'Add a widget',
          input: {}, state: {}, createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:02:00Z',
        }),
      })
      render(
        <ToastProvider>
          <RequestView workflowId="wf_1" />
        </ToastProvider>,
      )
      await userEvent.click(
        await screen.findByRole('button', { name: 'Retry from this step' }),
      )
      expect(
        await screen.findByText('Retrying from the failed step'),
      ).toBeInTheDocument()
    })

    it('asks for confirmation, then terminates', async () => {
      setup({
        'GET /api/workflows/wf_1': () => ({
          workflow: {
            id: 'wf_1', kind: 'feature-request', status: 'running', title: 'Add a widget',
            input: {}, state: {}, createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:01:00Z',
          },
          steps: [],
        }),
        'POST /api/workflows/wf_1/terminate': () => ({
          id: 'wf_1', kind: 'feature-request', status: 'terminated', title: 'Add a widget',
          input: {}, state: {}, createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:02:00Z',
        }),
      })
      render(
        <ToastProvider>
          <RequestView workflowId="wf_1" />
        </ToastProvider>,
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Terminate' }))
      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toHaveTextContent('Terminate request?')
      await userEvent.click(
        screen.getByRole('button', { name: 'Terminate request' }),
      )
      await waitFor(() =>
        expect(screen.getByText('Terminated')).toBeInTheDocument(),
      )
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`./RequestView` doesn't exist; `showClose` unknown to `RunStream`, though this only fails once `RequestView` uses it).

- [ ] **Step 2: Add `showClose` to `RunStream`**

  In `packages/dashboard/src/components/RunStream.tsx`, change the export signature and the Close button:
  ```tsx
  export function RunStream({
    runId,
    onClose,
    showClose = true,
  }: {
    runId: string
    onClose: () => void
    showClose?: boolean
  }) {
  ```
  and in the JSX button row:
  ```tsx
          <div className="flex gap-2">
            <button
              type="button"
              onClick={kill}
              className="btn btn-danger btn-sm"
            >
              Kill
            </button>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                className="btn btn-quiet btn-sm"
              >
                Close
              </button>
            )}
          </div>
  ```
  Every existing caller (`RunsPanel`, `OverviewPanel`) omits `showClose`, so it defaults to `true` and keeps behaving exactly as before — `RunStream.test.tsx`'s four existing tests need no changes.

- [ ] **Step 3: Implement `RequestView`**

  `packages/dashboard/src/components/RequestView.tsx`:
  ```tsx
  import type { GetWorkflowResponse, WorkflowStatus } from '@agentos/shared'
  import { useCallback, useEffect, useState } from 'react'
  import { ApiClient, ApiError } from '../api/client'
  import { useEvents } from '../api/ws'
  import { duration, usd } from '../lib/time'
  import {
    currentStepIndex,
    isTerminal,
    workflowCostUsd,
    workflowIdOf,
  } from '../lib/workflow'
  import { ConfirmSheet } from './ConfirmSheet'
  import { ErrorState } from './ErrorState'
  import { RunStream } from './RunStream'
  import { SkeletonRows } from './Skeleton'
  import { StatusBadge } from './StatusBadge'
  import { useToast } from './Toast'
  import { WorkflowStepper } from './WorkflowStepper'

  const client = new ApiClient()
  const PAUSABLE: WorkflowStatus[] = ['running', 'waiting', 'sleeping']

  export function RequestView({ workflowId }: { workflowId: string }) {
    const [detail, setDetail] = useState<GetWorkflowResponse | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [confirmingTerminate, setConfirmingTerminate] = useState(false)
    const [now, setNow] = useState(() => Date.now())
    const { push } = useToast()
    const { events } = useEvents(
      (e) => e.type.startsWith('workflow.') && workflowIdOf(e) === workflowId,
    )

    const load = useCallback(() => {
      setError(null)
      client
        .getWorkflow(workflowId)
        .then(setDetail)
        .catch((e) =>
          setError(e instanceof ApiError ? e.message : 'Failed to load request'),
        )
    }, [workflowId])

    // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches on every workflow.* event for this id
    useEffect(() => {
      load()
    }, [load, events.length])

    useEffect(() => {
      const t = setInterval(() => setNow(Date.now()), 5_000)
      return () => clearInterval(t)
    }, [])

    async function pause() {
      setBusy(true)
      try {
        await client.pauseWorkflow(workflowId)
        push('Paused')
      } catch {
        push('Failed to pause', 'error')
      } finally {
        setBusy(false)
        load()
      }
    }

    async function resume() {
      setBusy(true)
      try {
        await client.resumeWorkflow(workflowId)
        push('Resumed')
      } catch {
        push('Failed to resume', 'error')
      } finally {
        setBusy(false)
        load()
      }
    }

    async function retry() {
      setBusy(true)
      try {
        await client.resumeWorkflow(workflowId)
        push('Retrying from the failed step')
      } catch {
        push('Failed to retry', 'error')
      } finally {
        setBusy(false)
        load()
      }
    }

    async function terminate() {
      setBusy(true)
      try {
        await client.terminateWorkflow(workflowId)
        push('Terminated')
      } catch {
        push('Failed to terminate', 'error')
      } finally {
        setBusy(false)
        setConfirmingTerminate(false)
        load()
      }
    }

    if (error) return <ErrorState message={error} onRetry={load} />
    if (detail === null) return <SkeletonRows rows={5} label="Loading request…" />

    const { workflow, steps } = detail
    const idx = currentStepIndex(workflow, steps)
    const activeStep = idx >= 0 ? steps[idx] : undefined

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-text">
              {workflow.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge status={workflow.status} />
              {workflow.project && (
                <span className="chip">{workflow.project}</span>
              )}
              <span className="font-mono">
                {duration(workflow.startedAt, workflow.endedAt, now)}
              </span>
              <span className="font-mono">{usd(workflowCostUsd(workflow))}</span>
            </div>
            {workflow.error && (
              <p className="mt-2 text-xs text-danger">{workflow.error}</p>
            )}
          </div>
          <div className="flex gap-2">
            {PAUSABLE.includes(workflow.status) && (
              <button
                type="button"
                disabled={busy}
                onClick={pause}
                className="btn btn-quiet btn-sm"
              >
                Pause
              </button>
            )}
            {workflow.status === 'paused' && (
              <button
                type="button"
                disabled={busy}
                onClick={resume}
                className="btn btn-accent btn-sm"
              >
                Resume
              </button>
            )}
            {workflow.status === 'failed' && (
              <button
                type="button"
                disabled={busy}
                onClick={retry}
                className="btn btn-accent btn-sm"
              >
                Retry from this step
              </button>
            )}
            {!isTerminal(workflow.status) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingTerminate(true)}
                className="btn btn-danger btn-sm"
              >
                Terminate
              </button>
            )}
          </div>
        </header>

        <WorkflowStepper steps={steps} now={now} />

        {activeStep?.runId && (
          <div className="card p-3">
            <h4 className="mb-2 text-xs font-medium text-muted">
              {activeStep.name}
            </h4>
            <RunStream
              runId={activeStep.runId}
              onClose={() => {}}
              showClose={false}
            />
          </div>
        )}

        <ConfirmSheet
          open={confirmingTerminate}
          title="Terminate request?"
          confirmLabel="Terminate request"
          tone="danger"
          busy={busy}
          onConfirm={terminate}
          onCancel={() => setConfirmingTerminate(false)}
        >
          <p>
            Stops the current step's run and marks this request terminated.
            Any branch or commits it already made stay in place for you to
            pick up by hand.
          </p>
        </ConfirmSheet>
      </div>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS (all `RequestView` tests and all four existing `RunStream` tests).

- [ ] **Step 4: Commit**
  ```bash
  git add packages/dashboard/src/components/RunStream.tsx packages/dashboard/src/components/RequestView.tsx packages/dashboard/src/components/RequestView.test.tsx
  git commit -m "feat(dashboard): add RequestView with live stepper, inline stream, and lifecycle controls

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 7: `RequestsPanel`

**Files:**
- Create: `packages/dashboard/src/panels/RequestsPanel.tsx`
- Create: `packages/dashboard/src/panels/RequestsPanel.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.listWorkflows`/`listProjects` (Task 1), `NewRequestForm` (Task 5), `RequestView` (Task 6), `workflowCostUsd` (Task 2), `WorkflowInstance`/`ProjectConfig` (`@agentos/shared`, W1/W2).
- Produces: `export function RequestsPanel(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

  `packages/dashboard/src/panels/RequestsPanel.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { describe, expect, it, vi } from 'vitest'
  import {
    MockWebSocket,
    fixtures,
    installMockFetch,
  } from '../../tests/mockServer'
  import { ToastProvider } from '../components/Toast'
  import { RequestsPanel } from './RequestsPanel'

  function setup(overrides = {}) {
    installMockFetch(overrides)
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  }

  describe('RequestsPanel', () => {
    it('lists requests and opens the selected one', async () => {
      setup({ 'GET /api/runs/run_1/events': () => [] })
      render(
        <ToastProvider>
          <RequestsPanel />
        </ToastProvider>,
      )
      const row = await screen.findByText(fixtures.workflow.title)
      await userEvent.click(row)
      expect(await screen.findByText('build')).toBeInTheDocument()
    })

    it('shows an empty state with a New request action when there are none', async () => {
      setup({ 'GET /api/workflows': () => [] })
      render(
        <ToastProvider>
          <RequestsPanel />
        </ToastProvider>,
      )
      expect(await screen.findByText('No requests yet')).toBeInTheDocument()
      expect(
        screen.getAllByRole('button', { name: 'New request' }),
      ).toHaveLength(2)
    })

    it('opens and closes the new request form', async () => {
      setup()
      render(
        <ToastProvider>
          <RequestsPanel />
        </ToastProvider>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'New request' }))
      expect(screen.getByLabelText('Title')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`./RequestsPanel` doesn't exist).

- [ ] **Step 2: Implement**

  `packages/dashboard/src/panels/RequestsPanel.tsx`:
  ```tsx
  import type { ProjectConfig, WorkflowInstance } from '@agentos/shared'
  import { useCallback, useEffect, useState } from 'react'
  import { ApiClient, ApiError } from '../api/client'
  import { useEvents } from '../api/ws'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'
  import { NewRequestForm } from '../components/NewRequestForm'
  import { RequestView } from '../components/RequestView'
  import { SkeletonRows } from '../components/Skeleton'
  import { StatusBadge } from '../components/StatusBadge'
  import { duration, usd } from '../lib/time'
  import { workflowCostUsd } from '../lib/workflow'

  const client = new ApiClient()

  export function RequestsPanel() {
    const [workflows, setWorkflows] = useState<WorkflowInstance[] | null>(null)
    const [projects, setProjects] = useState<ProjectConfig[]>([])
    const [error, setError] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [showForm, setShowForm] = useState(false)
    const { events } = useEvents((e) => e.type.startsWith('workflow.'))

    const load = useCallback(() => {
      setError(null)
      client
        .listWorkflows()
        .then((list) => {
          setWorkflows(list)
          setSelectedId((cur) =>
            cur && list.some((w) => w.id === cur) ? cur : (list[0]?.id ?? null),
          )
        })
        .catch((e) =>
          setError(
            e instanceof ApiError ? e.message : 'Failed to load requests',
          ),
        )
    }, [])

    // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches the list on every workflow.* event
    useEffect(() => {
      load()
    }, [load, events.length])

    useEffect(() => {
      client.listProjects().then(setProjects).catch(() => setProjects([]))
    }, [])

    function created(workflowId: string) {
      setShowForm(false)
      setSelectedId(workflowId)
      load()
    }

    const now = Date.now()

    return (
      <section className="flex h-full flex-col">
        <div className="mb-4 flex items-end justify-between border-b border-border">
          <h2 className="pb-1.5 text-lg font-medium">Requests</h2>
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="btn btn-accent btn-sm mb-1.5"
          >
            {showForm ? 'Cancel' : 'New request'}
          </button>
        </div>

        {showForm && (
          <div className="mb-4">
            <NewRequestForm
              projects={projects}
              onCreated={created}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        {error && <ErrorState message={error} onRetry={load} />}
        {!error && workflows === null && (
          <SkeletonRows rows={4} label="Loading requests…" />
        )}
        {!error && workflows !== null && workflows.length === 0 && (
          <EmptyState
            title="No requests yet"
            body="Describe a feature in plain words and agent-os turns it into a proposal, a branch, and a pull request."
            action={
              !showForm && (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="btn btn-accent btn-sm"
                >
                  New request
                </button>
              )
            }
          />
        )}
        {!error && workflows !== null && workflows.length > 0 && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,1fr)_2fr] gap-4">
            <ol className="card min-h-0 overflow-auto" aria-label="Request list">
              {workflows.map((w) => {
                const active = w.id === selectedId
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(w.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                        active
                          ? 'bg-raised border-l-2 border-l-accent'
                          : 'border-l-2 border-l-transparent hover:bg-raised/60'
                      }`}
                    >
                      <div className="truncate text-sm text-text">
                        {w.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                        <StatusBadge status={w.status} />
                        {w.project && <span>{w.project}</span>}
                        <span className="font-mono">
                          {duration(w.startedAt, w.endedAt, now)}
                        </span>
                        <span className="font-mono">
                          {usd(workflowCostUsd(w))}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
            <div className="card min-h-0 overflow-auto p-5">
              {selectedId ? (
                <RequestView key={selectedId} workflowId={selectedId} />
              ) : (
                <p className="text-sm text-muted">
                  Pick a request to follow it.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add packages/dashboard/src/panels/RequestsPanel.tsx packages/dashboard/src/panels/RequestsPanel.test.tsx
  git commit -m "feat(dashboard): add RequestsPanel with New request form and instance list

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 8: Wire Requests into the shell — `App.tsx`, `Icon.tsx`, `OverviewPanel.tsx`

**Files:**
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `packages/dashboard/src/App.test.tsx`
- Modify: `packages/dashboard/src/components/Icon.tsx`
- Modify: `packages/dashboard/src/panels/OverviewPanel.tsx`
- Modify: `packages/dashboard/src/panels/OverviewPanel.test.tsx`

**Interfaces:**
- Consumes: `RequestsPanel` (Task 7), `isInFlight` (Task 2), `WorkflowInstance` (`@agentos/shared`, W1).
- Produces: `PanelName` gains `'requests'`; `OverviewPanel`'s `onNavigate` prop gains `'requests'` as an accepted value.

- [ ] **Step 1: Write the failing tests**

  Append to `packages/dashboard/src/App.test.tsx`:
  ```tsx
  it('opens the Requests panel from the left nav', async () => {
    installMockFetch()
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /Requests/ }))
    expect(
      await screen.findByRole('heading', { name: 'Requests' }),
    ).toBeInTheDocument()
  })
  ```
  Append to `packages/dashboard/src/panels/OverviewPanel.test.tsx`:
  ```tsx
  it('shows requests in flight and jumps to Requests from the stat card', async () => {
    setup()
    const onNavigate = vi.fn()
    render(
      <ToastProvider>
        <OverviewPanel onNavigate={onNavigate} />
      </ToastProvider>,
    )
    expect(await screen.findByText('Requests in flight')).toBeInTheDocument()
    expect(screen.getByText('building now')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /Requests in flight/ }),
    )
    expect(onNavigate).toHaveBeenCalledWith('requests')
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (no "Requests" nav button; no "Requests in flight" stat; `onNavigate` type doesn't accept `'requests'`).

- [ ] **Step 2: Add the icon**

  In `packages/dashboard/src/components/Icon.tsx`, add `'requests'` to `IconName` and `PATHS`:
  ```ts
  export type IconName =
    | 'overview'
    | 'runs'
    | 'decisions'
    | 'wiki'
    | 'skills'
    | 'routines'
    | 'costs'
    | 'messages'
    | 'requests'
    | 'close'
    | 'check'
    | 'x'
    | 'play'
    | 'stop'
    | 'search'
  ```
  ```ts
  const PATHS: Record<IconName, string> = {
    overview: 'M2 12h4l3-8 4 16 3-8h6',
    runs: 'M5 4l14 8-14 8z',
    decisions: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z M9 12l2 2 4-4',
    wiki: 'M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4z M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z',
    skills:
      'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z M5 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
    routines: 'M12 3a9 9 0 110 18 9 9 0 010-18z M12 7v5l3 2',
    costs: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
    messages: 'M4 4h16v13H8l-4 4z',
    requests: 'M3 11l18-7-7 18-2-8-8-3z',
    close: 'M6 6l12 12 M18 6L6 18',
    check: 'M4 12l5 5L20 6',
    x: 'M6 6l12 12 M18 6L6 18',
    play: 'M6 4l14 8-14 8z',
    stop: 'M6 6h12v12H6z',
    search: 'M11 4a7 7 0 110 14 7 7 0 010-14z M20 20l-4-4',
  }
  ```

- [ ] **Step 3: Wire `App.tsx`**

  Add the import and append the nav entry (append, not insert at a fixed index, so this does not conflict with PR #6's Messages entry or W2's future Projects entry landing in either order):
  ```tsx
  import { RequestsPanel } from './panels/RequestsPanel'
  ```
  ```tsx
  export type PanelName =
    | 'overview'
    | 'runs'
    | 'decisions'
    | 'wiki'
    | 'skills'
    | 'routines'
    | 'costs'
    | 'messages'
    | 'requests'
  ```
  ```tsx
  const NAV: Array<{ id: PanelName; label: string; icon: IconName }> = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'runs', label: 'Runs', icon: 'runs' },
    { id: 'decisions', label: 'Decisions', icon: 'decisions' },
    { id: 'wiki', label: 'Wiki', icon: 'wiki' },
    { id: 'skills', label: 'Skills', icon: 'skills' },
    { id: 'routines', label: 'Routines', icon: 'routines' },
    { id: 'costs', label: 'Costs', icon: 'costs' },
    { id: 'messages', label: 'Messages', icon: 'messages' },
    { id: 'requests', label: 'Requests', icon: 'requests' },
  ]
  ```
  Add a case to the panel `switch`:
  ```tsx
      case 'messages':
        panel = <MessagesPanel />
        break
      case 'requests':
        panel = <RequestsPanel />
        break
      default:
        panel = <OverviewPanel onNavigate={go} />
  ```

- [ ] **Step 4: Wire `OverviewPanel.tsx`**

  Widen the type import and the `onNavigate` prop:
  ```tsx
  import type { Decision, Run, WorkflowInstance } from '@agentos/shared'
  ```
  ```tsx
  import { isInFlight } from '../lib/workflow'
  ```
  ```tsx
  export function OverviewPanel({
    onNavigate,
  }: {
    onNavigate?: (panel: 'decisions' | 'runs' | 'costs' | 'requests') => void
  }) {
  ```
  Extend `Snapshot` and `load`:
  ```tsx
  interface Snapshot {
    agents: AgentStatus[]
    decisions: Decision[]
    runs: Run[]
    costs: CostEntry[]
    workflows: WorkflowInstance[]
  }
  ```
  ```tsx
    const load = useCallback(() => {
      setError(null)
      Promise.all([
        client.listAgents(),
        client.listDecisions('pending'),
        client.listRuns({ limit: 100 }),
        client.costs(14),
        client.listWorkflows(),
      ])
        .then(([agents, decisions, runs, costs, workflows]) =>
          setSnap({ agents, decisions, runs, costs, workflows }),
        )
        .catch((e) =>
          setError(e instanceof ApiError ? e.message : 'Failed to load overview'),
        )
    }, [])
  ```
  Extend the refetch trigger:
  ```tsx
    const lifecycleCount = events.filter(
      (e) =>
        e.type.startsWith('run.') ||
        e.type.startsWith('decision.') ||
        e.type.startsWith('workflow.'),
    ).length
  ```
  Add the derived count (next to the other derived stats, e.g. after `const waiting = ...`):
  ```tsx
    const requestsInFlight =
      snap?.workflows.filter((w) => isInFlight(w.status)).length ?? 0
  ```
  Widen the stat grid from four to five columns and add the new `<Stat>` (in the `<dl className="grid grid-cols-4 gap-3">` block):
  ```tsx
        <dl className="grid grid-cols-5 gap-3">
          <Stat
            label="Agents"
            value={snap ? String(snap.agents.length) : null}
            note={
              snap
                ? working > 0
                  ? `${working} working now`
                  : 'all idle'
                : undefined
            }
            tone={working > 0 ? 'accent' : undefined}
          />
          <Stat
            label="Waiting on you"
            value={snap ? String(waiting) : null}
            note={waiting > 0 ? 'needs a decision' : 'nothing pending'}
            tone={waiting > 0 ? 'signal' : undefined}
            onClick={onNavigate ? () => onNavigate('decisions') : undefined}
          />
          <Stat
            label="Requests in flight"
            value={snap ? String(requestsInFlight) : null}
            note={requestsInFlight > 0 ? 'building now' : 'nothing in flight'}
            tone={requestsInFlight > 0 ? 'accent' : undefined}
            onClick={onNavigate ? () => onNavigate('requests') : undefined}
          />
          <Stat
            label="Runs today"
            value={runsToday ? String(runsToday.length) : null}
            note={
              failedToday
                ? `${failedToday} failed`
                : runsToday && runsToday.length > 0
                  ? 'all succeeded'
                  : 'none yet'
            }
            tone={failedToday ? 'danger' : undefined}
            onClick={onNavigate ? () => onNavigate('runs') : undefined}
          />
          <Stat
            label="Spend today"
            value={snap ? usd(spendToday) : null}
            note={`${usd(spend14)} over 14 days`}
            onClick={onNavigate ? () => onNavigate('costs') : undefined}
          />
        </dl>
  ```
  (Everything else in `OverviewPanel.tsx` — the `Stat` helper, the two-column body below, the `Drawer` — is unchanged.)

- [ ] **Step 5: Run tests, verify pass**

  Run: `pnpm --filter @agentos/dashboard test` — PASS (including every pre-existing `OverviewPanel`/`App` test — the default mock fixture from Task 1 gives every `installMockFetch()` call a `GET /api/workflows` response automatically, so no other test file needs touching).

- [ ] **Step 6: Commit**
  ```bash
  git add packages/dashboard/src/App.tsx packages/dashboard/src/App.test.tsx packages/dashboard/src/components/Icon.tsx packages/dashboard/src/panels/OverviewPanel.tsx packages/dashboard/src/panels/OverviewPanel.test.tsx
  git commit -m "feat(dashboard): add Requests to the nav and a Requests-in-flight overview stat

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 9: e2e — seed a running request, verify the panel

**Files:**
- Create: `tools/seed-workflow.mjs`
- Modify: `tools/e2e-kernel.mjs`
- Modify: `packages/dashboard/e2e/dashboard.spec.ts`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: the `workflows`/`workflow_steps` SQLite tables exactly as W1 defines them (`packages/kernel/src/log/schema.sql`: `workflows.title`/`input`/`state` `NOT NULL`, `workflow_steps.started_at TEXT NOT NULL DEFAULT (strftime(...))`) — deliberately **not** W1's `EventLog` method names, which this plan does not own and cannot assume the exact shape of. Seeding by direct SQL against the contract-fixed schema keeps this task buildable and reviewable independent of how W1 names its TypeScript helpers.
- Produces: `export function seedWorkflow(dbPath: string): string` (returns the seeded workflow id).

- [ ] **Step 1: Add `better-sqlite3` as a root devDependency**

  In root `package.json`, add to `devDependencies` (version pinned to match the contract's `@agentos/kernel` pin — this is not a new library, just the same pinned dependency made available to a second, dev-only tooling script):
  ```json
    "devDependencies": {
      "@agentos/kernel": "workspace:*",
      "@biomejs/biome": "^1.9.0",
      "better-sqlite3": "^12",
      "execa": "^9.4.0",
      "typescript": "^5.6.0",
      "vitest": "^2.1.0",
      "tsup": "^8.3.0"
    }
  ```
  Run: `pnpm install` — completes without error.

- [ ] **Step 2: Write `tools/seed-workflow.mjs`**

  ```js
  #!/usr/bin/env node
  import { randomUUID } from 'node:crypto'
  import Database from 'better-sqlite3'

  /**
   * Inserts one running feature-request instance directly against the
   * workflows/workflow_steps tables (W1's packages/kernel/src/log/schema.sql),
   * so the e2e kernel has a live request to show. Uses raw SQL against the
   * fixed schema rather than EventLog helper methods, which belong to W1 and
   * are not part of this plan's contract.
   */
  export function seedWorkflow(dbPath) {
    const db = new Database(dbPath)
    const now = new Date().toISOString()
    const workflowId = `wf_${randomUUID()}`

    db.prepare(
      `INSERT INTO workflows
         (id, kind, status, project, title, input, state, current_step, created_at, started_at, updated_at)
       VALUES (@id, @kind, @status, @project, @title, @input, @state, @current_step, @created_at, @started_at, @updated_at)`,
    ).run({
      id: workflowId,
      kind: 'feature-request',
      status: 'running',
      project: 'techpulse',
      title: 'Add a personalized company digest',
      input: JSON.stringify({
        project: 'techpulse',
        title: 'Add a personalized company digest',
        description: 'Summarize the week per company the user follows.',
        autoApprove: true,
      }),
      state: JSON.stringify({ brief: { costUsd: 0.08 } }),
      current_step: 'build',
      created_at: now,
      started_at: now,
      updated_at: now,
    })

    db.prepare(
      `INSERT INTO workflow_steps
         (id, workflow_id, name, seq, status, attempt, started_at)
       VALUES (@id, @workflow_id, @name, @seq, @status, @attempt, @started_at)`,
    ).run({
      id: `wfs_${randomUUID()}`,
      workflow_id: workflowId,
      name: 'brief',
      seq: 1,
      status: 'succeeded',
      attempt: 1,
      started_at: now,
    })

    db.prepare(
      `INSERT INTO workflow_steps
         (id, workflow_id, name, seq, status, attempt, started_at)
       VALUES (@id, @workflow_id, @name, @seq, @status, @attempt, @started_at)`,
    ).run({
      id: `wfs_${randomUUID()}`,
      workflow_id: workflowId,
      name: 'build',
      seq: 2,
      status: 'running',
      attempt: 1,
      started_at: now,
    })

    db.close()
    return workflowId
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
    const dbPath = process.argv[2]
    if (!dbPath) {
      console.error('usage: seed-workflow.mjs <dbPath>')
      process.exit(1)
    }
    console.log(seedWorkflow(dbPath))
  }
  ```

- [ ] **Step 3: Call it from the e2e kernel**

  In `tools/e2e-kernel.mjs`, add the import and the call after `seedDecision`:
  ```js
  import { seedDecision } from './seed-decision.mjs'
  import { seedWorkflow } from './seed-workflow.mjs'
  ```
  ```js
  seedDecision(cfg.dbPath)
  seedWorkflow(cfg.dbPath)
  ```

- [ ] **Step 4: Write the failing e2e test**

  Append a new top-level test to `packages/dashboard/e2e/dashboard.spec.ts` (existing tests untouched):
  ```ts
  test('requests panel shows a seeded workflow and its live stepper', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Requests', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()
    await page.getByText('Add a personalized company digest').click()
    await expect(page.getByText('build')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Terminate' })).toBeVisible()
  })
  ```
  Run: `pnpm --filter @agentos/dashboard e2e` — FAIL (before Tasks 1–8 land, no Requests nav entry or panel exists; run again once this whole plan's tasks are complete).

- [ ] **Step 5: Run e2e, verify pass**

  Run: `pnpm --filter @agentos/dashboard e2e` — PASS (all e2e tests, including the pre-existing Decisions-approval flow, which is unaffected by this task).

- [ ] **Step 6: Commit**
  ```bash
  git add tools/seed-workflow.mjs tools/e2e-kernel.mjs packages/dashboard/e2e/dashboard.spec.ts package.json
  git commit -m "test(dashboard): seed a running feature-request workflow for the e2e kernel

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

  **Scope note:** spec §9's full line — "e2e adds a project from a fake `gh` and submits a request that runs the fake-claude kernel end to end" — spans W2 (fake `gh` project add) and W3 (a real `feature-request` definition driving fake-claude through all eight steps). This task proves the Requests-panel slice of that: the panel reads real server routes and renders a real, in-flight instance correctly. The full cross-milestone flow is better owned once W1–W3 are in the same tree as W4, e.g. by a later integration pass — attempting it here would mean fabricating either W2's `gh`-stub mechanism or W3's step definitions, neither of which this plan owns.

---

## Self-Review

**1. Spec coverage.**
- §3.1 data model → this plan consumes W1's `WorkflowInstance`/`WorkflowStep`/`WorkflowStatus`/`WorkflowStepStatus`, matching every column, without redefining them (Task 1).
- §3.3 events → `EventKind`/`describeEvent` handle every `workflow.*` type listed (Task 3); `workflowIdOf` reads the `workflowId` payload field every event carries (Task 2).
- §3.4 API → all six routes plus list/detail get `ApiClient` methods, with return types matching W1's actual route handlers exactly — including that pause/resume/terminate return the updated instance and events-delivery returns `{ id }`, not a bare `{ ok: true }` (Task 1).
- §5.1 `FeatureRequestInput` → imported from `@agentos/shared` per direction (the open W3-side gap is flagged in Global Constraints, not silently papered over); `NewRequestForm` posts exactly `{ kind: 'feature-request', project, title, input }`, matching W1's `CreateWorkflowRequest` (Task 5).
- §6 Requests panel → New request form (Task 5), instance list with status/project/elapsed/cost (Task 7), `RequestView` stepper with active step's `RunStream` inline, Pause/Resume/Terminate (Task 6); Overview "Requests in flight" stat and `workflow.*` feed lines, kind `run` (Tasks 3, 8).
- §8 error handling → "Retry from this step" button on a failed instance, `POST /resume` (Task 6).
- §9 testing → dashboard component tests for the new list/detail (Tasks 4-7) and an e2e proving the panel against a real seeded instance (Task 9), scoped as noted above.
- Global constraint "`signal` amber only for things needing a human" → only the `waiting` workflow status (parked on a human decision) gets `text-signal`; `paused`/`sleeping` stay muted (Task 4).

**2. Placeholder scan.** No `TODO`/`TBD`/"add appropriate" language anywhere in the tasks above; every step has runnable code, not a description of code. Two things are deliberately called out rather than silently assumed: the full multi-milestone e2e (Task 9's scope note) and the `FeatureRequestInput` shared-export gap versus W3's plan as currently written (Global Constraints).

**3. Type consistency.** Checked across all nine tasks, now against W1's actual names:
- `WorkflowInstance`/`WorkflowStep`/`WorkflowStatus`/`WorkflowStepStatus`/`GetWorkflowResponse`/`CreateWorkflowRequest`/`CreateWorkflowResponse`/`ListWorkflowsQuery`/`DeliverWorkflowEventRequest` are imported from `@agentos/shared` everywhere they're used (Tasks 1-8) — this plan defines none of them and never reintroduces the earlier draft's `Workflow`/`StepStatus`/`WorkflowDetail` names.
- Every `WorkflowStep` object literal in every test file (Tasks 1, 2, 4, 6) includes `startedAt`, since W1's type has it required, not optional.
- `pauseWorkflow`/`resumeWorkflow`/`terminateWorkflow` (Task 1) return `Promise<WorkflowInstance>`; `RequestView` (Task 6) does not read their resolved value directly (it calls `load()` after each to refetch), so no shape mismatch there; the mock routes (Task 1) and the tests that call them (Task 6) both return/assert on the updated instance's `status` field, not `{ ok: true }`.
- `sendWorkflowEvent` (Task 1) returns `Promise<{ id: number }>`, matching W1's route and its own test assertion.
- `elapsedMs`, `workflowCostUsd`, `stepCostUsd`, `totalStepCostUsd`, `currentStepIndex`, `isInFlight`, `isTerminal`, `workflowIdOf`, `isWorkflowEvent` (Task 2) take `WorkflowInstance`/`WorkflowStep` and keep the same names and signatures everywhere they're called (Tasks 4, 6, 7, 8).
- `WorkflowStepper(props: { steps: WorkflowStep[]; now?: number })` (Task 4) is called with exactly that shape from `RequestView` (Task 6).
- `NewRequestForm(props: { projects, onCreated, onCancel? })` (Task 5) is called with exactly that shape from `RequestsPanel` (Task 7).
- `RequestView(props: { workflowId: string })` (Task 6) is called with exactly that shape from `RequestsPanel` (Task 7).
- `RunStream`'s new `showClose` prop defaults to `true`, so every pre-existing caller (`RunsPanel`, `OverviewPanel`) keeps compiling unchanged.
- `OverviewPanel`'s `onNavigate` union (Task 8) is a superset of what `App.tsx`'s `go: (p: PanelName) => void` provides, so the existing `<OverviewPanel onNavigate={go} />` call in `App.tsx` keeps type-checking without modification.
