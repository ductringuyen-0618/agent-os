# agent-os W3 — Feature-Request Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `feature-request` workflow definition (spec §5) on top of the W1 durable workflow engine: an operator-facing pipeline that turns a project name + plain-words description into a proposal (`brief`), commits and pushes it (`push-proposal`), optionally waits for a human decision (`await-approval`), builds it in the project's clone (`build`), validates and reviews it (`validate`/`review`, with one automatic fix retry), opens a pull request and flips the proposal to shipped (`open-pr`), and records the outcome (`done`) — plus the four new skills those steps run, the `techpulse-coo` adapter helpers they call, and the `agentos request` CLI command that starts an instance.

**Architecture:** This plan consumes W1's workflow engine types verbatim from `packages/kernel/src/workflow/types.ts` (`WorkflowDefinition<I>`, `WorkflowContext<I>` — which already exposes `readonly id: string`, `WorkflowStepApi`, `StepOptions`, `StepRunSpec`) and its `RunResult` from `packages/kernel/src/process/processManager.js` (`{ status: 'success'|'failed'|'killed'; sessionId?; costUsd?; inputTokens?; outputTokens?; error?; resultText? }`) — this plan defines neither. `packages/kernel/src/workflow/definitions/featureRequest.ts` exports `createFeatureRequestWorkflow(deps): WorkflowDefinition<FeatureRequestInput>` — a *factory*, not a bare object, so it can close over dependencies `run()` needs beyond what `WorkflowContext` carries (wiki, the adapter registry, project lookup). Those dependencies present a real ordering problem: `createKernel(cfg, adapterRegistry, workflowDefinitions)` (W1) takes an *array* of already-built `WorkflowDefinition` objects as its third parameter, constructed by the caller (`packages/cli/src/commands/up.ts`) *before* `createKernel` runs — so at the moment `createFeatureRequestWorkflow(deps)` is called, there is no `Kernel` yet, hence no live `EventLog`/`WikiService`/`AdapterHost` to inject eagerly. `FeatureRequestDeps` therefore takes `getKernel: () => FeatureRequestKernelDeps`, a lazy accessor `up.ts` satisfies with a forward-declared `let kernel` closure variable assigned immediately after `createKernel(...)` returns — `getKernel` is only ever *called* from inside `run()`, well after `kernel.start()`, by which point the closure variable is assigned. This is the standard resolution for this kind of constructor-order cycle and needs no change to W1's `createKernel` signature.

The definition never imports `@agentos/adapters` directly — that would create a cyclic package dependency (`adapters` already depends on `@agentos/kernel` for `AdapterContext`/`ProjectAdapter`). Instead, `packages/kernel/src/adapters/types.ts` gains a new **kernel-owned** interface, `FeatureRequestAdapterOps`, and `ProjectAdapter` gains an optional `featureRequests?: FeatureRequestAdapterOps` field; `packages/adapters/src/techpulseCoo/requests.ts` implements that interface's five functions (`bootstrapCooLayout`, `pushProposal`, `openPullRequest`, `markShipped`, `writeReport`) against `AdapterContext` exactly like `adapter.ts`'s `sync`/`applyDecision` do (same `simple-git` commit-then-push-then-`ctx.log.append({type:'git.commit'|'git.push'})` pattern), and `adapter.ts` wires them onto `techpulseCooAdapter.featureRequests`. The definition resolves a project's ops via `deps.registry[project.adapter].featureRequests`.

Two deliberate design choices, because the spec describes step *outcomes* in prose that don't map 1:1 onto what a `claude -p` process can hand back through `step.run`'s `RunResult`:
1. **Slug, proposal path, and the next proposal number are computed by the kernel, not parsed from agent output.** `brief`'s `StepRunSpec.task` tells the agent exactly which wiki page to write to (`output/requests/<workflow id>/proposal.md`, using `ctx.id`); the definition reads that page back itself with `WikiService.readPage` once the step succeeds. `pushProposal` (adapter helper) computes the next `NNN` authoritatively by listing the clone's own proposals directory, ignoring nothing the agent might have guessed. This removes an entire class of brittleness (parsing free-form text for control-flow-critical facts) that the given interfaces don't need.
2. **Validate/review pass-fail is read from a `PASS`/`FAIL` first line in `resultText`, not from `RunResult.status`.** A `claude -p` process that runs `pnpm test` and observes a failure still *exits successfully* (Claude completed its turn) — `RunResult.status` only reflects whether the agent process itself crashed/timed out or completed (`'success'|'failed'|'killed'`). `feature-validate`/`feature-review`'s skill.md instruct the agent to start its final message with exactly `PASS` or `FAIL`; `parsePassFail()` in the definition reads that line. `RunResult.status !== 'success'` is still a hard failure (the run itself broke).

**Tech Stack:** TypeScript ^5.6 strict/ESM, Vitest, `zod@^3`, `gray-matter@^4`, `simple-git@^3`, `execa@^9`, `commander@^12`, `better-sqlite3@^12`.
**Spec:** `docs/superpowers/specs/2026-09-09-feature-requests-design.md` (§5 primary; §3 workflow-engine types consumed as given; §4.4 build permission; §7 CLI; §8 error handling; §9/§10 testing/milestones)
**Contract:** `docs/superpowers/plans/2026-09-08-agent-os-00-contract.md`

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Lint/format: Biome — single quotes, no semicolons, LF line endings (this repo's `biome.json`; every code sample below already follows it).
- Tests live next to their source file (`foo.ts` / `foo.test.ts`), per existing convention.
- No new runtime dependencies. `@agentos/adapters` is added to `packages/kernel/package.json` as a **`devDependency` only** (Task 5) so `featureRequest.test.ts` can exercise the real `techpulseCooAdapter` against a temp git repo; this is safe because pnpm/`tsup`'s build-order topological sort follows `dependencies`, not `devDependencies` — it does not reintroduce the `adapters → kernel → adapters` runtime cycle that importing `@agentos/adapters` from `featureRequest.ts`'s own *source* would create.
- `--strict-mcp-config` and the per-run syscall token are already applied to every spawned process by `ProcessManager.start`/`buildArgs` (existing M2 code) — nothing new to add for that guarantee.
- **The agent never pushes to `base_branch`.** `feature-build`'s skill.md explicitly forbids `git push`; only the adapter helpers (`pushProposal`, `openPullRequest`'s branch push, `markShipped`, `writeReport`) push, and only they touch `docs/missions/coo/`.
- The PR body is scanned with `findSecrets` before `gh pr create`; `openPullRequest` throws `SecretDetectedError` and never invokes `gh` if a secret is found.
- No absolute local paths, hostnames, or secrets in any committed file. Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Every git commit this workflow's adapter helpers make also ends with `Co-Authored-By: Claude via agent-os <noreply@anthropic.com>` (matching `adapter.ts`'s existing `applyDecision`/`ensureClone` commits exactly, so `git log` in a managed repo reads consistently regardless of which code path made the commit).

## Coordination notes (resolved by team-lead ruling before this task list was finalized)
- **W1** (`docs/superpowers/plans/2026-09-09-feature-requests-w1-workflow-engine.md`): owns and this plan *consumes without redefining* — `WorkflowDefinition<I>`, `WorkflowContext<I>` (with `readonly id: string`), `WorkflowStepApi`, `StepOptions`, `StepRunSpec` (`packages/kernel/src/workflow/types.ts`); `RunResult` (`packages/kernel/src/process/processManager.ts`, pre-existing from M2); `FeatureRequestInput` lives in **W1's** `packages/shared/src/types/workflow.ts` (this plan's Task 1 appends it there); `CreateWorkflowRequest`/`CreateWorkflowResponse` (`packages/shared/src/types/api.ts`) and `ApiClient.createWorkflow`/`registerWorkflowsCommand` (`packages/cli`) are also W1's (its Task 11) — Task 8 below reuses them, it does not redefine them. `createKernel(cfg, adapterRegistry, workflowDefinitions)`'s third parameter (an array of `WorkflowDefinition[]`, registered inside `KernelImpl`'s constructor) is the exact seam this plan's Task 5 plugs into, via `up.ts` — not `kernel.ts`, see Architecture.
- **W1**: wherever the engine turns a `StepRunSpec` into a `ProcessManager` `SpawnSpec`, it must call `assertCloneCwdAllowed` (Task 2) before spawning any step whose `StepRunSpec.cwd` is set, passing the step's resolved `ProjectConfig`. Already sent as a heads-up message; this plan's own tasks build and test the guard function itself so W3 isn't blocked waiting for that wiring, and it is not this plan's place to edit W1's engine internals to call it.
- **W2** (`docs/superpowers/plans/2026-09-09-feature-requests-w2-github-projects.md`): owns `ProjectBuildConfig` (not `BuildConfig` — team-lead ruling) and `ProjectConfig.build?: ProjectBuildConfig` in `packages/shared/src/types/project.ts`, plus `ProjectBuildConfigSchema` in `packages/shared/src/schemas.ts`. This plan only *consumes* `ProjectBuildConfig` (Task 5) — no shared-types task of its own adds or redefines it.

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/types/workflow.ts` | *Modify* (W1-owned file): append `FeatureRequestInput` |
| `packages/kernel/src/workflow/slug.ts` | `slugify(title): string` |
| `packages/kernel/src/workflow/buildContainment.ts` | `assertCloneCwdAllowed`, `CwdNotAllowedError` |
| `packages/kernel/src/log/eventLog.ts` | *Modify*: `resolveDecision` appends a `decision.resolved` event |
| `packages/kernel/src/adapters/types.ts` | *Modify*: `FeatureRequestAdapterOps` and its I/O types; `ProjectAdapter.featureRequests?` |
| `packages/kernel/package.json` / `scripts/postbuild.mjs` | *Modify*: `./wiki/redact` export subpath; `@agentos/adapters` devDependency |
| `packages/adapters/src/techpulseCoo/adapter.ts` | *Modify*: export `ensureClone`; wire `featureRequests` |
| `packages/adapters/src/techpulseCoo/requests.ts` | `bootstrapCooLayout`, `pushProposal`, `openPullRequest`, `markShipped`, `writeReport` |
| `packages/kernel/src/workflow/definitions/featureRequest.ts` | `createFeatureRequestWorkflow`, `FeatureRequestDeps`, `FeatureRequestKernelDeps` |
| `packages/kernel/src/index.ts` | *Modify*: re-export `./workflow/definitions/featureRequest.js` |
| `packages/cli/src/commands/up.ts` | *Modify*: build and pass `createFeatureRequestWorkflow(...)` into `createKernel`'s third parameter |
| `examples/os-template/os/skills/feature-brief/{skill.md,learnings.md,eval.json,context/handoff.md}` | feature-brief skill |
| `examples/os-template/os/skills/feature-build/{...}` | feature-build skill |
| `examples/os-template/os/skills/feature-validate/{...}` | feature-validate skill |
| `examples/os-template/os/skills/feature-review/{...}` | feature-review skill |
| `examples/os-template/os/agents/ops/AGENT.md` | *Modify*: document the four new skills and the build-grant exception |
| `packages/cli/src/commands/request.ts` | `requestFeature(client, opts, readFile?)` |
| `packages/cli/src/bin.ts` | *Modify*: register `agentos request` |

## Task 1: `FeatureRequestInput` (appended to W1's `packages/shared/src/types/workflow.ts`)

Per team-lead ruling, `packages/shared/src/types/workflow.ts` is W1's file (it already defines `WorkflowStatus`, `WorkflowInstance`, `WorkflowStepStatus`, `WorkflowStep` there) and `ProjectBuildConfig`/`ProjectConfig.build` is W2's (`packages/shared/src/types/project.ts`) — this task only appends `FeatureRequestInput` to W1's file. Nothing else in `packages/shared` belongs to this plan.

**Files:** Modify: `packages/shared/src/types/workflow.ts` (W1-owned). Test: `packages/shared/src/types/workflow.featureRequestInput.test.ts`.
**Interfaces:** Produces: `FeatureRequestInput` (spec §5.1) — consumed by Task 5 (`WorkflowContext<FeatureRequestInput>`) and Task 8 (the CLI builds a `CreateWorkflowRequest.input` of this shape).

- [ ] **Step 1: failing test**

```ts
// packages/shared/src/types/workflow.featureRequestInput.test.ts
import { describe, expect, it } from 'vitest'
import type { FeatureRequestInput } from './workflow.js'

describe('FeatureRequestInput', () => {
  it('accepts the spec §5.1 shape', () => {
    const input: FeatureRequestInput = {
      project: 'techpulse',
      title: 'Add dark mode toggle',
      description: 'Users keep asking for it.',
      autoApprove: true,
    }
    expect(input.project).toBe('techpulse')
    expect(input.title).toBe('Add dark mode toggle')
    expect(input.autoApprove).toBe(true)
  })
})
```

- [ ] **Step 2: run it, expect failure**
  `pnpm --filter @agentos/shared typecheck`
  Expected: fails — `FeatureRequestInput` is not exported from `./workflow.js`. (`FeatureRequestInput` is a plain interface, erased at runtime by Vitest's transpiler, so the "test" step in this task's cycle is the typecheck command, not `vitest run` — the same reason M1's `CreateRunRequest` has no dedicated runtime test either. The `it()` block above still runs and passes once Step 3 lands, giving a concrete regression check alongside the type.)

- [ ] **Step 3: implementation**

```ts
// packages/shared/src/types/workflow.ts — append at the end of the file (alongside WorkflowStatus/WorkflowInstance/WorkflowStep, which W1 already defined here)
/** Input to the `feature-request` workflow kind (spec §5.1). */
export interface FeatureRequestInput {
  project: string
  title: string
  description: string
  autoApprove: boolean
}
```

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/shared typecheck && pnpm --filter @agentos/shared test -- src/types/workflow.featureRequestInput.test.ts`
  If W1 has already appended a `FeatureRequestInput` of this exact shape to `workflow.ts` by the time this task starts (the two plans could land in either order), skip Step 3 and just confirm this test passes against W1's version unchanged.

- [ ] **Step 5: commit**
```
git add packages/shared/src/types/workflow.ts packages/shared/src/types/workflow.featureRequestInput.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add FeatureRequestInput (spec §5.1)

Appended to workflow.ts (W1's file) rather than a new module, so every
WorkflowContext<I>-typed consumer imports workflow input shapes from one
place.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 2: Kernel workflow support — `slugify`, build-cwd containment, `decision.resolved` event

**Files:** Create: `packages/kernel/src/workflow/slug.ts`, `packages/kernel/src/workflow/slug.test.ts`, `packages/kernel/src/workflow/buildContainment.ts`, `packages/kernel/src/workflow/buildContainment.test.ts`. Modify: `packages/kernel/src/log/eventLog.ts`. Test: `packages/kernel/src/log/eventLog.decisionResolved.test.ts`.
**Interfaces:** Produces: `slugify(title): string`, `assertCloneCwdAllowed(input)`, `CwdNotAllowedError` — consumed by Task 5. `EventLog.resolveDecision` gains a side effect (appends `decision.resolved`) consumed by Task 5's `await-approval` step and, going forward, by the dashboard's decision-approve flow.

This task fixes a real, pre-existing gap: `'decision.resolved'` has been a valid `EventType` since M1 (contract §3), but no code path (`api/server.ts`'s approve/reject route, `adapter.ts`'s `applyDecision`) actually appends that event — only the DB row's `status` column changes. Without this fix, `step.waitForEvent('decision.resolved', ...)` in Task 5 would time out on every real approval. Fixing it once inside `EventLog.resolveDecision` (the single choke point both callers already go through) covers every caller, not just this workflow's.

- [ ] **Step 1: failing test for `slugify`**

```ts
// packages/kernel/src/workflow/slug.test.ts
import { describe, expect, it } from 'vitest'
import { slugify } from './slug.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Add dark mode toggle')).toBe('add-dark-mode-toggle')
  })
  it('strips punctuation and collapses runs of non-alnum characters', () => {
    expect(slugify("Fix the /api/news 500 error!!")).toBe('fix-the-api-news-500-error')
  })
  it('strips diacritics', () => {
    expect(slugify('Résumé import')).toBe('resume-import')
  })
  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --already hyphenated--  ')).toBe('already-hyphenated')
  })
  it('truncates long titles to 48 characters without a trailing hyphen', () => {
    const slug = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(48)
    expect(slug.endsWith('-')).toBe(false)
  })
  it('falls back to "untitled" for a title with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('untitled')
  })
})
```

- [ ] **Step 2: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/workflow/slug.test.ts`
  Expected: fails — `slug.ts` does not exist.

- [ ] **Step 3: implementation**

```ts
// packages/kernel/src/workflow/slug.ts
const MAX_SLUG_LENGTH = 48

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'untitled'
}
```

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/workflow/slug.test.ts`

- [ ] **Step 5: failing test for `assertCloneCwdAllowed`**

```ts
// packages/kernel/src/workflow/buildContainment.test.ts
import path from 'node:path'
import type { ProjectConfig } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import { assertCloneCwdAllowed, CwdNotAllowedError } from './buildContainment.js'

const osRoot = path.join('fake', 'os')
const workspace = path.join(osRoot, 'agents', 'ops', 'workspace')
const clone = path.join('fake', 'clones', 'techpulse')

const buildEnabledProject: ProjectConfig = {
  name: 'techpulse',
  adapter: 'techpulse-coo',
  repo: 'owner/techpulse',
  clone,
  base_branch: 'main',
  options: {},
  build: {
    enabled: true,
    model: 'sonnet',
    permission_mode: 'acceptEdits',
    allowed_tools: ['Bash'],
    checks: [],
    timeout_ms: 60_000,
  },
}

describe('assertCloneCwdAllowed', () => {
  it('allows the default agent workspace cwd regardless of project', () => {
    expect(() =>
      assertCloneCwdAllowed({ cwd: workspace, osRoot, agent: 'ops' }),
    ).not.toThrow()
  })

  it('rejects a non-workspace cwd with no project given', () => {
    expect(() =>
      assertCloneCwdAllowed({ cwd: clone, osRoot, agent: 'ops' }),
    ).toThrow(CwdNotAllowedError)
  })

  it('rejects a non-workspace cwd when the project has no build config', () => {
    const project: ProjectConfig = { ...buildEnabledProject, build: undefined }
    expect(() =>
      assertCloneCwdAllowed({ cwd: clone, osRoot, agent: 'ops', project }),
    ).toThrow(/build.enabled/)
  })

  it('rejects a non-workspace cwd when build.enabled is false', () => {
    const project: ProjectConfig = {
      ...buildEnabledProject,
      build: { ...buildEnabledProject.build!, enabled: false },
    }
    expect(() =>
      assertCloneCwdAllowed({ cwd: clone, osRoot, agent: 'ops', project }),
    ).toThrow(CwdNotAllowedError)
  })

  it('rejects a cwd that is neither the workspace nor exactly the clone, even with build.enabled', () => {
    expect(() =>
      assertCloneCwdAllowed({
        cwd: path.join('fake', 'somewhere', 'else'),
        osRoot,
        agent: 'ops',
        project: buildEnabledProject,
      }),
    ).toThrow(/must be exactly/)
  })

  it('allows cwd === project.clone when build.enabled is true', () => {
    expect(() =>
      assertCloneCwdAllowed({
        cwd: clone,
        osRoot,
        agent: 'ops',
        project: buildEnabledProject,
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 6: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/workflow/buildContainment.test.ts`
  Expected: fails — `buildContainment.ts` does not exist.

- [ ] **Step 7: implementation**

```ts
// packages/kernel/src/workflow/buildContainment.ts
import path from 'node:path'
import type { ProjectConfig } from '@agentos/shared'

export interface AssertCloneCwdAllowedInput {
  cwd: string
  osRoot: string
  agent: string
  project?: ProjectConfig
}

export class CwdNotAllowedError extends Error {}

/**
 * Guards the one containment rule spec §5.3/§4.4 rely on: a spawned run's
 * cwd may only be outside its agent's normal `agents/<agent>/workspace`
 * when the workflow's project has `build.enabled: true`, and even then it
 * must be exactly that project's clone directory -- never an arbitrary
 * path. The workflow engine's StepRunSpec -> SpawnSpec translation (W1)
 * must call this before every spawn where `spec.cwd` is set.
 */
export function assertCloneCwdAllowed(input: AssertCloneCwdAllowedInput): void {
  const workspace = path.resolve(input.osRoot, 'agents', input.agent, 'workspace')
  const cwd = path.resolve(input.cwd)
  if (cwd === workspace) return

  if (!input.project?.build?.enabled) {
    throw new CwdNotAllowedError(
      `cwd '${input.cwd}' is outside agents/${input.agent}/workspace and ` +
        (input.project
          ? `project '${input.project.name}' does not have build.enabled: true`
          : 'no project was given'),
    )
  }
  const clone = path.resolve(input.project.clone)
  if (cwd !== clone) {
    throw new CwdNotAllowedError(
      `cwd '${input.cwd}' must be exactly project '${input.project.name}''s ` +
        `clone directory ('${input.project.clone}') when build.enabled is true`,
    )
  }
}
```

- [ ] **Step 8: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/workflow/buildContainment.test.ts`

- [ ] **Step 9: failing test for `EventLog.resolveDecision` emitting `decision.resolved`**

```ts
// packages/kernel/src/log/eventLog.decisionResolved.test.ts
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from './eventLog.js'

let dbPath: string
let log: EventLog

beforeEach(async () => {
  dbPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-dr-')), 'test.db')
  log = new EventLog(dbPath)
})
afterEach(() => log.close())

describe('EventLog.resolveDecision', () => {
  it('appends a decision.resolved event carrying the ref and project', () => {
    const decision = log.createDecision({
      title: 't',
      body: 'b',
      adapter: 'techpulse-coo',
      project: 'techpulse',
      ref: 'proposals/001-slug.md',
    })
    log.resolveDecision(decision.id, 'approved')

    const events = log.listEvents({ types: ['decision.resolved'], limit: 10 })
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({
      decisionId: decision.id,
      status: 'approved',
      ref: 'proposals/001-slug.md',
      project: 'techpulse',
    })
  })

  it('still appends the event on an error resolution', () => {
    const decision = log.createDecision({ title: 't', body: 'b' })
    log.resolveDecision(decision.id, 'error', 'push failed')
    const events = log.listEvents({ types: ['decision.resolved'], limit: 10 })
    expect(events[0].payload).toMatchObject({ decisionId: decision.id, status: 'error' })
  })
})
```

- [ ] **Step 10: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/log/eventLog.decisionResolved.test.ts`
  Expected: fails — 0 `decision.resolved` events recorded. If a grep for `decision.resolved` inside `eventLog.ts`/`api/server.ts`/`adapter.ts` already finds an `append` call by the time this task starts (i.e. another milestone beat W3 to it), skip Step 11 and just confirm this test already passes.

- [ ] **Step 11: implementation — modify `resolveDecision` in `packages/kernel/src/log/eventLog.ts`**

```ts
// packages/kernel/src/log/eventLog.ts — replace the existing resolveDecision method
resolveDecision(
  id: string,
  status: 'approved' | 'rejected' | 'error',
  error?: string,
): Decision {
  const resolvedAt = nowIso()
  this.db
    .prepare(
      'UPDATE decisions SET status = ?, resolved_at = ?, error = ? WHERE id = ?',
    )
    .run(status, resolvedAt, error ?? null, id)
  const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id)
  if (!row) throw new Error(`Decision not found: ${id}`)
  const decision = rowToDecision(row)
  this.append({
    type: 'decision.resolved',
    payload: {
      decisionId: decision.id,
      status: decision.status,
      ref: decision.ref,
      project: decision.project,
    },
  })
  return decision
}
```

- [ ] **Step 12: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/log/eventLog.decisionResolved.test.ts src/log/eventLog.runtoken.test.ts`
  (also re-run the full kernel suite once: `pnpm --filter @agentos/kernel test` — `decisions.test.ts`/`server.ts` decision-route tests must still pass now that an extra event is appended on every resolution.)

- [ ] **Step 13: commit**
```
git add packages/kernel/src/workflow/slug.ts packages/kernel/src/workflow/slug.test.ts packages/kernel/src/workflow/buildContainment.ts packages/kernel/src/workflow/buildContainment.test.ts packages/kernel/src/log/eventLog.ts packages/kernel/src/log/eventLog.decisionResolved.test.ts
git commit -m "$(cat <<'EOF'
feat(kernel): add slugify/build-cwd containment, emit decision.resolved

slugify and assertCloneCwdAllowed are workflow-engine building blocks
for the feature-request workflow (spec §5.2/§5.3). EventLog.resolveDecision
now appends a decision.resolved event on every resolution (approve,
reject, or adapter error) -- previously no code path emitted it despite
being a documented EventType since M1, which would have made
step.waitForEvent('decision.resolved') time out on every real approval.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 3: `FeatureRequestAdapterOps` interface + `bootstrapCooLayout`/`pushProposal`

**Files:** Modify: `packages/kernel/src/adapters/types.ts`, `packages/adapters/src/techpulseCoo/adapter.ts` (export `ensureClone`). Create: `packages/adapters/src/techpulseCoo/requests.ts`, `packages/adapters/src/techpulseCoo/requests.test.ts`.
**Interfaces:** Consumes: `AdapterContext` (contract §5), `ensureClone` (adapter.ts, now exported), `createTempTechpulseRepo`/`PROPOSAL_1` (`test-helpers.ts`). Produces: `FeatureRequestAdapterOps` and its I/O types (kernel), `bootstrapCooLayout`, `pushProposal` (adapters) — consumed by Task 4 (wiring) and Task 5 (the definition).

- [ ] **Step 1: add the interface to kernel first (no test needed — a pure type addition, verified by Task 4/5's `satisfies`/assignment compiling)**

```ts
// packages/kernel/src/adapters/types.ts (full new content)
import type { Decision, EventType, ProjectConfig } from '@agentos/shared'
import type { KernelConfig } from '../config.js'
import type { EventLog } from '../log/eventLog.js'
import type { WikiService } from '../wiki/wikiService.js'

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

export interface FeatureRequestPushProposalInput {
  slug: string
  title: string
  proposalBody: string
  status: 'approved' | 'proposed'
}

export interface FeatureRequestPushProposalResult {
  file: string
  sha: string
  bootstrapped: boolean
}

export interface FeatureRequestOpenPrInput {
  branch: string
  slug: string
  title: string
  proposalFile: string
  proposalWhatWhy: string
  validationOutput: string
  reviewOutput: string
}

export interface FeatureRequestOpenPrResult {
  url: string
  number: number
}

export interface FeatureRequestWriteReportInput {
  slug: string
  branch: string
  prUrl: string
  validationOutput: string
  reviewOutput: string
}

export interface FeatureRequestWriteReportResult {
  file: string
  sha: string
}

/**
 * Adapter-specific operations the `feature-request` workflow (spec §5)
 * needs beyond sync/applyDecision. Optional on ProjectAdapter -- only
 * adapters that manage a proposals layout (currently just techpulse-coo)
 * implement it; the workflow refuses a project whose adapter doesn't.
 */
export interface FeatureRequestAdapterOps {
  bootstrapLayout(ctx: AdapterContext): Promise<{ created: string[] }>
  pushProposal(
    ctx: AdapterContext,
    input: FeatureRequestPushProposalInput,
  ): Promise<FeatureRequestPushProposalResult>
  openPullRequest(
    ctx: AdapterContext,
    input: FeatureRequestOpenPrInput,
  ): Promise<FeatureRequestOpenPrResult>
  markShipped(
    ctx: AdapterContext,
    slug: string,
    proposalFile: string,
  ): Promise<{ sha: string }>
  writeReport(
    ctx: AdapterContext,
    input: FeatureRequestWriteReportInput,
  ): Promise<FeatureRequestWriteReportResult>
}

export interface ProjectAdapter {
  name: string
  sync(ctx: AdapterContext): Promise<SyncResult>
  applyDecision(decision: Decision, ctx: AdapterContext): Promise<void>
  featureRequests?: FeatureRequestAdapterOps
}
```

- [ ] **Step 2: export `ensureClone` from `adapter.ts`**

```ts
// packages/adapters/src/techpulseCoo/adapter.ts — change the function declaration
export async function ensureClone(ctx: AdapterContext): Promise<void> {
  // ... body unchanged
}
```

- [ ] **Step 3: failing test for `bootstrapCooLayout`/`pushProposal`**

```ts
// packages/adapters/src/techpulseCoo/requests.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AdapterContext } from '@agentos/kernel/adapters/types'
import simpleGit from 'simple-git'
import { describe, expect, it } from 'vitest'
import { bootstrapCooLayout, pushProposal } from './requests.js'
import { createTempTechpulseRepo } from './test-helpers.js'

function fakeCtx(clone: string) {
  // biome-ignore lint/suspicious/noExplicitAny: test event capture
  const events: any[] = []
  const ctx: AdapterContext = {
    cfg: {
      osRoot: mkdtempSync(path.join(tmpdir(), 'agentos-os-')),
      runtimeDir: 'unused',
      dbPath: ':memory:',
      claudeBin: 'true',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'info',
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
    log: {
      append: (e: any) => {
        events.push(e)
        return { id: events.length, ts: new Date().toISOString(), ...e }
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: not exercised by these tests
    wiki: {} as any,
    project: {
      name: 'sandbox',
      adapter: 'techpulse-coo',
      repo: 'unused',
      clone,
      base_branch: 'main',
      options: {
        proposals_path: 'docs/missions/coo/proposals',
        state_path: 'docs/missions/coo/state.md',
        reports_path: 'docs/missions/coo/reports',
      },
    },
    runId: 'wf-1',
  }
  return { ctx, events }
}

async function createEmptyRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-empty-'))
  const bareDir = path.join(root, 'bare.git')
  const seedDir = path.join(root, 'seed')
  const cloneDir = path.join(root, 'clone')

  await simpleGit().raw(['init', '--bare', '--initial-branch=main', bareDir])
  mkdirSync(seedDir, { recursive: true })
  const seedGit = simpleGit(seedDir)
  await seedGit.raw(['init', '--initial-branch=main'])
  await seedGit.addConfig('user.name', 'Test User')
  await seedGit.addConfig('user.email', 'test@example.com')
  writeFileSync(path.join(seedDir, 'README.md'), '# empty repo\n')
  await seedGit.add('.')
  await seedGit.commit('seed')
  await seedGit.addRemote('origin', bareDir)
  await seedGit.push('origin', 'main')

  await simpleGit().clone(bareDir, cloneDir)
  const cloneGit = simpleGit(cloneDir)
  await cloneGit.addConfig('user.name', 'Test User')
  await cloneGit.addConfig('user.email', 'test@example.com')

  return { bareDir, cloneDir }
}

describe('bootstrapCooLayout', () => {
  it('reports nothing created when the layout already exists', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    const result = await bootstrapCooLayout(ctx)
    expect(result.created).toEqual([])
  })

  it('creates proposals/reports/.gitkeep and state.md when the repo has no coo layout', async () => {
    const { cloneDir } = await createEmptyRepo()
    const { ctx } = fakeCtx(cloneDir)
    const result = await bootstrapCooLayout(ctx)
    expect(result.created.sort()).toEqual(
      [
        'docs/missions/coo/proposals/.gitkeep',
        'docs/missions/coo/reports/.gitkeep',
        'docs/missions/coo/state.md',
      ].sort(),
    )
    expect(existsSync(path.join(cloneDir, 'docs/missions/coo/state.md'))).toBe(true)
  })
})

describe('pushProposal', () => {
  it('numbers the new proposal after the highest existing one, commits, and pushes', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx, events } = fakeCtx(cloneDir)

    const result = await pushProposal(ctx, {
      slug: 'faster-search',
      title: 'Make search faster',
      proposalBody: '## What you get\nFaster search.\n',
      status: 'approved',
    })

    expect(result.file).toBe('docs/missions/coo/proposals/002-faster-search.md')
    expect(result.bootstrapped).toBe(false)
    expect(events.some((e) => e.type === 'git.commit')).toBe(true)
    expect(events.some((e) => e.type === 'git.push')).toBe(true)

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const pushed = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/002-faster-search.md'),
      'utf8',
    )
    expect(pushed).toContain('status: approved')
    expect(pushed).toContain('# Make search faster')
    expect(pushed).toContain('Faster search.')
  })

  it('bootstraps the coo layout in the same commit as the first proposal', async () => {
    const { bareDir, cloneDir } = await createEmptyRepo()
    const { ctx } = fakeCtx(cloneDir)

    const result = await pushProposal(ctx, {
      slug: 'first-feature',
      title: 'First feature',
      proposalBody: '## What you get\nSomething new.\n',
      status: 'proposed',
    })

    expect(result.file).toBe('docs/missions/coo/proposals/001-first-feature.md')
    expect(result.bootstrapped).toBe(true)

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    expect(existsSync(path.join(verifyDir, 'docs/missions/coo/state.md'))).toBe(true)
    expect(existsSync(path.join(verifyDir, 'docs/missions/coo/reports/.gitkeep'))).toBe(true)
    const pushed = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/001-first-feature.md'),
      'utf8',
    )
    expect(pushed).toContain('status: proposed')
  })
})
```

- [ ] **Step 4: run it, expect failure**
  `pnpm --filter @agentos/adapters test -- src/techpulseCoo/requests.test.ts`
  Expected: fails — `requests.ts` does not exist.

- [ ] **Step 5: implementation**

```ts
// packages/adapters/src/techpulseCoo/requests.ts
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AdapterContext,
  FeatureRequestPushProposalInput,
  FeatureRequestPushProposalResult,
} from '@agentos/kernel/adapters/types'
import matter from 'gray-matter'
import simpleGit from 'simple-git'
import { ensureClone } from './adapter.js'

interface TechpulseCooOptions {
  proposals_path: string
  state_path: string
  reports_path: string
}

function opts(ctx: AdapterContext): TechpulseCooOptions {
  return ctx.project.options as unknown as TechpulseCooOptions
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  )
}

const posix = (p: string): string => p.replace(/\\/g, '/')

export interface BootstrapCooLayoutResult {
  /** repo-relative, posix paths this call created (empty if the layout already existed) */
  created: string[]
}

const STATE_PLACEHOLDER = '# COO state\n\nAll quiet.\n'

/**
 * Ensures the clone exists and is fresh on base_branch, then creates any
 * of docs/missions/coo/{proposals,reports}/.gitkeep and state.md that are
 * missing (spec §4.3 -- the first feature request on a repo with no COO
 * layout creates it). Idempotent: does nothing on a repo that already has
 * the layout, and is always called before pushProposal writes the
 * proposal file so both land in one commit.
 */
export async function bootstrapCooLayout(
  ctx: AdapterContext,
): Promise<BootstrapCooLayoutResult> {
  await ensureClone(ctx)
  const o = opts(ctx)
  const created: string[] = []

  for (const dirOpt of [o.proposals_path, o.reports_path]) {
    const dirAbs = path.join(ctx.project.clone, dirOpt)
    const gitkeep = path.join(dirAbs, '.gitkeep')
    if (!(await pathExists(gitkeep))) {
      await mkdir(dirAbs, { recursive: true })
      await writeFile(gitkeep, '', 'utf8')
      created.push(posix(`${dirOpt}/.gitkeep`))
    }
  }

  const stateAbs = path.join(ctx.project.clone, o.state_path)
  if (!(await pathExists(stateAbs))) {
    await mkdir(path.dirname(stateAbs), { recursive: true })
    await writeFile(stateAbs, STATE_PLACEHOLDER, 'utf8')
    created.push(posix(o.state_path))
  }

  return { created }
}

async function nextProposalNumber(ctx: AdapterContext): Promise<number> {
  const dir = path.join(ctx.project.clone, opts(ctx).proposals_path)
  const entries = await readdir(dir).catch(() => [] as string[])
  const numbers = entries
    .map((f) => /^(\d{3,})-/.exec(f)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number)
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
}

/**
 * Writes docs/missions/coo/proposals/<NNN>-<slug>.md (NNN computed here,
 * authoritatively, from the clone's own directory listing -- never trusted
 * from agent output), bootstraps the layout if needed, and commits+pushes
 * both in one commit to base_branch (spec §4.3, §5.2 step 2).
 */
export async function pushProposal(
  ctx: AdapterContext,
  input: FeatureRequestPushProposalInput,
): Promise<FeatureRequestPushProposalResult> {
  const bootstrap = await bootstrapCooLayout(ctx)
  const o = opts(ctx)
  const number = await nextProposalNumber(ctx)
  const filename = `${String(number).padStart(3, '0')}-${input.slug}.md`
  const relPath = posix(path.join(o.proposals_path, filename))
  const absPath = path.join(ctx.project.clone, relPath)

  const frontmatter = {
    title: input.title,
    status: input.status,
    attempts: 0,
    branch: null as string | null,
  }
  const content = matter.stringify(
    `# ${input.title}\n\n${input.proposalBody.trim()}\n`,
    frontmatter,
  )
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, 'utf8')

  const git = simpleGit(ctx.project.clone)
  await git.add([...bootstrap.created, relPath])
  const subject = `feat(coo): propose ${input.slug}`
  const commitResult = await git.commit(
    `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
  )
  ctx.log.append({
    type: 'git.commit',
    runId: ctx.runId,
    payload: { slug: input.slug, sha: commitResult.commit, message: subject },
  })
  await git.push('origin', ctx.project.base_branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug: input.slug, branch: ctx.project.base_branch },
  })

  return { file: relPath, sha: commitResult.commit, bootstrapped: bootstrap.created.length > 0 }
}
```

- [ ] **Step 6: run tests, expect PASS**
  `pnpm --filter @agentos/adapters test -- src/techpulseCoo/requests.test.ts`
  Also `pnpm --filter @agentos/adapters typecheck` and `pnpm --filter @agentos/kernel typecheck`.

- [ ] **Step 7: commit**
```
git add packages/kernel/src/adapters/types.ts packages/adapters/src/techpulseCoo/adapter.ts packages/adapters/src/techpulseCoo/requests.ts packages/adapters/src/techpulseCoo/requests.test.ts
git commit -m "$(cat <<'EOF'
feat(adapters): add bootstrapCooLayout/pushProposal for feature requests

FeatureRequestAdapterOps (kernel/adapters/types.ts) is the new optional
ProjectAdapter capability the feature-request workflow calls through --
this keeps packages/kernel from importing @agentos/adapters directly and
creating a package cycle. pushProposal numbers proposals from the
clone's own listing (never from agent-reported text) and bootstraps the
docs/missions/coo layout in the same commit when it's missing (spec §4.3).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 4: `openPullRequest`/`markShipped`/`writeReport` + wire `techpulseCooAdapter.featureRequests`

**Files:** Modify: `packages/kernel/src/index.ts` (export `wiki/redact`), `packages/kernel/package.json`, `packages/kernel/scripts/postbuild.mjs`, `packages/adapters/src/techpulseCoo/adapter.ts`. Create: `packages/adapters/src/techpulseCoo/requests.test.ts` (extend Task 3's file).
**Interfaces:** Consumes: `findSecrets`/`SecretDetectedError` (`wiki/redact.ts`, now exported at `@agentos/kernel/wiki/redact`), `setStatus` (`frontmatter.ts`), `FeatureRequestOpenPrInput/Result`, `FeatureRequestWriteReportInput/Result` (Task 3). Produces: `openPullRequest`, `markShipped`, `writeReport` — consumed by Task 5.

- [ ] **Step 1: add the `./wiki/redact` export subpath to kernel (mirrors the existing `./adapters/types` shim)**

```json
// packages/kernel/package.json — add alongside the existing "./adapters/types" entry in "exports"
"./wiki/redact": {
  "types": "./dist/wiki/redact.d.ts",
  "import": "./dist/wiki/redact.js"
}
```

```js
// packages/kernel/scripts/postbuild.mjs — append after the existing dist/adapters/types.js writes
mkdirSync('dist/wiki', { recursive: true })
writeFileSync('dist/wiki/redact.js', "export * from '../index.js'\n")
writeFileSync('dist/wiki/redact.d.ts', "export * from '../index.js'\n")
```

```ts
// packages/kernel/src/index.ts — add this line (findSecrets/SecretDetectedError were not previously re-exported)
export * from './wiki/redact.js'
```

- [ ] **Step 2: failing test for `openPullRequest`/`markShipped`/`writeReport`, appended to `requests.test.ts`**

```ts
// packages/adapters/src/techpulseCoo/requests.test.ts — add these imports
import { chmodSync, writeFileSync as writeFileSyncFs } from 'node:fs'
import { openPullRequest, markShipped, writeReport } from './requests.js'

// add near the top of the file, after the other helpers
function writeFakeGh(root: string): string {
  const scriptPath = path.join(root, 'fake-gh.js')
  writeFileSyncFs(
    scriptPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'pr' && args[1] === 'create') {
  console.log('https://github.com/owner/sandbox/pull/42')
  process.exit(0)
}
process.exit(1)
`,
    'utf8',
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

// add new describe blocks
describe('openPullRequest', () => {
  const originalGhBin = process.env.AGENTOS_GH_BIN
  afterEach(() => {
    if (originalGhBin === undefined) delete process.env.AGENTOS_GH_BIN
    else process.env.AGENTOS_GH_BIN = originalGhBin
  })

  it('pushes the branch and returns the PR url/number from gh', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    process.env.AGENTOS_GH_BIN = writeFakeGh(
      mkdtempSync(path.join(tmpdir(), 'agentos-gh-')),
    )

    const git = simpleGit(cloneDir)
    await git.checkoutLocalBranch('req/faster-search')
    writeFileSync(path.join(cloneDir, 'CHANGED.md'), 'change\n')
    await git.add('CHANGED.md')
    await git.commit('feat: faster search')

    const result = await openPullRequest(ctx, {
      branch: 'req/faster-search',
      slug: 'faster-search',
      title: 'Make search faster',
      proposalFile: 'docs/missions/coo/proposals/001-dark-mode.md',
      proposalWhatWhy: '## What you get\nFaster search.',
      validationOutput: 'PASS\nall checks green',
      reviewOutput: 'PASS\nlooks good',
    })

    expect(result).toEqual({ url: 'https://github.com/owner/sandbox/pull/42', number: 42 })

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const branches = await simpleGit(verifyDir).branch(['-r'])
    expect(branches.all).toContain('origin/req/faster-search')
  })

  it('refuses to open a PR when the body contains a secret', async () => {
    const { cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)
    process.env.AGENTOS_GH_BIN = writeFakeGh(
      mkdtempSync(path.join(tmpdir(), 'agentos-gh-')),
    )
    const git = simpleGit(cloneDir)
    await git.checkoutLocalBranch('req/leaky')
    writeFileSync(path.join(cloneDir, 'CHANGED.md'), 'change\n')
    await git.add('CHANGED.md')
    await git.commit('feat: leaky')

    await expect(
      openPullRequest(ctx, {
        branch: 'req/leaky',
        slug: 'leaky',
        title: 'Leaky',
        proposalFile: 'docs/missions/coo/proposals/001-dark-mode.md',
        proposalWhatWhy: 'fine',
        validationOutput: `key = AKIAABCDEFGHIJKLMNOP`,
        reviewOutput: 'PASS',
      }),
    ).rejects.toThrow(/Secret/)
  })
})

describe('markShipped / writeReport', () => {
  it('flips status to shipped and writes a report, each its own commit on base_branch', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const { ctx } = fakeCtx(cloneDir)

    const shipResult = await markShipped(
      ctx,
      'dark-mode',
      'docs/missions/coo/proposals/001-dark-mode.md',
    )
    expect(shipResult.sha).toBeTruthy()

    const reportResult = await writeReport(ctx, {
      slug: 'dark-mode',
      branch: 'req/dark-mode',
      prUrl: 'https://github.com/owner/sandbox/pull/42',
      validationOutput: 'PASS\nall green',
      reviewOutput: 'PASS\nlooks good',
    })
    expect(reportResult.file).toBe('docs/missions/coo/reports/dark-mode.md')

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const proposal = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/001-dark-mode.md'),
      'utf8',
    )
    expect(proposal).toContain('status: shipped')
    const report = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/reports/dark-mode.md'),
      'utf8',
    )
    expect(report).toContain('https://github.com/owner/sandbox/pull/42')
    expect(report).toContain('all green')
  })
})
```

- [ ] **Step 3: run it, expect failure**
  `pnpm --filter @agentos/adapters test -- src/techpulseCoo/requests.test.ts`
  Expected: fails — `openPullRequest`/`markShipped`/`writeReport` are not exported from `requests.ts`.

- [ ] **Step 4: implementation — append to `packages/adapters/src/techpulseCoo/requests.ts`**

```ts
// packages/adapters/src/techpulseCoo/requests.ts — add these imports at the top
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type {
  FeatureRequestOpenPrInput,
  FeatureRequestOpenPrResult,
  FeatureRequestWriteReportInput,
  FeatureRequestWriteReportResult,
} from '@agentos/kernel/adapters/types'
import { findSecrets, SecretDetectedError } from '@agentos/kernel/wiki/redact'
import { execa } from 'execa'
import { setStatus } from './frontmatter.js'

// append at the end of the file
function ghInvoke(args: string[]) {
  const bin = process.env.AGENTOS_GH_BIN ?? 'gh'
  // Mirrors ProcessManager's resolveCommand: a fake gh shipped as a plain
  // .js test double has no OS-level executable bit on every platform, so
  // run it through the current Node binary instead of exec'ing it directly.
  if (bin.endsWith('.js')) return execa(process.execPath, [bin, ...args])
  return execa(bin, args)
}

function buildPrBody(input: FeatureRequestOpenPrInput): string {
  return [
    '## What you get / Why start this now',
    input.proposalWhatWhy.trim(),
    '',
    '## Validation',
    input.validationOutput.trim() || '(no validation output recorded)',
    '',
    '## Review',
    input.reviewOutput.trim() || '(no review output recorded)',
    '',
    '---',
    `Proposal: ${input.proposalFile}`,
    '',
    'Co-Authored-By: Claude via agent-os <noreply@anthropic.com>',
  ].join('\n')
}

/**
 * Pushes the agent-built branch, then opens a PR via `gh pr create` (spec
 * §5.2 step 7). The PR body is scanned with findSecrets before gh ever
 * runs (spec §5.3) -- a hit throws and gh is never invoked.
 */
export async function openPullRequest(
  ctx: AdapterContext,
  input: FeatureRequestOpenPrInput,
): Promise<FeatureRequestOpenPrResult> {
  const body = buildPrBody(input)
  const secrets = findSecrets(body)
  if (secrets.length > 0) throw new SecretDetectedError(secrets)

  const git = simpleGit(ctx.project.clone)
  await git.push('origin', input.branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug: input.slug, branch: input.branch },
  })

  const bodyDir = await mkdtemp(path.join(tmpdir(), 'agentos-pr-'))
  const bodyFile = path.join(bodyDir, 'body.md')
  await writeFile(bodyFile, body, 'utf8')
  try {
    const result = await ghInvoke([
      'pr',
      'create',
      '--repo',
      ctx.project.repo,
      '--base',
      ctx.project.base_branch,
      '--head',
      input.branch,
      '--title',
      `feat: ${input.title}`,
      '--body-file',
      bodyFile,
    ])
    const url = result.stdout.trim().split('\n').pop() ?? ''
    const match = /\/pull\/(\d+)/.exec(url)
    return { url, number: match ? Number(match[1]) : 0 }
  } finally {
    await rm(bodyDir, { recursive: true, force: true })
  }
}

/** Flips the proposal's frontmatter status to shipped on base_branch (spec §5.2 step 7). */
export async function markShipped(
  ctx: AdapterContext,
  slug: string,
  proposalFile: string,
): Promise<{ sha: string }> {
  const git = simpleGit(ctx.project.clone)
  await git.checkout(ctx.project.base_branch)
  await git.pull('origin', ctx.project.base_branch, ['--ff-only'])

  const absPath = path.join(ctx.project.clone, proposalFile)
  const content = await readFile(absPath, 'utf8')
  await writeFile(absPath, setStatus(content, 'shipped'), 'utf8')

  await git.add([posix(proposalFile)])
  const subject = `chore(coo): ship ${slug}`
  const commitResult = await git.commit(
    `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
  )
  ctx.log.append({
    type: 'git.commit',
    runId: ctx.runId,
    payload: { slug, sha: commitResult.commit, message: subject },
  })
  await git.push('origin', ctx.project.base_branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug, branch: ctx.project.base_branch },
  })

  return { sha: commitResult.commit }
}

/** Writes docs/missions/coo/reports/<slug>.md on base_branch (spec §5.2 step 7). */
export async function writeReport(
  ctx: AdapterContext,
  input: FeatureRequestWriteReportInput,
): Promise<FeatureRequestWriteReportResult> {
  const o = opts(ctx)
  const relPath = posix(path.join(o.reports_path, `${input.slug}.md`))
  const absPath = path.join(ctx.project.clone, relPath)
  const content = [
    `# Report: ${input.slug}`,
    '',
    `- branch: ${input.branch}`,
    `- pull request: ${input.prUrl}`,
    `- shipped: ${new Date().toISOString()}`,
    '',
    '## Validation',
    input.validationOutput.trim() || '(no validation output recorded)',
    '',
    '## Review',
    input.reviewOutput.trim() || '(no review output recorded)',
    '',
  ].join('\n')
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, 'utf8')

  const git = simpleGit(ctx.project.clone)
  await git.add([relPath])
  const subject = `docs(coo): report for ${input.slug}`
  const commitResult = await git.commit(
    `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
  )
  ctx.log.append({
    type: 'git.commit',
    runId: ctx.runId,
    payload: { slug: input.slug, sha: commitResult.commit, message: subject },
  })
  await git.push('origin', ctx.project.base_branch)
  ctx.log.append({
    type: 'git.push',
    runId: ctx.runId,
    payload: { slug: input.slug, branch: ctx.project.base_branch },
  })

  return { file: relPath, sha: commitResult.commit }
}
```

- [ ] **Step 5: wire the five ops onto `techpulseCooAdapter`**

```ts
// packages/adapters/src/techpulseCoo/adapter.ts — add this import
import { bootstrapCooLayout, markShipped, openPullRequest, pushProposal, writeReport } from './requests.js'

// packages/adapters/src/techpulseCoo/adapter.ts — add a featureRequests field to the exported object literal
export const techpulseCooAdapter: ProjectAdapter = {
  name: 'techpulse-coo',
  async sync(ctx: AdapterContext): Promise<SyncResult> { /* unchanged */ },
  async applyDecision(decision: Decision, ctx: AdapterContext): Promise<void> { /* unchanged */ },
  featureRequests: {
    bootstrapLayout: bootstrapCooLayout,
    pushProposal,
    openPullRequest,
    markShipped,
    writeReport,
  },
}
```

- [ ] **Step 6: run tests, expect PASS**
  `pnpm --filter @agentos/kernel build && pnpm --filter @agentos/adapters test -- src/techpulseCoo/requests.test.ts`
  The kernel build is required first because `@agentos/kernel/wiki/redact` resolves against `dist/`, per its `exports` map — a stale or missing `dist/wiki/redact.js` fails module resolution even though the source compiles.
  Also `pnpm --filter @agentos/adapters typecheck`.

- [ ] **Step 7: commit**
```
git add packages/kernel/src/index.ts packages/kernel/package.json packages/kernel/scripts/postbuild.mjs packages/adapters/src/techpulseCoo/adapter.ts packages/adapters/src/techpulseCoo/requests.ts packages/adapters/src/techpulseCoo/requests.test.ts
git commit -m "$(cat <<'EOF'
feat(adapters): add openPullRequest/markShipped/writeReport, wire featureRequests

openPullRequest pushes the branch and runs `gh pr create` (AGENTOS_GH_BIN
override for tests, mirroring ProcessManager's fake-binary convention),
scanning the PR body with findSecrets first (spec §5.3). markShipped and
writeReport each make their own commit+push to base_branch, matching
adapter.ts's existing applyDecision pattern. techpulseCooAdapter now
implements FeatureRequestAdapterOps.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 5: `featureRequest.ts` workflow definition

**Files:** Create: `packages/kernel/src/workflow/definitions/featureRequest.ts`, `packages/kernel/src/workflow/definitions/featureRequest.test.ts`. Modify: `packages/kernel/package.json` (devDependency), `packages/kernel/src/index.ts`, `packages/cli/src/commands/up.ts`.
**Interfaces:** Consumes (imported, never redefined): `WorkflowDefinition<I>`, `WorkflowContext<I>` (`.id: string`, `.input`, `.state`, `.step`, `.emit`), `WorkflowStepApi`, `StepOptions`, `StepRunSpec` (`packages/kernel/src/workflow/types.ts`, W1); `RunResult` (`packages/kernel/src/process/processManager.ts` — pre-existing M2 type, `{status:'success'|'failed'|'killed'; sessionId?; costUsd?; inputTokens?; outputTokens?; error?; resultText?}`); `FeatureRequestInput` (`@agentos/shared`, Task 1); `slugify` (Task 2); `FeatureRequestAdapterOps` and its I/O types (Task 3/4); `ProjectConfig`/`ProjectBuildConfig` (`@agentos/shared`, W2). Produces: `FeatureRequestDeps`, `FeatureRequestKernelDeps`, `createFeatureRequestWorkflow`.

- [ ] **Step 1: add `@agentos/adapters` as a kernel devDependency (test-only, see Global Constraints)**

```json
// packages/kernel/package.json — add to "devDependencies"
"@agentos/adapters": "workspace:*"
```
Run `pnpm install` after this edit so the workspace symlink exists before Step 3's test runs.

- [ ] **Step 2: failing test — a stub `step.run`/`step.do`/`step.waitForEvent` against a temp bare repo**

```ts
// packages/kernel/src/workflow/definitions/featureRequest.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { adapterRegistry } from '@agentos/adapters'
import simpleGit from 'simple-git'
import type { FeatureRequestInput, ProjectConfig } from '@agentos/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventLog } from '../../log/eventLog.js'
import type { RunResult } from '../../process/processManager.js'
import { WikiService } from '../../wiki/wikiService.js'
import { createFeatureRequestWorkflow, type FeatureRequestDeps, type FeatureRequestKernelDeps } from './featureRequest.js'

async function createBareCooRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-fr-'))
  const bareDir = path.join(root, 'bare.git')
  const seedDir = path.join(root, 'seed')
  const cloneDir = path.join(root, 'clone')

  await simpleGit().raw(['init', '--bare', '--initial-branch=main', bareDir])
  mkdirSync(seedDir, { recursive: true })
  const seedGit = simpleGit(seedDir)
  await seedGit.raw(['init', '--initial-branch=main'])
  await seedGit.addConfig('user.name', 'Test User')
  await seedGit.addConfig('user.email', 'test@example.com')
  mkdirSync(path.join(seedDir, 'docs/missions/coo/proposals'), { recursive: true })
  mkdirSync(path.join(seedDir, 'docs/missions/coo/reports'), { recursive: true })
  writeFileSync(path.join(seedDir, 'docs/missions/coo/state.md'), '# COO state\n\nAll quiet.\n')
  writeFileSync(path.join(seedDir, 'README.md'), '# sandbox\n')
  await seedGit.add('.')
  await seedGit.commit('seed')
  await seedGit.addRemote('origin', bareDir)
  await seedGit.push('origin', 'main')

  await simpleGit().clone(bareDir, cloneDir)
  const cloneGit = simpleGit(cloneDir)
  await cloneGit.addConfig('user.name', 'Test User')
  await cloneGit.addConfig('user.email', 'test@example.com')

  return { bareDir, cloneDir }
}

function project(clone: string, buildEnabled: boolean): ProjectConfig {
  return {
    name: 'sandbox',
    adapter: 'techpulse-coo',
    repo: 'owner/sandbox',
    clone,
    base_branch: 'main',
    options: {
      proposals_path: 'docs/missions/coo/proposals',
      state_path: 'docs/missions/coo/state.md',
      reports_path: 'docs/missions/coo/reports',
    },
    build: buildEnabled
      ? {
          enabled: true,
          model: 'sonnet',
          permission_mode: 'acceptEdits',
          allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
          checks: ['echo ok'],
          timeout_ms: 60_000,
        }
      : undefined,
  }
}

/** A stub `step.*` that runs synchronously and simulates what a real
 * claude -p process's mcp__agentos__remember calls and final text would
 * produce, keyed by step name. */
function fakeStep(wiki: WikiService, responses: Record<string, RunResult>) {
  const runCalls: Array<{ name: string; spec: unknown }> = []
  const waitForEventCalls: Array<{ name: string; eventType: string; opts: unknown }> = []
  return {
    runCalls,
    waitForEventCalls,
    step: {
      do: async <T>(_name: string, _opts: unknown, fn: () => Promise<T>) => fn(),
      sleep: async () => {},
      waitForEvent: async (name: string, eventType: string, opts: unknown) => {
        waitForEventCalls.push({ name, eventType, opts })
        return {}
      },
      run: async (name: string, spec: { task?: Record<string, unknown> }) => {
        runCalls.push({ name, spec })
        if (name === 'brief') {
          const proposalPath = spec.task?.proposalPath as string
          await wiki.writePage({
            path: proposalPath,
            content:
              '# Add dark mode toggle\n\n' +
              '## What you get\nA dark mode toggle.\n\n' +
              '## Why start this now\nUsers keep asking.\n\n' +
              '## Problem\nNo dark mode.\n\n' +
              '## Proposed solution\nAdd a toggle.\n\n' +
              '## Effort estimate\nSmall.\n\n' +
              '## Validation contract\n`echo ok` passes.\n\n' +
              '## Risks\nNone.\n',
            op: 'note',
          })
        }
        return responses[name] ?? { status: 'success' }
      },
    },
  }
}

let osRoot: string
let log: EventLog
let wiki: WikiService
let kernelDeps: FeatureRequestKernelDeps
let deps: FeatureRequestDeps
let syncCalls: string[]

beforeEach(async () => {
  osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-fr-os-'))
  mkdirSync(path.join(osRoot, 'wiki'), { recursive: true })
  log = new EventLog(path.join(osRoot, 'test.db'))
  wiki = new WikiService(osRoot, log)
  syncCalls = []
  kernelDeps = {
    cfg: {
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'true',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'info',
    },
    log,
    wiki,
    adapters: {
      loadProjects: vi.fn(),
      sync: async (name: string) => {
        syncCalls.push(name)
        return { added: [], changed: [], events: [] }
      },
    },
  }
  deps = { registry: adapterRegistry, getKernel: () => kernelDeps }
})

afterEach(() => {
  log.close()
})

describe('createFeatureRequestWorkflow', () => {
  it('stops after push-proposal when the project has no build grant, with proposal status approved', async () => {
    const { bareDir, cloneDir } = await createBareCooRepo()
    const proj = project(cloneDir, false)
    kernelDeps.adapters.loadProjects = vi.fn().mockResolvedValue([proj])
    const def = createFeatureRequestWorkflow(deps)
    const { step, runCalls, waitForEventCalls } = fakeStep(wiki, {})
    const input: FeatureRequestInput = {
      project: 'sandbox',
      title: 'Add dark mode toggle',
      description: 'Users keep asking for a dark mode toggle.',
      autoApprove: true,
    }

    await def.run({ id: 'wf-1', input, state: {}, step, emit: vi.fn() })

    expect(runCalls.map((c) => c.name)).toEqual(['brief'])
    expect(waitForEventCalls).toHaveLength(0)
    expect(syncCalls).toEqual(['sandbox'])

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-fr-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const fs = await import('node:fs/promises')
    const files = await fs.readdir(path.join(verifyDir, 'docs/missions/coo/proposals'))
    const proposalFile = files.find((f) => f.endsWith('.md'))
    expect(proposalFile).toBeTruthy()
    const content = await fs.readFile(
      path.join(verifyDir, 'docs/missions/coo/proposals', proposalFile as string),
      'utf8',
    )
    expect(content).toContain('status: approved')
  })

  it('waits on decision.resolved with the correct ref when autoApprove is false', async () => {
    const { cloneDir } = await createBareCooRepo()
    const proj = project(cloneDir, false)
    kernelDeps.adapters.loadProjects = vi.fn().mockResolvedValue([proj])
    const def = createFeatureRequestWorkflow(deps)
    const { step, waitForEventCalls } = fakeStep(wiki, {})
    const input: FeatureRequestInput = {
      project: 'sandbox',
      title: 'Add dark mode toggle',
      description: 'Users keep asking.',
      autoApprove: false,
    }

    await def.run({ id: 'wf-2', input, state: {}, step, emit: vi.fn() })

    expect(waitForEventCalls).toHaveLength(1)
    expect(waitForEventCalls[0].eventType).toBe('decision.resolved')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the match predicate directly
    const match = (waitForEventCalls[0].opts as any).match as (e: unknown) => boolean
    expect(match({ payload: { ref: 'not-it' } })).toBe(false)
    const [decision] = log.listDecisions({ status: 'pending' })
    expect(decision).toBeTruthy()
    expect(match({ payload: { ref: decision.ref } })).toBe(true)
  })

  it('runs the full pipeline through open-pr/done when build is enabled and every check passes', async () => {
    const { bareDir, cloneDir } = await createBareCooRepo()
    const proj = project(cloneDir, true)
    kernelDeps.adapters.loadProjects = vi.fn().mockResolvedValue([proj])
    const bodyDir = mkdtempSync(path.join(tmpdir(), 'agentos-gh-'))
    const { writeFileSync: wf, chmodSync } = await import('node:fs')
    const ghScript = path.join(bodyDir, 'fake-gh.js')
    wf(
      ghScript,
      `#!/usr/bin/env node\nconsole.log('https://github.com/owner/sandbox/pull/7')\nprocess.exit(0)\n`,
      'utf8',
    )
    chmodSync(ghScript, 0o755)
    const originalGhBin = process.env.AGENTOS_GH_BIN
    process.env.AGENTOS_GH_BIN = ghScript

    const def = createFeatureRequestWorkflow(deps)
    const { step, runCalls } = fakeStep(wiki, {
      validate: { status: 'success', resultText: 'PASS\nall checks green' },
      review: { status: 'success', resultText: 'PASS\nlooks good' },
    })
    const input: FeatureRequestInput = {
      project: 'sandbox',
      title: 'Add dark mode toggle',
      description: 'Users keep asking.',
      autoApprove: true,
    }

    try {
      await def.run({ id: 'wf-3', input, state: {}, step, emit: vi.fn() })
    } finally {
      if (originalGhBin === undefined) delete process.env.AGENTOS_GH_BIN
      else process.env.AGENTOS_GH_BIN = originalGhBin
    }

    expect(runCalls.map((c) => c.name)).toEqual(['brief', 'build', 'validate', 'review'])

    const summary = await wiki.readPage('output/requests/wf-3/summary.md')
    expect(summary).toContain('pull request')
    const requestPage = await wiki.readPage('projects/sandbox/requests/add-dark-mode-toggle.md')
    expect(requestPage).toContain('https://github.com/owner/sandbox/pull/7')

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-fr-verify2-'))
    await simpleGit().clone(bareDir, verifyDir)
    const branches = await simpleGit(verifyDir).branch(['-r'])
    expect(branches.all).toContain('origin/req/add-dark-mode-toggle')
    const fs = await import('node:fs/promises')
    const files = await fs.readdir(path.join(verifyDir, 'docs/missions/coo/proposals'))
    const content = await fs.readFile(
      path.join(verifyDir, 'docs/missions/coo/proposals', files[0]),
      'utf8',
    )
    expect(content).toContain('status: shipped')
    expect(
      await fs.readFile(
        path.join(verifyDir, 'docs/missions/coo/reports/add-dark-mode-toggle.md'),
        'utf8',
      ),
    ).toContain('pull/7')
  })

  it('retries build once on a validate FAIL, then succeeds', async () => {
    const { cloneDir } = await createBareCooRepo()
    const proj = project(cloneDir, true)
    kernelDeps.adapters.loadProjects = vi.fn().mockResolvedValue([proj])
    const bodyDir = mkdtempSync(path.join(tmpdir(), 'agentos-gh-'))
    const { writeFileSync: wf, chmodSync } = await import('node:fs')
    const ghScript = path.join(bodyDir, 'fake-gh.js')
    wf(ghScript, `#!/usr/bin/env node\nconsole.log('https://github.com/owner/sandbox/pull/9')\nprocess.exit(0)\n`, 'utf8')
    chmodSync(ghScript, 0o755)
    const originalGhBin = process.env.AGENTOS_GH_BIN
    process.env.AGENTOS_GH_BIN = ghScript

    const def = createFeatureRequestWorkflow(deps)
    const { step, runCalls } = fakeStep(wiki, {
      validate: { status: 'success', resultText: 'FAIL\ntypecheck failed on Foo.ts' },
      'validate-fix': { status: 'success', resultText: 'PASS\nall checks green' },
      'review-fix': { status: 'success', resultText: 'PASS\nlooks good' },
    })
    const input: FeatureRequestInput = {
      project: 'sandbox', title: 'Fix thing', description: 'desc', autoApprove: true,
    }

    try {
      await def.run({ id: 'wf-4', input, state: {}, step, emit: vi.fn() })
    } finally {
      if (originalGhBin === undefined) delete process.env.AGENTOS_GH_BIN
      else process.env.AGENTOS_GH_BIN = originalGhBin
    }

    expect(runCalls.map((c) => c.name)).toEqual([
      'brief', 'build', 'validate', 'build-fix', 'validate-fix', 'review-fix',
    ])
    const buildFixCall = runCalls.find((c) => c.name === 'build-fix')
    // biome-ignore lint/suspicious/noExplicitAny: reading the injected task back
    expect((buildFixCall?.spec as any).task.priorFailure).toContain('typecheck failed on Foo.ts')
  })

  it('fails the instance when validate still fails after the one fix attempt', async () => {
    const { cloneDir } = await createBareCooRepo()
    const proj = project(cloneDir, true)
    kernelDeps.adapters.loadProjects = vi.fn().mockResolvedValue([proj])
    const def = createFeatureRequestWorkflow(deps)
    const { step, runCalls } = fakeStep(wiki, {
      validate: { status: 'success', resultText: 'FAIL\nstill broken' },
      'validate-fix': { status: 'success', resultText: 'FAIL\nstill broken' },
    })
    const input: FeatureRequestInput = {
      project: 'sandbox', title: 'Fix thing', description: 'desc', autoApprove: true,
    }

    await expect(
      def.run({ id: 'wf-5', input, state: {}, step, emit: vi.fn() }),
    ).rejects.toThrow(/validate failed after one fix attempt/)
    expect(runCalls.map((c) => c.name)).toEqual(['brief', 'build', 'validate', 'build-fix', 'validate-fix'])
  })
})
```

- [ ] **Step 3: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/workflow/definitions/featureRequest.test.ts`
  Expected: fails — `featureRequest.ts` does not exist.

- [ ] **Step 4: implementation**

```ts
// packages/kernel/src/workflow/definitions/featureRequest.ts
import path from 'node:path'
import type { FeatureRequestInput, PermissionMode, ProjectConfig } from '@agentos/shared'
import matter from 'gray-matter'
import type { AdapterContext, ProjectAdapter, SyncResult } from '../../adapters/types.js'
import type { AdapterHost } from '../../adapters/adapterHost.js'
import type { KernelConfig } from '../../config.js'
import type { EventLog } from '../../log/eventLog.js'
import type { RunResult } from '../../process/processManager.js'
import type { WikiService } from '../../wiki/wikiService.js'
import { slugify } from '../slug.js'
import type { StepRunSpec, WorkflowContext, WorkflowDefinition } from '../types.js'

/**
 * The subset of a live Kernel this definition needs. Not `Kernel` itself
 * (packages/kernel/src/kernel.ts) -- see FeatureRequestDeps below for why:
 * at the point this definition is constructed, no Kernel exists yet.
 */
export interface FeatureRequestKernelDeps {
  cfg: KernelConfig
  log: EventLog
  wiki: WikiService
  adapters: Pick<AdapterHost, 'loadProjects' | 'sync'>
}

/**
 * `createKernel(cfg, adapterRegistry, workflowDefinitions)` (W1) takes an
 * array of already-built WorkflowDefinitions, constructed by the caller
 * (packages/cli/src/commands/up.ts) *before* createKernel runs -- so there
 * is no live EventLog/WikiService/AdapterHost to inject eagerly at the
 * point `createFeatureRequestWorkflow` is called. `getKernel` is a lazy
 * accessor up.ts satisfies with a forward-declared `let kernel` variable
 * assigned immediately after `createKernel(...)` returns; it is only ever
 * invoked from inside `run()`, well after that assignment has happened.
 */
export interface FeatureRequestDeps {
  registry: Record<string, ProjectAdapter>
  getKernel: () => FeatureRequestKernelDeps
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

function requireFeatureRequestOps(deps: FeatureRequestDeps, project: ProjectConfig) {
  const adapter = deps.registry[project.adapter]
  if (!adapter) throw new Error(`no adapter registered for '${project.adapter}'`)
  if (!adapter.featureRequests) {
    throw new Error(`adapter '${project.adapter}' does not support feature requests`)
  }
  return adapter.featureRequests
}

function adapterContext(kernel: FeatureRequestKernelDeps, project: ProjectConfig, runId: string): AdapterContext {
  return { cfg: kernel.cfg, log: kernel.log, wiki: kernel.wiki, project, runId }
}

function briefSpec(project: ProjectConfig, input: FeatureRequestInput, proposalPath: string): StepRunSpec {
  return {
    skill: 'feature-brief',
    agent: 'ops',
    permissionMode: 'plan',
    allowedTools: ['mcp__agentos__get_context', 'mcp__agentos__read_wiki', 'mcp__agentos__remember'],
    task: { project: project.name, title: input.title, description: input.description, proposalPath },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}

async function runBuildStep(
  ctx: WorkflowContext<FeatureRequestInput>,
  project: ProjectConfig,
  task: Record<string, unknown>,
  stepName: 'build' | 'build-fix',
): Promise<void> {
  // biome-ignore lint/style/noNonNullAssertion: only called after the !project.build?.enabled guard in run() returns early
  const build = project.build!
  const result = await ctx.step.run(stepName, {
    skill: 'feature-build',
    agent: 'ops',
    cwd: project.clone,
    model: build.model,
    permissionMode: build.permission_mode,
    allowedTools: build.allowed_tools,
    addDirs: [project.clone],
    timeoutMs: build.timeout_ms,
    task,
  })
  assertRunSucceeded(result, stepName)
}

function checkSpec(
  project: ProjectConfig,
  skill: 'feature-validate' | 'feature-review',
  task: Record<string, unknown>,
  permissionMode: PermissionMode,
  allowedTools: string[],
): StepRunSpec {
  // biome-ignore lint/style/noNonNullAssertion: only called after the !project.build?.enabled guard in run() returns early
  const build = project.build!
  return {
    skill,
    agent: 'ops',
    cwd: project.clone,
    model: build.model,
    permissionMode,
    allowedTools,
    addDirs: [project.clone],
    timeoutMs: build.timeout_ms,
    task,
  }
}

function assertRunSucceeded(result: RunResult, stepName: string): void {
  if (result.status !== 'success') {
    throw new Error(`${stepName} step failed (status ${result.status}): ${result.error ?? 'no error detail'}`)
  }
}

function parsePassFail(resultText: string | undefined): { pass: boolean; text: string } {
  const text = (resultText ?? '').trim()
  const firstLine = text.split('\n', 1)[0]?.trim().toUpperCase()
  return { pass: firstLine === 'PASS', text }
}

function extractWhatWhy(proposalBody: string): string {
  const match = /^##\s*What you get[\s\S]*?(?=\n##\s*Problem\b)/im.exec(proposalBody)
  return (match ? match[0] : proposalBody).trim()
}

function renderSummary(input: FeatureRequestInput, info: { slug: string; branch: string; prUrl: string }): string {
  return [
    `# ${input.title}`,
    '',
    `- project: ${input.project}`,
    `- slug: ${info.slug}`,
    `- branch: ${info.branch}`,
    `- pull request: ${info.prUrl}`,
    `- auto-approved: ${input.autoApprove}`,
    '',
    '## Description',
    input.description.trim(),
    '',
  ].join('\n')
}

function renderRequestPage(input: FeatureRequestInput, info: { slug: string; branch: string; prUrl: string }): string {
  return [`# ${input.title}`, '', `Shipped via ${info.branch}: ${info.prUrl}`, '', input.description.trim(), ''].join(
    '\n',
  )
}

export function createFeatureRequestWorkflow(
  deps: FeatureRequestDeps,
): WorkflowDefinition<FeatureRequestInput> {
  return {
    kind: 'feature-request',
    async run(ctx: WorkflowContext<FeatureRequestInput>): Promise<void> {
      const kernel = deps.getKernel()
      const projects = await kernel.adapters.loadProjects()
      const project = projects.find((p) => p.name === ctx.input.project)
      if (!project) throw new Error(`unknown project '${ctx.input.project}'`)
      const ops = requireFeatureRequestOps(deps, project)
      const actx = adapterContext(kernel, project, ctx.id)
      const slug = slugify(ctx.input.title)
      const proposalPath = `output/requests/${ctx.id}/proposal.md`

      const briefRun = await ctx.step.run('brief', briefSpec(project, ctx.input, proposalPath))
      assertRunSucceeded(briefRun, 'brief')

      const proposalPage = await kernel.wiki.readPage(proposalPath)
      const { content: proposalBody } = matter(proposalPage)
      if (proposalBody.trim().length === 0) {
        throw new Error(`feature-brief did not write a non-empty proposal to wiki/${proposalPath}`)
      }

      const pushResult = await ctx.step.do('push-proposal', {}, async () => {
        const result = await ops.pushProposal(actx, {
          slug,
          title: ctx.input.title,
          proposalBody,
          status: ctx.input.autoApprove ? 'approved' : 'proposed',
        })
        await kernel.adapters.sync(project.name, ctx.id)
        return result
      })
      const decisionRef = `proposals/${path.basename(pushResult.file)}`

      if (!ctx.input.autoApprove) {
        await ctx.step.waitForEvent('await-approval', 'decision.resolved', {
          match: (e) => e.payload.ref === decisionRef,
          timeoutMs: SEVEN_DAYS_MS,
        })
      }

      if (!project.build?.enabled) {
        // spec §4.4: without a build grant, the request stops here -- the
        // proposal is pushed (and approved, if autoApprove); a human ships
        // it through the existing approve-then-cloud-COO path.
        return
      }

      const branch = `req/${slug}`
      const buildTask = {
        branch, slug, title: ctx.input.title, description: ctx.input.description, proposalPath,
      }
      await runBuildStep(ctx, project, buildTask, 'build')

      let validateRun = await ctx.step.run(
        'validate',
        checkSpec(project, 'feature-validate', { branch, checks: project.build.checks }, 'acceptEdits', ['Bash']),
      )
      assertRunSucceeded(validateRun, 'validate')
      let validateOutcome = parsePassFail(validateRun.resultText)

      let reviewOutcome = { pass: false, text: '' }
      if (validateOutcome.pass) {
        const reviewRun = await ctx.step.run(
          'review',
          checkSpec(project, 'feature-review', { branch, proposalMarkdown: proposalBody }, 'plan', ['Read', 'Glob', 'Grep']),
        )
        assertRunSucceeded(reviewRun, 'review')
        reviewOutcome = parsePassFail(reviewRun.resultText)
      }

      if (!validateOutcome.pass || !reviewOutcome.pass) {
        const failureOutput = !validateOutcome.pass ? validateOutcome.text : reviewOutcome.text
        await runBuildStep(ctx, project, { ...buildTask, priorFailure: failureOutput }, 'build-fix')

        validateRun = await ctx.step.run(
          'validate-fix',
          checkSpec(project, 'feature-validate', { branch, checks: project.build.checks }, 'acceptEdits', ['Bash']),
        )
        assertRunSucceeded(validateRun, 'validate-fix')
        validateOutcome = parsePassFail(validateRun.resultText)
        if (!validateOutcome.pass) {
          throw new Error(`validate failed after one fix attempt:\n${validateOutcome.text}`)
        }

        const reviewFixRun = await ctx.step.run(
          'review-fix',
          checkSpec(project, 'feature-review', { branch, proposalMarkdown: proposalBody }, 'plan', ['Read', 'Glob', 'Grep']),
        )
        assertRunSucceeded(reviewFixRun, 'review-fix')
        reviewOutcome = parsePassFail(reviewFixRun.resultText)
        if (!reviewOutcome.pass) {
          throw new Error(`review failed after one fix attempt:\n${reviewOutcome.text}`)
        }
      }

      const openPr = await ctx.step.do('open-pr', {}, async () => {
        const pr = await ops.openPullRequest(actx, {
          branch,
          slug,
          title: ctx.input.title,
          proposalFile: pushResult.file,
          proposalWhatWhy: extractWhatWhy(proposalBody),
          validationOutput: validateOutcome.text,
          reviewOutput: reviewOutcome.text,
        })
        await ops.markShipped(actx, slug, pushResult.file)
        await ops.writeReport(actx, {
          slug, branch, prUrl: pr.url,
          validationOutput: validateOutcome.text,
          reviewOutput: reviewOutcome.text,
        })
        return pr
      })

      await ctx.step.do('done', {}, async () => {
        await kernel.wiki.writePage({
          path: `output/requests/${ctx.id}/summary.md`,
          content: renderSummary(ctx.input, { slug, branch, prUrl: openPr.url }),
          op: 'note',
        })
        await kernel.wiki.writePage({
          path: `projects/${project.name}/requests/${slug}.md`,
          content: renderRequestPage(ctx.input, { slug, branch, prUrl: openPr.url }),
          op: 'note',
          links: [pushResult.file],
        })
      })
    },
  }
}
```

- [ ] **Step 5: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/workflow/definitions/featureRequest.test.ts`

- [ ] **Step 6: run typecheck**
  `pnpm --filter @agentos/kernel typecheck`
  This depends on W1's `packages/kernel/src/workflow/types.ts` (`StepRunSpec`, `WorkflowContext`, `WorkflowDefinition`) already existing with the exact shapes in the Interfaces line above. If W1 hasn't landed yet, this task's code review still confirms the logic is correct against those given interfaces; typecheck passes once W1's file exists.

- [ ] **Step 7: re-export the definition from the kernel package root**

```ts
// packages/kernel/src/index.ts — add this line (alongside W1's `export * from './workflow/types.js'` / `export * from './workflow/engine.js'`)
export * from './workflow/definitions/featureRequest.js'
```

- [ ] **Step 8: wire the definition into `up.ts` — the composition root, not `kernel.ts`**

```ts
// packages/cli/src/commands/up.ts — full new content
import { adapterRegistry } from '@agentos/adapters'
import { createFeatureRequestWorkflow, createKernel, loadKernelConfig, type Kernel } from '@agentos/kernel'

export interface UpOptions {
  root: string
  port?: string
}

export async function up(opts: UpOptions): Promise<void> {
  const cfg = loadKernelConfig(
    opts.root,
    opts.port ? { port: Number(opts.port) } : undefined,
  )

  // `kernel` is assigned right after createKernel(...) returns, below --
  // getKernel() is only ever *called* from inside a running workflow's
  // run(), which happens well after that assignment (see featureRequest.ts's
  // FeatureRequestDeps doc comment for why this indirection exists at all).
  let kernel: Kernel
  const featureRequestWorkflow = createFeatureRequestWorkflow({
    registry: adapterRegistry,
    getKernel: () => kernel,
  })

  kernel = createKernel(cfg, adapterRegistry, [featureRequestWorkflow])
  await kernel.start()
  console.log(
    `agent-os daemon listening on http://${cfg.host}:${cfg.port} (osRoot=${cfg.osRoot})`,
  )

  const shutdown = async () => {
    console.log('agent-os daemon shutting down...')
    await kernel.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
```

- [ ] **Step 9: run the CLI package's tests and typecheck**
  `pnpm --filter @agentos/cli typecheck && pnpm --filter @agentos/cli test`
  `up.ts` has no dedicated test in this repo today (verified by its absence from `packages/cli/src/commands/*.test.ts` — it's exercised by the CLI's own e2e/acceptance suite instead); this step only needs to not regress that suite.

- [ ] **Step 10: commit**
```
git add packages/kernel/package.json packages/kernel/src/index.ts packages/kernel/src/workflow/definitions/featureRequest.ts packages/kernel/src/workflow/definitions/featureRequest.test.ts packages/cli/src/commands/up.ts
git commit -m "$(cat <<'EOF'
feat(kernel): add the feature-request workflow definition (spec §5)

createFeatureRequestWorkflow(deps) implements the 8-step pipeline: brief,
push-proposal, await-approval (conditional), build, validate, review,
open-pr, done, plus the one-retry build-fix/validate-fix/review-fix path
on a validate or review FAIL. Slug/proposal-path/next-NNN are computed
deterministically by the kernel rather than parsed from agent prose;
validate/review pass-fail is read from a PASS/FAIL first line in
resultText rather than RunResult.status, since a claude -p process exits
successfully even when the checks it ran failed.

Wired into up.ts (not kernel.ts): createKernel's third parameter takes
already-built WorkflowDefinitions, constructed before any Kernel exists,
so FeatureRequestDeps takes a lazy getKernel() accessor rather than eager
EventLog/WikiService/AdapterHost instances.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 6: Template skills — `feature-brief`, `feature-build`

**Files:** Create: `examples/os-template/os/skills/feature-brief/{skill.md,learnings.md,eval.json,context/handoff.md}`, `examples/os-template/os/skills/feature-build/{skill.md,learnings.md,eval.json,context/handoff.md}`. Test: `packages/kernel/src/instance.schema.test.ts` (extend, matching the pattern M2 Task 11 established for `ingest`/`query`/`lint`).
**Interfaces:** Consumes: contract §10 (page template, instance layout). Produces: static prompt content read at runtime by `assemblePrompt` (M1) via `StepRunSpec.skill` — no new code signatures.

- [ ] **Step 1: failing test**

```ts
// packages/kernel/src/instance.schema.test.ts — add this describe block (alongside the existing ingest/query/lint one from M2)
describe('feature-request skills', () => {
  for (const skill of ['feature-brief', 'feature-build', 'feature-validate', 'feature-review']) {
    it(`${skill} has skill.md, learnings.md, eval.json, context/handoff.md`, async () => {
      const skillMd = await read(`skills/${skill}/skill.md`)
      expect(skillMd).toContain('feature-request')
      const evalJson = JSON.parse(await read(`skills/${skill}/eval.json`))
      expect(Array.isArray(evalJson.criteria)).toBe(true)
      expect(evalJson.criteria.length).toBeGreaterThan(0)
      await expect(read(`skills/${skill}/learnings.md`)).resolves.toBeTruthy()
      await expect(read(`skills/${skill}/context/handoff.md`)).resolves.toBeTruthy()
    })
  }

  it('feature-brief documents the required proposal sections', async () => {
    const md = await read('skills/feature-brief/skill.md')
    for (const heading of [
      'What you get', 'Why start this now', 'Problem', 'Proposed solution', 'Effort estimate', 'Validation contract', 'Risks',
    ]) {
      expect(md).toContain(heading)
    }
  })

  it('feature-build documents branch discipline and the never-push rule', async () => {
    const md = await read('skills/feature-build/skill.md')
    expect(md).toContain('req/')
    expect(md.toLowerCase()).toContain('never push')
  })
})
```

- [ ] **Step 2: run it, expect failure**
  `pnpm --filter @agentos/kernel test -- src/instance.schema.test.ts`
  Expected: fails — `skills/feature-brief`/`skills/feature-build` don't exist.

- [ ] **Step 3: write the files**

`examples/os-template/os/skills/feature-brief/skill.md`:
```markdown
# Skill: feature-brief

Trigger: workflow `feature-request`, step `brief`. Agent: `ops`. Runs
`permission_mode: plan` with `allowedTools: mcp__agentos__get_context,
mcp__agentos__read_wiki, mcp__agentos__remember` only — no file tools.

You turn an operator's plain-words feature request into a proposal
written the way a human COO proposal is written, so it can go straight
into `docs/missions/coo/proposals/` unedited.

Your task payload is JSON: `{ project, title, description, proposalPath }`.
`proposalPath` is the exact wiki page path you must write to — do not
invent a different one.

## Steps
1. Call `mcp__agentos__get_context`. Read `businessBrain` and `index` for
   everything already known about `payload.project` — prior proposals,
   the project's tech stack, its conventions.
2. For any `index` entry under `projects/<payload.project>/` that looks
   relevant to `payload.title`/`payload.description`, call
   `mcp__agentos__read_wiki` on it.
3. Write the proposal as Markdown with exactly these `##` sections, in
   this order:
   - **What you get** — one paragraph, plain language, what ships.
   - **Why start this now** — why this increases value/engagement/
     reliability today, not eventually.
   - **Problem** — the concrete problem `payload.description` describes,
     restated precisely.
   - **Proposed solution** — the approach, specific enough that a builder
     with no other context could implement it: what changes, where,
     roughly how.
   - **Effort estimate** — small / medium / large, with a one-line reason.
   - **Validation contract** — the checks that must pass before this
     ships (typecheck, lint, tests, a manual behavior to verify) — this
     section is what the `feature-validate` and `feature-review` steps
     hold the build to, so be concrete and check-able.
   - **Risks** — what could go wrong, what's explicitly out of scope.
4. Call `mcp__agentos__remember` with `page: payload.proposalPath`,
   `content` set to the Markdown from step 3 (starting at the `# <title>`
   H1 — do not repeat frontmatter, `remember` adds that), `op: 'note'`.
   This is your only write. Do not call `remember` again.
5. End your final message with a one-line confirmation that you wrote
   `payload.proposalPath`. The workflow reads the page itself; it does
   not parse your final message for content.

## Hard rules (see os/CLAUDE.md)
No file tools — Markdown only via `remember`. Never write to `raw/`.
Never invent facts about the project absent from `get_context`/`read_wiki`
— say "unknown" and proceed rather than guessing. Never write secrets.
```

`examples/os-template/os/skills/feature-brief/learnings.md`:
```markdown
# Learnings: feature-brief

(Empty at bootstrap — appended by the wrap-up turn after each run.)
```

`examples/os-template/os/skills/feature-brief/eval.json`:
```json
{
  "criteria": [
    { "key": "wrote_proposal", "weight": 0.4, "description": "Called remember exactly once, at payload.proposalPath, with all seven required sections present." },
    { "key": "grounded_in_context", "weight": 0.3, "description": "get_context and relevant read_wiki calls were made before writing; no fabricated facts about the project." },
    { "key": "checkable_validation_contract", "weight": 0.3, "description": "The Validation contract section names concrete, check-able criteria the build must satisfy." }
  ]
}
```

`examples/os-template/os/skills/feature-brief/context/handoff.md`:
```markdown
# Handoff: feature-brief

(Empty at bootstrap — appended by the wrap-up turn after each run.)
```

`examples/os-template/os/skills/feature-build/skill.md`:
```markdown
# Skill: feature-build

Trigger: workflow `feature-request`, step `build` (or `build-fix` on a
retry). Agent: `ops`. Runs **in the project's clone**, not
`agents/ops/workspace/` — `cwd` and every tool grant here come from the
project's `build:` block in `os/projects/<name>.yaml`, not from this
agent's normal defaults (see `os/agents/ops/AGENT.md`).

Your task payload is JSON: `{ branch, slug, title, description,
proposalPath, priorFailure? }`. You have no `mcp__agentos__*` tools here,
so `proposalPath` is informational only (it names the wiki page the
proposal came from) — `title`/`description` plus your own reading of the
repository are your source of truth for what to build. If
`payload.priorFailure` is present, this is a retry: `feature-validate` or
`feature-review` rejected the previous attempt for exactly this reason —
fix that, specifically, before doing anything else.

## Steps
1. Before anything else, check whether `payload.branch` already exists:
   `git rev-parse --verify payload.branch`. If it does, `git checkout
   payload.branch` and `git log --oneline -20` to see what a prior
   (possibly killed-mid-run) attempt already committed — resume from
   there, do not restart from scratch or you will redo or conflict with
   real work. If it does not exist, create it from the current
   `base_branch` HEAD: `git checkout -b payload.branch`.
2. If `payload.priorFailure` is present, read it fully first — it is the
   validate/review output that rejected the previous attempt. Your job
   this run is specifically to fix that.
3. Implement `payload.title`/`payload.description`, following this
   repo's existing conventions (check `CLAUDE.md`/`AGENTS.md` at the repo
   root if present, and match existing code style — do not introduce a
   new pattern where one already exists).
4. Commit as you go, in small conventional-commit-style commits, so a
   `feature-validate` restart after a kill can see incremental progress
   in `git log`. Never commit generated build output, `node_modules/`,
   or anything the repo's `.gitignore` already excludes.
5. **Never push.** Do not run `git push`. Do not open a pull request. Do
   not touch `docs/missions/coo/` — that is written by the adapter, not
   by you, in a later workflow step.
6. End your final message with a short list of files changed and a
   one-line summary of what you implemented.

## Hard rules
Never push to any remote — opening the pull request is a kernel-side
workflow step, not your job. Never edit anything under
`docs/missions/coo/`. Stay on `payload.branch` — never commit to
`base_branch`. Never write secrets into the repo.
```

`examples/os-template/os/skills/feature-build/learnings.md`:
```markdown
# Learnings: feature-build

(Empty at bootstrap — appended by the wrap-up turn after each run, e.g.
"2026-09-09: this repo's CI expects Vitest specs under __tests__/, not
alongside source — check for that convention before placing new tests.")
```

`examples/os-template/os/skills/feature-build/eval.json`:
```json
{
  "criteria": [
    { "key": "branch_discipline", "weight": 0.25, "description": "Worked on payload.branch; resumed via git log instead of restarting when the branch already existed." },
    { "key": "implements_proposal", "weight": 0.35, "description": "The diff matches payload.title/description and, when payload.priorFailure was set, specifically addresses it." },
    { "key": "incremental_commits", "weight": 0.2, "description": "Committed in small, conventional-commit-style increments rather than one giant commit." },
    { "key": "no_forbidden_actions", "weight": 0.2, "description": "Never pushed, never touched docs/missions/coo/, never committed to base_branch." }
  ]
}
```

`examples/os-template/os/skills/feature-build/context/handoff.md`:
```markdown
# Handoff: feature-build

(Empty at bootstrap — appended by the wrap-up turn after each run, so a
retried `build-fix` attempt can see what the previous attempt's wrap-up
turn already learned about this repo.)
```

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/instance.schema.test.ts`
  (The `feature-validate`/`feature-review` cases in the same describe block are addressed by Task 7; this task's run will still show those two failing until Task 7 lands — that's expected and matches M2's own multi-skill task split.)

- [ ] **Step 5: commit**
```
git add examples/os-template/os/skills/feature-brief examples/os-template/os/skills/feature-build packages/kernel/src/instance.schema.test.ts
git commit -m "$(cat <<'EOF'
docs(os-template): add feature-brief and feature-build skills

feature-brief writes the seven-section proposal (What you get / Why
start this now / Problem / Proposed solution / Effort estimate /
Validation contract / Risks) to the exact wiki path it's given.
feature-build runs in the project clone with the project's build grant,
is explicitly told to resume an existing req/<slug> branch after a
restart rather than start over, and is told never to push.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 7: Template skills — `feature-validate`, `feature-review` + `ops/AGENT.md` update

**Files:** Create: `examples/os-template/os/skills/feature-validate/{skill.md,learnings.md,eval.json,context/handoff.md}`, `examples/os-template/os/skills/feature-review/{skill.md,learnings.md,eval.json,context/handoff.md}`. Modify: `examples/os-template/os/agents/ops/AGENT.md`. Test: `packages/kernel/src/instance.schema.test.ts` (Task 6's new describe block, now fully passing).
**Interfaces:** Same as Task 6.

- [ ] **Step 1: run Task 6's test now, confirm it still fails only on feature-validate/feature-review**
  `pnpm --filter @agentos/kernel test -- src/instance.schema.test.ts`

- [ ] **Step 2: write the files**

`examples/os-template/os/skills/feature-validate/skill.md`:
```markdown
# Skill: feature-validate

Trigger: workflow `feature-request`, step `validate` (or `validate-fix`).
Agent: `ops`. Runs in the project's clone on `payload.branch`. Tool
grant: `Bash` only.

Your task payload is JSON: `{ branch, checks }`. `checks` is the exact
list of shell commands from the project's `build.checks` (e.g.
`["pnpm -r --if-present typecheck", "pnpm lint", "pnpm -r --if-present
test"]`).

## Steps
1. `git checkout payload.branch` if not already on it.
2. Run **every** command in `payload.checks`, in order, for real, with
   `Bash` — do not skip a check because an earlier one failed, and do
   not summarize what a check "would probably do" instead of running it.
   Capture each command's exit code and the last ~40 lines of its output.
3. Your final message's **first line** must be exactly `PASS` (every
   check exited 0) or exactly `FAIL` (at least one check exited nonzero).
   This is machine-parsed — nothing else may appear on that line.
4. After the PASS/FAIL line, report one block per check:
   ```
   ### <command>
   exit code: <n>
   <last ~40 lines of output>
   ```
   For a failing check, this tail is what `feature-build`'s next attempt
   (`build-fix`) is told to fix — be complete enough that it doesn't need
   to re-run the check just to see what broke.

## Hard rules
Read-only with respect to the repo's source — you may run test/build
tooling (which may write to `dist/`, `.cache/`, etc.) but never hand-edit
source files; that is `feature-build`'s job. Never push. Never edit
`docs/missions/coo/`.
```

`examples/os-template/os/skills/feature-validate/learnings.md`:
```markdown
# Learnings: feature-validate

(Empty at bootstrap — appended by the wrap-up turn after each run.)
```

`examples/os-template/os/skills/feature-validate/eval.json`:
```json
{
  "criteria": [
    { "key": "ran_every_check", "weight": 0.4, "description": "Every command in payload.checks was actually executed, none skipped or summarized without running." },
    { "key": "correct_pass_fail_line", "weight": 0.3, "description": "Final message's first line is exactly PASS or FAIL and matches whether every check exited 0." },
    { "key": "useful_failure_tails", "weight": 0.3, "description": "Each failing check's output tail is complete enough for feature-build to fix it without re-running the check." }
  ]
}
```

`examples/os-template/os/skills/feature-validate/context/handoff.md`:
```markdown
# Handoff: feature-validate

(Empty at bootstrap — appended by the wrap-up turn after each run.)
```

`examples/os-template/os/skills/feature-review/skill.md`:
```markdown
# Skill: feature-review

Trigger: workflow `feature-request`, step `review` (or `review-fix`).
Agent: `ops`. Runs in the project's clone on `payload.branch`, read-only
(`permission_mode: plan`, tools `Read, Glob, Grep` — no `Bash`, no
`mcp__agentos__*`).

Your task payload is JSON: `{ branch, proposalMarkdown }`.
`proposalMarkdown` is the full proposal `feature-brief` wrote, including
its Proposed solution and Validation contract sections.

## Steps
1. `feature-validate` has already confirmed the branch passes its
   checks — you are reviewing fit and quality, not re-running them.
   Read `git log --oneline` and the diff against `base_branch` (via
   `Read`/`Glob`/`Grep` over the working tree) to see everything
   `feature-build` changed.
2. Read the changed files in full, not just the diff, when a change's
   context matters (a new function's surrounding file, a modified
   component's parent).
3. Judge against `payload.proposalMarkdown`'s **Proposed solution** and
   **Validation contract** sections specifically — did the build do what
   was proposed, not some adjacent thing; does it actually satisfy the
   contract, not just pass the automated checks.
4. Also judge general fit: does it match the repo's existing
   conventions and style; is it the size the Effort estimate implied
   (a "small, 2 hours" proposal that touched 40 files is a smell); is
   anything obviously unfinished (a TODO, a stub, dead code).
5. Your final message's **first line** must be exactly `PASS` or exactly
   `FAIL`. If `FAIL`, follow it with a specific, actionable list of what
   to fix — this is fed verbatim to the next `feature-build` attempt as
   `payload.priorFailure`, so vague feedback like "needs polish" is not
   useful; name the file, the problem, and what "fixed" looks like.

## Hard rules
Read-only — no edits, no shell commands, no `mcp__agentos__*`. Never
approve (`PASS`) code you have not actually read.
```

`examples/os-template/os/skills/feature-review/learnings.md`:
```markdown
# Learnings: feature-review

(Empty at bootstrap — appended by the wrap-up turn after each run.)
```

`examples/os-template/os/skills/feature-review/eval.json`:
```json
{
  "criteria": [
    { "key": "read_the_diff", "weight": 0.25, "description": "Actually read the changed files, not just their names." },
    { "key": "judged_against_proposal", "weight": 0.35, "description": "PASS/FAIL reasoning is grounded in payload.proposalMarkdown's Proposed solution and Validation contract, not generic code review." },
    { "key": "actionable_fail_reasons", "weight": 0.25, "description": "A FAIL includes specific, file-level, actionable feedback usable as the next build-fix's input." },
    { "key": "correct_pass_fail_line", "weight": 0.15, "description": "Final message's first line is exactly PASS or FAIL." }
  ]
}
```

`examples/os-template/os/skills/feature-review/context/handoff.md`:
```markdown
# Handoff: feature-review

(Empty at bootstrap — appended by the wrap-up turn after each run.)
```

`examples/os-template/os/agents/ops/AGENT.md` — append this section at the end of the existing file (full existing content — Persona, Permissions, Hard rules — is unchanged):
```markdown

## Feature-request workflow skills

`ops` also runs the four `feature-request` workflow steps: `feature-brief`,
`feature-build`, `feature-validate`, `feature-review`.

- `feature-brief` uses the normal `ops` grant shape (no filesystem tools,
  `mcp__agentos__*` only) but `permission_mode: plan` and a narrower tool
  list than `heartbeat`/`daily-digest`: `get_context, read_wiki, remember`.
- `feature-build`/`feature-validate`/`feature-review` are the exception to
  every rule above: their `cwd`, `permission_mode`, `model`, and
  `allowedTools` come entirely from the requesting project's `build:`
  block (`os/projects/<name>.yaml`, spec §4.4) — passed in by the
  `feature-request` workflow's `step.run` calls, not by this agent's own
  defaults. `feature-build`/`feature-validate` may therefore run `Bash`
  and edit files, but **only inside that project's clone**, never inside
  `agents/ops/workspace/` or anywhere else in this instance — the kernel
  refuses any other `cwd` for a non-workspace run unless the project
  explicitly opted in (see `assertCloneCwdAllowed`). `feature-review`
  stays read-only regardless: `Read, Glob, Grep`, no `Bash`.
- None of these four ever call `mcp__agentos__remember` except
  `feature-brief` (and only once, at the path it's given) — the workflow
  itself, not the agent, does every `wiki/output/requests/`,
  `wiki/projects/<project>/requests/`, and `docs/missions/coo/` write
  that happens outside `feature-brief`'s single call.
```

- [ ] **Step 3: run tests, expect PASS**
  `pnpm --filter @agentos/kernel test -- src/instance.schema.test.ts`

- [ ] **Step 4: commit**
```
git add examples/os-template/os/skills/feature-validate examples/os-template/os/skills/feature-review examples/os-template/os/agents/ops/AGENT.md
git commit -m "$(cat <<'EOF'
docs(os-template): add feature-validate/feature-review, document ops's build grant exception

feature-validate runs every build.checks command for real and reports a
machine-parsed PASS/FAIL first line with failure tails. feature-review
is read-only and judges the diff against the proposal's Proposed
solution and Validation contract, also with a PASS/FAIL first line and,
on FAIL, actionable file-level feedback fed to the next build-fix
attempt. ops/AGENT.md documents that feature-build/feature-validate's
tool/cwd grants come from the project's build: config, not from ops's
usual restrictions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 8: CLI `agentos request`

Per team-lead ruling, `ApiClient.createWorkflow` and `registerWorkflowsCommand` are W1's (its Task 11, `packages/cli/src/client.ts`/`packages/cli/src/commands/workflows.ts`) — this task reuses `createWorkflow` unchanged, it does not redefine it.

**Files:** Modify: `packages/cli/src/bin.ts`. Create: `packages/cli/src/commands/request.ts`, `packages/cli/src/commands/request.test.ts`.
**Interfaces:** Consumes: `ApiClient.createWorkflow` (W1 Task 11 — `createWorkflow(body: {kind, project?, title?, input}): Promise<{workflowId}>`), `FeatureRequestInput` (Task 1, `@agentos/shared`). Produces: `requestFeature(client, opts, readFile?)`.

- [ ] **Step 1: failing test**

```ts
// packages/cli/src/commands/request.test.ts
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client.js'
import { requestFeature } from './request.js'

describe('requestFeature', () => {
  it('creates a feature-request workflow from --description', async () => {
    const client = {
      createWorkflow: vi.fn().mockResolvedValue({ workflowId: 'wf-1' }),
    } as unknown as ApiClient
    const id = await requestFeature(client, {
      project: 'techpulse',
      title: 'Add dark mode',
      description: 'Users want a toggle.',
      autoApprove: true,
    })
    expect(id).toBe('wf-1')
    expect(client.createWorkflow).toHaveBeenCalledWith({
      kind: 'feature-request',
      project: 'techpulse',
      title: 'Add dark mode',
      input: {
        project: 'techpulse',
        title: 'Add dark mode',
        description: 'Users want a toggle.',
        autoApprove: true,
      },
    })
  })

  it('reads the description from --file when given', async () => {
    const client = { createWorkflow: vi.fn().mockResolvedValue({ workflowId: 'wf-2' }) } as unknown as ApiClient
    const readFile = vi.fn().mockResolvedValue('from the file\n')
    const id = await requestFeature(
      client,
      { project: 'p', title: 't', file: 'brief.md', autoApprove: false },
      readFile,
    )
    expect(id).toBe('wf-2')
    expect(readFile).toHaveBeenCalledWith('brief.md')
    expect(client.createWorkflow).toHaveBeenCalledWith({
      kind: 'feature-request',
      project: 'p',
      title: 't',
      input: { project: 'p', title: 't', description: 'from the file\n', autoApprove: false },
    })
  })

  it('throws when neither --description nor --file is given', async () => {
    const client = { createWorkflow: vi.fn() } as unknown as ApiClient
    await expect(
      requestFeature(client, { project: 'p', title: 't', autoApprove: true }),
    ).rejects.toThrow(/--description|--file/)
    expect(client.createWorkflow).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: run it, expect failure**
  `pnpm --filter @agentos/cli test -- src/commands/request.test.ts`
  Expected: fails — `request.ts` does not exist. (`ApiClient.createWorkflow` should already exist from W1's Task 11 by the time this task starts, per spec §10's milestone ordering "W3 needs W1"; if it somehow doesn't yet, add it to `packages/cli/src/client.ts` exactly as W1's plan Task 11 specifies — `createWorkflow(body: {kind: string; project?: string; title?: string; input: Record<string, unknown>}): Promise<{workflowId: string}>` — rather than inventing a different signature here.)

- [ ] **Step 3: implementation**

```ts
// packages/cli/src/commands/request.ts
import type { FeatureRequestInput } from '@agentos/shared'
import type { ApiClient } from '../client.js'

export interface RequestOptions {
  project: string
  title: string
  description?: string
  file?: string
  autoApprove: boolean
}

async function defaultReadFile(path: string): Promise<string> {
  const fs = await import('node:fs/promises')
  return fs.readFile(path, 'utf8')
}

export async function requestFeature(
  client: ApiClient,
  opts: RequestOptions,
  readFile: (path: string) => Promise<string> = defaultReadFile,
): Promise<string> {
  if (!opts.description && !opts.file) {
    throw new Error('one of --description or --file is required')
  }
  const description = opts.file
    ? await readFile(opts.file)
    : // biome-ignore lint/style/noNonNullAssertion: checked above
      opts.description!

  const input: FeatureRequestInput = {
    project: opts.project,
    title: opts.title,
    description,
    autoApprove: opts.autoApprove,
  }
  const { workflowId } = await client.createWorkflow({
    kind: 'feature-request',
    project: opts.project,
    title: opts.title,
    input,
  })
  console.log(`started feature request ${workflowId}`)
  return workflowId
}
```

```ts
// packages/cli/src/bin.ts — add this import
import { requestFeature } from './commands/request.js'

// packages/cli/src/bin.ts — add alongside the existing `program.command('run <skill>')` block
program
  .command('request <project> <title>')
  .description('open a feature request: proposal, build, validate, review, PR')
  .option('--description <text>', 'the feature description')
  .option('--file <path>', 'read the description from a file')
  .option('--no-auto-approve', 'require manual approval of the proposal before building')
  .action(async (project: string, title: string, opts) => {
    await requestFeature(client(), {
      project,
      title,
      description: opts.description,
      file: opts.file,
      autoApprove: opts.autoApprove,
    })
  })
```

- [ ] **Step 4: run tests, expect PASS**
  `pnpm --filter @agentos/cli test -- src/commands/request.test.ts`
  Also `pnpm --filter @agentos/cli typecheck`.

- [ ] **Step 5: commit**
```
git add packages/cli/src/bin.ts packages/cli/src/commands/request.ts packages/cli/src/commands/request.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add `agentos request <project> <title>` (spec §7)

POSTs { kind: 'feature-request', project, title, input } to
POST /api/workflows, reusing W1's ApiClient.createWorkflow.
--no-auto-approve (commander's --no- convention) flips autoApprove to
false; --file reads the description from disk instead of --description.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Self-Review

- **Spec §5 coverage**: §5.1 input type (`FeatureRequestInput`, Task 1, appended to W1's shared `workflow.ts`) — done. §5.2 all 8 named steps in order with exact names (`brief, push-proposal, await-approval, build, validate, review, open-pr, done`, Task 5) — done, plus the conditional one-retry `build-fix`/`validate-fix`/`review-fix` path (Task 5, tested in `featureRequest.test.ts`'s 4th/5th `it`s). `autoApprove` gates `await-approval` via `waitForEvent('decision.resolved', ...)` with a 7-day timeout (`SEVEN_DAYS_MS`) — done, and the previously-missing `decision.resolved` event emission is fixed (Task 2) so the wait can ever actually resolve. `open-pr` body composition (What/Why + validation + review) — done (`buildPrBody`, Task 4). `status: shipped` flip — done (`markShipped`, Task 4). `reports/<slug>.md` — done (`writeReport`, Task 4). `done` writing `output/requests/<id>/summary.md` and a `projects/<project>/requests/<slug>.md` wiki page — done (Task 5's final `step.do`). §5.3 containment: build/validate/review get exactly `project.build.allowed_tools` and `cwd: project.clone` (Task 5's `checkSpec`/`runBuildStep`), enforced by `assertCloneCwdAllowed` (Task 2) at the W1 wiring seam; the agent never pushes (skill.md hard rules, Task 6/7); `remember`'s existing raw/-refusal and secret-refusal are unchanged and reused; the PR body is scanned with `findSecrets` before `gh pr create` (Task 4, tested). §8 error-handling rows this milestone owns: restart mid-build tells the skill to read the branch's existing commits first (`feature-build/skill.md` step 1, Task 6). §9 testing: engine-level replay/retry/waitForEvent/sleep/pause/terminate tests are explicitly W1's; this plan's own tests cover the definition test with a stub `step.run` and a temp bare repo (Task 5) and the adapter helpers against `createTempTechpulseRepo`/a from-scratch bare repo (Tasks 3–4), matching what §9 assigns to W3.
- **Placeholder scan**: no `TBD`/`TODO`/"similar to Task N" in any code block; every step has complete, runnable code or complete file content. Task 5 Step 6's typecheck depends on W1's `workflow/types.ts` existing, which is an explicitly-flagged milestone dependency ("W3 needs W1", spec §10), not an unresolved design gap in this plan.
- **Type consistency**: `StepRunSpec`, `RunResult`, `WorkflowContext`, `WorkflowDefinition` are imported from W1's `packages/kernel/src/workflow/types.ts` / `packages/kernel/src/process/processManager.ts` and never redefined in this plan (team-lead ruling) — `StepRunSpec.task` (not `payload`) is used consistently across Tasks 5's spec builders and test. `FeatureRequestPushProposalInput/Result`, `FeatureRequestOpenPrInput/Result`, `FeatureRequestWriteReportInput/Result` are defined once (kernel `adapters/types.ts`, Task 3) and imported (not redefined) everywhere else (`requests.ts`, Task 3/4). `ProjectBuildConfig`/`ProjectConfig.build` (W2) and `CreateWorkflowRequest`/`CreateWorkflowResponse`/`ApiClient.createWorkflow` (W1) are consumed, never redefined, per team-lead ruling — Tasks 1 and 8 were rewritten to drop the duplicate definitions this plan originally carried. `FeatureRequestInput` matches spec §5.1 exactly. The `AdapterContext`/`ProjectAdapter`/`SyncResult` shapes are unchanged from the existing contract; only `ProjectAdapter.featureRequests?` is new.
- **Package-cycle / construction-order check**: `packages/kernel` never imports `@agentos/adapters` from its `src/` (only as a test-only `devDependency`, Task 5 Step 1); `packages/adapters` continues to depend on `@agentos/kernel` for types only, unchanged from the existing `adapter.ts`. `FeatureRequestAdapterOps` living in kernel's own `adapters/types.ts` (Task 3) is what makes this possible. Separately, `FeatureRequestDeps.getKernel()` (Task 5) resolves the analogous ordering problem between `createFeatureRequestWorkflow` (called before any `Kernel` exists, to build the array `createKernel`'s third parameter needs) and the live `EventLog`/`WikiService`/`AdapterHost` `run()` needs once a workflow instance actually executes — verified by Task 5's test constructing a `FeatureRequestKernelDeps` object directly (no real `Kernel`) and by Task 5 Step 8's `up.ts` wiring using a forward-declared `let kernel` closure variable, the standard resolution for a same-module constructor-order cycle.
