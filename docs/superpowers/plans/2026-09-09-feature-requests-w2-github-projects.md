# agent-os W2 — GitHub Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator add a GitHub repository as an agent-os project from the dashboard (or CLI) without editing YAML or storing a token: browse their repos via the local `gh` CLI, register the project, hot-start its sync routine with no daemon restart, run the first sync, and surface the "no COO layout yet" state honestly. Also let them remove a project (keeping its clone and `raw/` mirror) and see every registered project's adapter, base branch, last sync, pending decisions and build status in a new Projects panel.

**Architecture:** A new `gh.ts` kernel module shells out to the operator's `gh` CLI via `execa` argument arrays only (never a token, never a shell string), gated by an `AGENTOS_GH_BIN` override so tests run against a fake script under `tools/fake-gh/`. A new `ProjectService` (kernel) is the single place that writes `os/projects/<name>.yaml`, appends/removes the project's sync routine in `os/routines.yaml`, hot-registers/unregisters that routine on the live `Scheduler` (`Scheduler.registerRoutine`/`unregisterRoutine`, new — no daemon restart), and drives the first sync through the existing `AdapterHost`. Two new route modules (`api/github.ts`, `api/projects.ts`) follow the `api/internal.ts` `register*Routes(app, deps)` convention already used in `server.ts`. The dashboard gets one new panel (`ProjectsPanel`) and one new dialog (`AddProjectDialog`, built on the existing `ConfirmSheet` visual language), wired through the same `ApiClient` + mock-fetch-fixture pattern every other panel uses.

**Tech Stack:** TypeScript ^5.6 strict/ESM, Vitest, `execa@^9` (already a kernel dependency — no new runtime dependency added), `yaml@^2`, `fastify@^5`, `commander@^12`, `react@^18`.

**Spec:** `docs/superpowers/specs/2026-09-09-feature-requests-design.md` §4 (Projects from GitHub), §6 (Projects panel), §7 (`projects` CLI), §8/§9/§10 (error handling, testing, milestones as they touch projects).
**Contract:** `docs/superpowers/plans/2026-09-08-agent-os-00-contract.md`
**Style/granularity reference:** `docs/superpowers/plans/2026-09-08-agent-os-m4-techpulse-adapter.md`, `...-m5-dashboard.md`

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome — single quotes, no semicolons, LF line endings.
- Tests live next to the source file they cover (`foo.ts` + `foo.test.ts`), matching every existing package.
- **No new runtime dependencies.** `execa` is already a `@agentos/kernel` dependency (used by `ProcessManager`); the `gh` service reuses it. No new package.json entries anywhere in this plan.
- Never store a GitHub token. `gh` is invoked only through `execa(bin, [...args])` with an argument array — never a shell string, never string interpolation into a command line.
- Repo names are validated against `^[\w.-]+\/[\w.-]+$` before any use (in a request path, an argv element, or a filesystem path segment).
- No absolute local paths, hostnames, or secrets in any committed file. `os/projects/<name>.yaml`'s `clone` field is always the literal, unexpanded `${AGENTOS_CLONES}/<name>` — `AdapterHost.loadProjects()` already expands it at load time (`packages/kernel/src/adapters/adapterHost.ts:28`); this plan's writers must not expand it themselves.
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`). Every commit message ends with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

## Contract additions (binding for this plan and for W3/W4)

```ts
// packages/kernel/src/adapters/types.ts — SyncResult gains an optional field.
// Only techpulse-coo sets it (Task 1); adapters that don't set it are treated
// as "not applicable" (no empty-layout messaging) by every consumer.
export interface SyncResult {
  added: string[]
  changed: string[]
  events: EventType[]
  hasCooLayout?: boolean
}

// packages/shared/src/types/project.ts
export interface ProjectBuildConfig {
  enabled: boolean
  model: string
  permission_mode: PermissionMode
  allowed_tools: string[]
  checks: string[]
  timeout_ms: number
}
export interface ProjectConfig {
  name: string
  adapter: string
  repo: string
  clone: string
  base_branch: string
  options: Record<string, unknown>
  build?: ProjectBuildConfig
}

// packages/shared/src/types/github.ts (new)
export interface GithubRepo {
  nameWithOwner: string
  description: string | null
  defaultBranch: string
  isPrivate: boolean
  updatedAt: string
}

// packages/shared/src/types/api.ts — additions
export interface GithubUnavailableResponse { error: string; hint: string }
export interface ProjectListItem {
  config: ProjectConfig
  routines: string[]        // e.g. ['techpulse-sync'] when the sync routine is registered
  lastSync?: Run
  hasCooLayout: boolean      // true ("not applicable / present") when the adapter doesn't track this
}
export interface AddProjectRequest {
  repo: string
  name?: string
  adapter?: string           // default 'techpulse-coo'
  base_branch?: string
  build?: boolean
}
export interface AddProjectResponse {
  project: ProjectConfig
  sync: SyncResult
  syncError?: string          // set instead of throwing when the first sync/clone fails (spec §8);
                               // project.yaml and its routine are still written and returned
}
```

**Reconciliation note:** the assigning message asked for the exact signature
`addProject(input: AddProjectInput): Promise<{ project: ProjectConfig; sync: SyncResult }>`.
`AddProjectResult` below is `{ project, sync, syncError? }` — a structural
superset of that shape (the extra field is optional) — because spec §8 requires
a failed first sync to still return 201 with the written project, not throw.
Task 5 implements this exactly; `syncError` is the only deviation from the
literal signature, and it is additive, not breaking.

## File structure
```
packages/kernel/
  src/adapters/types.ts                       MODIFY: SyncResult.hasCooLayout
  src/scheduler/scheduler.ts                   MODIFY: registerRoutine, unregisterRoutine
  src/scheduler/scheduler.test.ts              MODIFY: new describe block
  src/github/gh.ts                             NEW
  src/github/gh.test.ts                        NEW
  src/projects/projectService.ts               NEW
  src/projects/projectService.test.ts          NEW
  src/api/github.ts                            NEW
  src/api/github.test.ts                       NEW
  src/api/projects.ts                          NEW (project CRUD routes; distinct from the
                                                 existing single POST /api/projects/:name/sync
                                                 route, which stays in server.ts)
  src/api/projects.test.ts                     NEW
  src/api/server.ts                            MODIFY: register github.ts + projects.ts routes
  src/kernel.ts                                MODIFY: construct+expose kernel.projects
packages/adapters/
  src/techpulseCoo/adapter.ts                  MODIFY: sync() sets result.hasCooLayout
  src/techpulseCoo/adapter.test.ts             MODIFY: new test case
packages/shared/
  src/types/project.ts                         MODIFY: ProjectBuildConfig, ProjectConfig.build
  src/types/github.ts                          NEW: GithubRepo
  src/types/api.ts                             MODIFY: additions above
  src/schemas.ts                               MODIFY: ProjectBuildConfigSchema, ProjectConfigSchema
  src/index.ts                                 MODIFY: re-export types/github.js
packages/dashboard/
  src/api/client.ts                            MODIFY: listGithubRepos, listProjects, addProject, removeProject
  src/api/client.test.ts                       MODIFY: new tests
  src/components/Icon.tsx                      MODIFY: 'projects' icon
  src/components/AddProjectDialog.tsx           NEW
  src/components/AddProjectDialog.test.tsx      NEW
  src/panels/ProjectsPanel.tsx                  NEW
  src/panels/ProjectsPanel.test.tsx             NEW
  src/App.tsx                                  MODIFY: nav insertion
  src/App.test.tsx                             MODIFY: new panel switch assertion
  tests/mockServer.ts                          MODIFY: github/projects fixtures
  e2e/projects.spec.ts                          NEW
packages/cli/
  src/client.ts                                MODIFY: listProjects, addProject
  src/commands/projects.ts                      NEW
  src/commands/projects.test.ts                 NEW
  src/bin.ts                                    MODIFY: registerProjectsCommand
tools/fake-gh/
  bin.js                                        NEW
  fixtures/repos.json                           NEW
docs/SECURITY.md                                MODIFY: new "The gh CLI" paragraph
```

---

## Task 1: Contract types + `SyncResult.hasCooLayout` on the techpulse-coo adapter

**Files:** `packages/shared/src/types/project.ts`, `packages/shared/src/types/github.ts`, `packages/shared/src/types/api.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/index.ts`, `packages/kernel/src/adapters/types.ts`, `packages/adapters/src/techpulseCoo/adapter.ts`, `packages/adapters/src/techpulseCoo/adapter.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProjectBuildConfig`, `ProjectConfig.build?`, `GithubRepo`, `ProjectListItem`, `AddProjectRequest`, `AddProjectResponse`, `GithubUnavailableResponse` (all above), `ProjectBuildConfigSchema`, updated `ProjectConfigSchema`, `SyncResult.hasCooLayout?: boolean`.

- [ ] **Step 1: failing test — schema round-trips a project with a build block, techpulse-coo reports hasCooLayout: false on a repo with no proposals dir**
  ```ts
  // packages/shared/src/schemas.test.ts (new file)
  import { describe, it, expect } from 'vitest'
  import { ProjectConfigSchema } from './schemas.js'

  describe('ProjectConfigSchema', () => {
    it('accepts a project with a build block', () => {
      const parsed = ProjectConfigSchema.parse({
        name: 'demo', adapter: 'techpulse-coo', repo: 'o/r',
        clone: '${AGENTOS_CLONES}/demo', base_branch: 'main', options: {},
        build: {
          enabled: true, model: 'sonnet', permission_mode: 'acceptEdits',
          allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
          checks: ['pnpm -r --if-present typecheck'], timeout_ms: 2_400_000,
        },
      })
      expect(parsed.build?.checks).toEqual(['pnpm -r --if-present typecheck'])
    })

    it('accepts a project with no build block (build stays undefined)', () => {
      const parsed = ProjectConfigSchema.parse({
        name: 'demo', adapter: 'techpulse-coo', repo: 'o/r',
        clone: '${AGENTOS_CLONES}/demo', base_branch: 'main', options: {},
      })
      expect(parsed.build).toBeUndefined()
    })
  })
  ```
  ```ts
  // append to packages/adapters/src/techpulseCoo/adapter.test.ts
  describe('techpulseCooAdapter.sync — hasCooLayout', () => {
    it('reports hasCooLayout: false when the proposals dir is absent', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)
      ctx.project.options = { ...ctx.project.options, proposals_path: 'docs/missions/coo/proposals-does-not-exist', reports_path: 'docs/missions/coo/reports', state_path: 'docs/missions/coo/state.md' }

      const result = await techpulseCooAdapter.sync(ctx)

      expect(result.hasCooLayout).toBe(false)
    })

    it('reports hasCooLayout: true when the proposals dir exists', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)

      const result = await techpulseCooAdapter.sync(ctx)

      expect(result.hasCooLayout).toBe(true)
    })
  })
  ```
  Run: `pnpm --filter @agentos/shared test && pnpm --filter @agentos/adapters test` — expected failure: `build` is stripped by `ProjectConfigSchema.parse` (unknown key) or the shape mismatches; `result.hasCooLayout` is `undefined` in both adapter cases (property doesn't exist yet).

- [ ] **Step 2: implement**
  ```ts
  // packages/shared/src/types/project.ts — replace file
  import type { PermissionMode } from './routine.js'

  export interface ProjectBuildConfig {
    enabled: boolean
    model: string
    permission_mode: PermissionMode
    allowed_tools: string[]
    checks: string[]
    timeout_ms: number
  }

  export interface ProjectConfig {
    name: string
    adapter: string
    repo: string
    clone: string
    base_branch: string
    options: Record<string, unknown>
    build?: ProjectBuildConfig
  }
  ```
  ```ts
  // packages/shared/src/types/github.ts — new file
  export interface GithubRepo {
    nameWithOwner: string
    description: string | null
    defaultBranch: string
    isPrivate: boolean
    updatedAt: string
  }
  ```
  ```ts
  // packages/shared/src/types/api.ts — append
  import type { ProjectConfig } from './project.js'
  import type { Run } from './run.js'
  import type { SyncResult } from '@agentos/kernel/adapters/types'
  // NOTE: importing from @agentos/kernel here would create a cross-package
  // dependency the wrong direction (kernel already depends on shared). Instead
  // declare a local structural copy so shared has no dependency on kernel:
  export interface SyncResultShape {
    added: string[]
    changed: string[]
    events: string[]
    hasCooLayout?: boolean
  }

  export interface GithubUnavailableResponse {
    error: string
    hint: string
  }
  export interface ProjectListItem {
    config: ProjectConfig
    routines: string[]
    lastSync?: Run
    hasCooLayout: boolean
  }
  export interface AddProjectRequest {
    repo: string
    name?: string
    adapter?: string
    base_branch?: string
    build?: boolean
  }
  export interface AddProjectResponse {
    project: ProjectConfig
    sync: SyncResultShape
    syncError?: string
  }
  ```
  (The `SyncResult` type itself stays owned by `@agentos/kernel/adapters/types` per the 00-contract; `SyncResultShape` in shared is the wire-shape twin, exactly like `RoutineListItem` already duplicates across `dashboard/src/api/client.ts` and `cli/src/client.ts` today — this plan follows that existing precedent rather than introducing a new one.)
  ```ts
  // packages/shared/src/schemas.ts — insert before ProjectConfigSchema
  export const ProjectBuildConfigSchema = z.object({
    enabled: z.boolean(),
    model: z.string(),
    permission_mode: PermissionModeSchema,
    allowed_tools: z.array(z.string()),
    checks: z.array(z.string()),
    timeout_ms: z.number().int(),
  })

  export const ProjectConfigSchema = z.object({
    name: z.string(),
    adapter: z.string(),
    repo: z.string(),
    clone: z.string(),
    base_branch: z.string(),
    options: z.record(z.unknown()),
    build: ProjectBuildConfigSchema.optional(),
  })
  ```
  ```ts
  // packages/shared/src/index.ts — add re-export line alongside the others
  export * from './types/github.js'
  ```
  ```ts
  // packages/kernel/src/adapters/types.ts — SyncResult
  export interface SyncResult {
    added: string[]
    changed: string[]
    events: EventType[]
    hasCooLayout?: boolean
  }
  ```
  ```ts
  // packages/adapters/src/techpulseCoo/adapter.ts — inside sync(), after `await ensureClone(ctx)`
  // and before building `result`, add the check, then set it on result before returning:
  const proposalsDir = path.join(ctx.project.clone, opts.proposals_path)
  const hasCooLayout = await pathExists(proposalsDir)
  const result: SyncResult = { added: [], changed: [], events: [], hasCooLayout }
  // (delete the old `const proposalsDir = ...` redeclaration further down the
  // function — reuse the one computed above)
  ```
  Run: `pnpm --filter @agentos/shared test && pnpm --filter @agentos/adapters test` — expected: PASS (all new + existing tests).

- [ ] **Step 3: commit**
  ```
  git add packages/shared packages/kernel/src/adapters/types.ts packages/adapters/src/techpulseCoo/adapter.ts packages/adapters/src/techpulseCoo/adapter.test.ts
  git commit -m "$(cat <<'EOF'
  feat(shared,adapters): add project build config, GithubRepo type, and SyncResult.hasCooLayout

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: `Scheduler.registerRoutine` / `unregisterRoutine` — hot routine (un)registration

**Files:** `packages/kernel/src/scheduler/scheduler.ts`, `packages/kernel/src/scheduler/scheduler.test.ts`

**Interfaces:**
- Consumes: `RoutineConfig` (contract §3).
- Produces:
  ```ts
  registerRoutine(config: RoutineConfig): void   // idempotent upsert by name; if the Scheduler is
                                                   // already started, the routine's every/cron timer
                                                   // begins immediately — no daemon restart required
  unregisterRoutine(name: string): void           // stops any timer and removes it; no-op if unknown
  ```

- [ ] **Step 1: failing test**
  ```ts
  // append to packages/kernel/src/scheduler/scheduler.test.ts
  describe('Scheduler.registerRoutine / unregisterRoutine', () => {
    it('starts firing an every: routine registered after start(), with no reload', async () => {
      const { scheduler, exec } = makeScheduler() // existing test helper in this file
      scheduler.load({ defaults: DEFAULTS, routines: [] })
      scheduler.start()

      scheduler.registerRoutine({ name: 'hot-sync', every: '10ms', adapter: 'demo' })

      await vi.waitFor(() => expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'hot-sync' }),
        undefined,
      ))
      scheduler.stop()
    })

    it('re-registering the same name replaces the previous timer instead of doubling it', () => {
      const { scheduler } = makeScheduler()
      scheduler.load({ defaults: DEFAULTS, routines: [] })
      scheduler.start()
      scheduler.registerRoutine({ name: 'hot-sync', every: '1h', adapter: 'demo' })
      scheduler.registerRoutine({ name: 'hot-sync', every: '2h', adapter: 'demo' })

      const listed = scheduler.list().filter((l) => l.routine.name === 'hot-sync')
      expect(listed).toHaveLength(1)
      expect(listed[0].routine.every).toBe('2h')
      scheduler.stop()
    })

    it('unregisterRoutine stops the timer and removes it from list()', () => {
      const { scheduler } = makeScheduler()
      scheduler.load({ defaults: DEFAULTS, routines: [] })
      scheduler.start()
      scheduler.registerRoutine({ name: 'hot-sync', every: '1h', adapter: 'demo' })

      scheduler.unregisterRoutine('hot-sync')

      expect(scheduler.list().some((l) => l.routine.name === 'hot-sync')).toBe(false)
      scheduler.stop()
    })

    it('unregisterRoutine on an unknown name is a no-op', () => {
      const { scheduler } = makeScheduler()
      scheduler.load({ defaults: DEFAULTS, routines: [] })
      expect(() => scheduler.unregisterRoutine('nope')).not.toThrow()
    })

    it('registering before start() just queues it for scheduleRoutine at start()', () => {
      const { scheduler, exec } = makeScheduler()
      scheduler.load({ defaults: DEFAULTS, routines: [] })
      scheduler.registerRoutine({ name: 'pre-start', every: '10ms', adapter: 'demo' })
      scheduler.start()

      return vi.waitFor(() => expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'pre-start' }),
        undefined,
      )).finally(() => scheduler.stop())
    })
  })
  ```
  (If this test file has no existing `makeScheduler()`/`DEFAULTS` helpers matching this shape, add a minimal local one at the top of the file following whatever pattern the file's other `describe` blocks already use — check the file before writing this step for real; the shape above is illustrative of intent, not a literal existing export.)
  Run: `pnpm --filter @agentos/kernel test -- scheduler` — expected failure: `scheduler.registerRoutine is not a function`.

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/scheduler/scheduler.ts — add two public methods, near setEnabled
  registerRoutine(config: RoutineConfig): void {
    const existing = this.routines.get(config.name)
    if (existing) {
      existing.cronJob?.stop()
      if (existing.intervalHandle) clearInterval(existing.intervalHandle)
    }
    const lr: LoadedRoutine = { config, enabled: config.enabled !== false }
    this.routines.set(config.name, lr)
    if (this.started) this.scheduleRoutine(lr)
  }

  unregisterRoutine(name: string): void {
    const lr = this.routines.get(name)
    if (!lr) return
    lr.cronJob?.stop()
    if (lr.intervalHandle) clearInterval(lr.intervalHandle)
    this.routines.delete(name)
  }
  ```
  Run: `pnpm --filter @agentos/kernel test -- scheduler` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/scheduler/scheduler.ts packages/kernel/src/scheduler/scheduler.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add Scheduler.registerRoutine/unregisterRoutine for hot project sync routines

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: `gh.ts` service + `tools/fake-gh/`

**Files:** `packages/kernel/src/github/gh.ts`, `packages/kernel/src/github/gh.test.ts`, `tools/fake-gh/bin.js`, `tools/fake-gh/fixtures/repos.json`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  ```ts
  export const REPO_NAME_RE: RegExp                      // /^[\w.-]+\/[\w.-]+$/
  export class GhUnavailableError extends Error { hint: string }
  export class InvalidRepoNameError extends Error {}
  export function ghBin(): string                        // AGENTOS_GH_BIN env override, else 'gh'
  export function assertValidRepoName(repo: string): void // throws InvalidRepoNameError
  export function checkGhAvailable(): Promise<{ available: boolean; hint?: string }>
  export function listRepos(query?: string): Promise<GithubRepo[]>       // throws GhUnavailableError
  export function getDefaultBranch(repo: string): Promise<string>        // throws GhUnavailableError
  export function readRepoFile(repo: string, path: string): Promise<string | null>  // null if absent; throws GhUnavailableError only if gh itself is unusable
  ```

- [ ] **Step 1: fake-gh test double + failing tests**
  ```js
  // tools/fake-gh/bin.js
  #!/usr/bin/env node
  import fs from 'node:fs'

  function main() {
    const argv = process.argv.slice(2)
    if (process.env.FAKE_GH_ARGS_OUT) {
      fs.writeFileSync(process.env.FAKE_GH_ARGS_OUT, JSON.stringify(argv, null, 2))
    }
    const mode = process.env.FAKE_GH_MODE ?? 'ok'

    if (mode === 'unavailable') {
      process.stderr.write('gh: To use GitHub CLI in a workflow, set the GH_TOKEN environment variable.\n')
      process.exit(1)
    }
    if (mode === 'not-found') {
      // Simulates the binary not existing at all: AGENTOS_GH_BIN points at a
      // path with nothing there, so execa itself throws ENOENT -- this
      // script is never reached in that case. Kept here only so the mode
      // name is documented alongside the others.
      process.exit(127)
    }

    if (argv[0] === 'auth' && argv[1] === 'status') {
      process.exit(0)
    }

    if (argv[0] === 'repo' && argv[1] === 'list') {
      const fixture = process.env.FAKE_GH_REPOS_FIXTURE
      process.stdout.write(fixture ? fs.readFileSync(fixture, 'utf8') : '[]')
      process.exit(0)
    }

    if (argv[0] === 'api') {
      const path = argv[1] ?? ''
      if (path.endsWith('/contents/package.json') || path.endsWith('/contents/pyproject.toml') || path.endsWith('/contents/Makefile')) {
        const fixture = process.env.FAKE_GH_FILE_FIXTURE
        if (!fixture || !fs.existsSync(fixture)) {
          process.stderr.write('gh: Not Found (HTTP 404)\n')
          process.exit(1)
        }
        const content = fs.readFileSync(fixture, 'utf8')
        process.stdout.write(Buffer.from(content, 'utf8').toString('base64'))
        process.exit(0)
      }
      // repos/:owner/:repo --jq .default_branch
      process.stdout.write(process.env.FAKE_GH_DEFAULT_BRANCH ?? 'main')
      process.exit(0)
    }

    process.stderr.write(`fake-gh: unhandled argv ${JSON.stringify(argv)}\n`)
    process.exit(1)
  }

  main()
  ```
  ```json
  // tools/fake-gh/fixtures/repos.json
  [
    { "nameWithOwner": "octo/widgets", "description": "Widget factory", "defaultBranchRef": { "name": "main" }, "isPrivate": false, "updatedAt": "2026-09-01T00:00:00Z" },
    { "nameWithOwner": "octo/gadgets", "description": null, "defaultBranchRef": { "name": "trunk" }, "isPrivate": true, "updatedAt": "2026-08-15T00:00:00Z" }
  ]
  ```
  ```ts
  // packages/kernel/src/github/gh.test.ts
  import { describe, it, expect, beforeEach } from 'vitest'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'

  const fakeGhBin = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../tools/fake-gh/bin.js',
  )
  const reposFixture = path.resolve(path.dirname(fakeGhBin), 'fixtures/repos.json')

  beforeEach(() => {
    process.env.AGENTOS_GH_BIN = fakeGhBin
    delete process.env.FAKE_GH_MODE
    delete process.env.FAKE_GH_REPOS_FIXTURE
    delete process.env.FAKE_GH_DEFAULT_BRANCH
    delete process.env.FAKE_GH_FILE_FIXTURE
  })

  describe('assertValidRepoName', () => {
    it('accepts owner/name', async () => {
      const { assertValidRepoName } = await import('./gh.js')
      expect(() => assertValidRepoName('octo/widgets')).not.toThrow()
    })
    it('rejects anything without exactly one slash-separated owner/name', async () => {
      const { assertValidRepoName, InvalidRepoNameError } = await import('./gh.js')
      expect(() => assertValidRepoName('not-a-repo')).toThrow(InvalidRepoNameError)
      expect(() => assertValidRepoName('a/b/c')).toThrow(InvalidRepoNameError)
      expect(() => assertValidRepoName('a/$(rm -rf ~)')).toThrow(InvalidRepoNameError)
    })
  })

  describe('checkGhAvailable', () => {
    it('is available when gh auth status exits 0', async () => {
      const { checkGhAvailable } = await import('./gh.js')
      expect(await checkGhAvailable()).toEqual({ available: true })
    })
    it('is unavailable with a hint when gh auth status fails', async () => {
      process.env.FAKE_GH_MODE = 'unavailable'
      const { checkGhAvailable } = await import('./gh.js')
      const result = await checkGhAvailable()
      expect(result.available).toBe(false)
      expect(result.hint).toMatch(/gh auth login|install/i)
    })
  })

  describe('listRepos', () => {
    it('parses gh repo list --json output into GithubRepo[]', async () => {
      process.env.FAKE_GH_REPOS_FIXTURE = reposFixture
      const { listRepos } = await import('./gh.js')
      const repos = await listRepos()
      expect(repos).toEqual([
        { nameWithOwner: 'octo/widgets', description: 'Widget factory', defaultBranch: 'main', isPrivate: false, updatedAt: '2026-09-01T00:00:00Z' },
        { nameWithOwner: 'octo/gadgets', description: null, defaultBranch: 'trunk', isPrivate: true, updatedAt: '2026-08-15T00:00:00Z' },
      ])
    })
    it('throws GhUnavailableError when gh is not usable', async () => {
      process.env.FAKE_GH_MODE = 'unavailable'
      const { listRepos, GhUnavailableError } = await import('./gh.js')
      await expect(listRepos()).rejects.toThrow(GhUnavailableError)
    })
  })

  describe('getDefaultBranch', () => {
    it('reads default_branch via gh api', async () => {
      process.env.FAKE_GH_DEFAULT_BRANCH = 'develop'
      const { getDefaultBranch } = await import('./gh.js')
      expect(await getDefaultBranch('octo/widgets')).toBe('develop')
    })
    it('rejects an invalid repo name before ever spawning gh', async () => {
      const { getDefaultBranch, InvalidRepoNameError } = await import('./gh.js')
      await expect(getDefaultBranch('nope')).rejects.toThrow(InvalidRepoNameError)
    })
  })

  describe('readRepoFile', () => {
    it('returns decoded content when the file exists', async () => {
      const fixtureDir = path.dirname(reposFixture)
      const fixture = path.join(fixtureDir, 'package.json.fixture')
      await import('node:fs').then((fs) => fs.writeFileSync(fixture, '{"scripts":{"test":"vitest"}}'))
      process.env.FAKE_GH_FILE_FIXTURE = fixture
      const { readRepoFile } = await import('./gh.js')
      expect(await readRepoFile('octo/widgets', 'package.json')).toContain('"test":"vitest"')
    })
    it('returns null when the file is absent (404), without throwing', async () => {
      const { readRepoFile } = await import('./gh.js')
      expect(await readRepoFile('octo/widgets', 'package.json')).toBeNull()
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test -- github/gh` — expected failure: cannot find module `./gh.js`.

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/github/gh.ts
  import { execa } from 'execa'
  import type { GithubRepo } from '@agentos/shared'

  export const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/

  export class GhUnavailableError extends Error {
    hint: string
    constructor(hint: string) {
      super('gh not available')
      this.hint = hint
    }
  }

  export class InvalidRepoNameError extends Error {
    constructor(repo: string) {
      super(`invalid repo name: ${repo}`)
    }
  }

  export function ghBin(): string {
    return process.env.AGENTOS_GH_BIN ?? 'gh'
  }

  export function assertValidRepoName(repo: string): void {
    if (!REPO_NAME_RE.test(repo)) throw new InvalidRepoNameError(repo)
  }

  const UNAVAILABLE_HINT =
    'Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.'

  export async function checkGhAvailable(): Promise<{ available: boolean; hint?: string }> {
    const result = await execa(ghBin(), ['auth', 'status'], { reject: false })
    if (result.exitCode === 0) return { available: true }
    return { available: false, hint: UNAVAILABLE_HINT }
  }

  async function requireGh(): Promise<void> {
    const status = await checkGhAvailable()
    if (!status.available) throw new GhUnavailableError(status.hint ?? UNAVAILABLE_HINT)
  }

  interface RawGhRepo {
    nameWithOwner: string
    description: string | null
    defaultBranchRef: { name: string } | null
    isPrivate: boolean
    updatedAt: string
  }

  export async function listRepos(query?: string): Promise<GithubRepo[]> {
    await requireGh()
    const args = [
      'repo', 'list', '--limit', '100',
      '--json', 'nameWithOwner,description,defaultBranchRef,isPrivate,updatedAt',
    ]
    if (query) args.push('--source') // placeholder no-op flag kept out; see note below
    const result = await execa(ghBin(), [
      'repo', 'list', '--limit', '100',
      '--json', 'nameWithOwner,description,defaultBranchRef,isPrivate,updatedAt',
      ...(query ? ['--query', query] : []),
    ], { reject: false })
    if (result.exitCode !== 0) throw new GhUnavailableError(UNAVAILABLE_HINT)
    const raw = JSON.parse(result.stdout) as RawGhRepo[]
    return raw.map((r) => ({
      nameWithOwner: r.nameWithOwner,
      description: r.description,
      defaultBranch: r.defaultBranchRef?.name ?? 'main',
      isPrivate: r.isPrivate,
      updatedAt: r.updatedAt,
    }))
  }

  export async function getDefaultBranch(repo: string): Promise<string> {
    assertValidRepoName(repo)
    await requireGh()
    const result = await execa(
      ghBin(),
      ['api', `repos/${repo}`, '--jq', '.default_branch'],
      { reject: false },
    )
    if (result.exitCode !== 0) throw new GhUnavailableError(UNAVAILABLE_HINT)
    return result.stdout.trim()
  }

  export async function readRepoFile(repo: string, filePath: string): Promise<string | null> {
    assertValidRepoName(repo)
    await requireGh()
    const result = await execa(
      ghBin(),
      ['api', `repos/${repo}/contents/${filePath}`, '--jq', '.content'],
      { reject: false },
    )
    if (result.exitCode !== 0) return null
    return Buffer.from(result.stdout.replace(/\n/g, ''), 'base64').toString('utf8')
  }
  ```
  Delete the stray unused `args`/`if (query)` lines above before committing — they were left in as
  a reminder that `--query` is the actual gh flag and must be the only place `query` is threaded
  through; the real implementation is the second `execa` call. (Write the file directly without
  that dead code; it is called out here only so the implementer doesn't invent a different, wrong
  flag name.)
  Run: `pnpm --filter @agentos/kernel test -- github/gh` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/github tools/fake-gh
  git commit -m "$(cat <<'EOF'
  feat(kernel): add gh CLI service (execa-only, no stored token) and fake-gh test double

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: `GET /api/github/repos` route

**Files:** `packages/kernel/src/api/github.ts`, `packages/kernel/src/api/github.test.ts`, `packages/kernel/src/api/server.ts` (modify)

**Interfaces:**
- Consumes: `listRepos`, `GhUnavailableError` (Task 3).
- Produces: `export function registerGithubRoutes(app: FastifyInstance): void` — `GET /api/github/repos?query=`.

- [ ] **Step 1: failing test**
  ```ts
  // packages/kernel/src/api/github.test.ts
  import Fastify from 'fastify'
  import { describe, it, expect, beforeEach } from 'vitest'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'
  import { registerGithubRoutes } from './github.js'

  const fakeGhBin = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../tools/fake-gh/bin.js',
  )
  const reposFixture = path.resolve(path.dirname(fakeGhBin), 'fixtures/repos.json')

  beforeEach(() => {
    process.env.AGENTOS_GH_BIN = fakeGhBin
    delete process.env.FAKE_GH_MODE
    process.env.FAKE_GH_REPOS_FIXTURE = reposFixture
  })

  describe('GET /api/github/repos', () => {
    it('returns the repo list', async () => {
      const app = Fastify()
      registerGithubRoutes(app)
      const res = await app.inject({ method: 'GET', url: '/api/github/repos' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toHaveLength(2)
    })

    it('returns 503 with a hint when gh is unavailable', async () => {
      process.env.FAKE_GH_MODE = 'unavailable'
      const app = Fastify()
      registerGithubRoutes(app)
      const res = await app.inject({ method: 'GET', url: '/api/github/repos' })
      expect(res.statusCode).toBe(503)
      const body = JSON.parse(res.body)
      expect(body.error).toBe('gh not available')
      expect(body.hint).toBeTruthy()
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test -- api/github` — expected failure: cannot find module `./github.js`.

- [ ] **Step 2: implement + wire into server.ts**
  ```ts
  // packages/kernel/src/api/github.ts
  import type { FastifyInstance } from 'fastify'
  import { GhUnavailableError, listRepos } from '../github/gh.js'

  export function registerGithubRoutes(app: FastifyInstance): void {
    app.get('/api/github/repos', async (req, reply) => {
      const { query } = req.query as { query?: string }
      try {
        return await listRepos(query)
      } catch (err) {
        if (err instanceof GhUnavailableError) {
          return reply.code(503).send({ error: 'gh not available', hint: err.hint })
        }
        throw err
      }
    })
  }
  ```
  ```ts
  // packages/kernel/src/api/server.ts — add import and call, next to registerInternalRoutes
  import { registerGithubRoutes } from './github.js'
  // ...
  registerGithubRoutes(app)
  ```
  Run: `pnpm --filter @agentos/kernel test -- api/github` — expected: PASS. Then `pnpm --filter @agentos/kernel test` (full suite) — expected: PASS (no regression in `server.test.ts`).

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/api/github.ts packages/kernel/src/api/github.test.ts packages/kernel/src/api/server.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add GET /api/github/repos with the 503-when-gh-unavailable path

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: `ProjectService` — name derivation, yaml write, uniqueness

**Files:** `packages/kernel/src/projects/projectService.ts`, `packages/kernel/src/projects/projectService.test.ts`

**Interfaces:**
- Consumes: `AdapterHost.loadProjects` (existing), `KernelConfig` (contract §4), `ProjectConfigSchema` (Task 1).
- Produces (this task — happy-path name/yaml only; sync + routine wiring is Task 6):
  ```ts
  export interface AddProjectInput {
    repo: string
    name?: string
    adapter?: string     // default 'techpulse-coo'
    baseBranch?: string
    build?: boolean
  }
  export class ProjectNameCollisionError extends Error {}
  export class ProjectNotFoundError extends Error {}
  export function deriveProjectName(repo: string): string
  export class ProjectService {
    constructor(cfg: KernelConfig, adapters: AdapterHost, scheduler: Scheduler, log: EventLog)
    async writeProjectYaml(project: ProjectConfig): Promise<void>   // internal-ish but exported for the test in this task
  }
  ```

- [ ] **Step 1: failing test**
  ```ts
  // packages/kernel/src/projects/projectService.test.ts
  import { mkdtempSync, readFileSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import { describe, it, expect } from 'vitest'
  import { parse as parseYaml } from 'yaml'
  import { deriveProjectName, ProjectService } from './projectService.js'
  import { AdapterHost } from '../adapters/adapterHost.js'
  import { Scheduler } from '../scheduler/scheduler.js'
  import { EventLog } from '../log/eventLog.js'
  import { WikiService } from '../wiki/wikiService.js'
  import type { KernelConfig } from '../config.js'

  function makeCfg(osRoot: string): KernelConfig {
    return { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1', port: 0, logLevel: 'info' }
  }

  function makeService(osRoot: string) {
    const cfg = makeCfg(osRoot)
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const adapters = new AdapterHost(cfg, log, wiki, {})
    const scheduler = new Scheduler(cfg, log, async () => {})
    return { cfg, log, service: new ProjectService(cfg, adapters, scheduler, log) }
  }

  describe('deriveProjectName', () => {
    it('lower-cases and replaces non [a-z0-9-] characters', () => {
      expect(deriveProjectName('octo/My.Repo_Name')).toBe('my-repo-name')
    })
  })

  describe('ProjectService.writeProjectYaml', () => {
    it('writes os/projects/<name>.yaml with an unexpanded clone path', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const { service } = makeService(osRoot)
      const project = {
        name: 'widgets', adapter: 'techpulse-coo', repo: 'octo/widgets',
        clone: '${AGENTOS_CLONES}/widgets', base_branch: 'main',
        options: { proposals_path: 'docs/missions/coo/proposals', state_path: 'docs/missions/coo/state.md', reports_path: 'docs/missions/coo/reports' },
      }
      await service.writeProjectYaml(project)
      const written = parseYaml(readFileSync(path.join(osRoot, 'projects', 'widgets.yaml'), 'utf8'))
      expect(written.clone).toBe('${AGENTOS_CLONES}/widgets')
      expect(written.name).toBe('widgets')
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test -- projects/projectService` — expected failure: cannot find module `./projectService.js`.

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/projects/projectService.ts
  import { mkdir, writeFile } from 'node:fs/promises'
  import path from 'node:path'
  import { stringify as stringifyYaml } from 'yaml'
  import type { ProjectConfig } from '@agentos/shared'
  import type { KernelConfig } from '../config.js'
  import type { EventLog } from '../log/eventLog.js'
  import type { AdapterHost } from '../adapters/adapterHost.js'
  import type { Scheduler } from '../scheduler/scheduler.js'

  export class ProjectNameCollisionError extends Error {
    constructor(name: string) {
      super(`project '${name}' already exists`)
    }
  }
  export class ProjectNotFoundError extends Error {
    constructor(name: string) {
      super(`unknown project '${name}'`)
    }
  }

  export function deriveProjectName(repo: string): string {
    const segment = repo.split('/').pop() ?? repo
    return segment.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
  }

  export interface AddProjectInput {
    repo: string
    name?: string
    adapter?: string
    baseBranch?: string
    build?: boolean
  }

  export class ProjectService {
    constructor(
      private cfg: KernelConfig,
      private adapters: AdapterHost,
      private scheduler: Scheduler,
      private log: EventLog,
    ) {}

    async writeProjectYaml(project: ProjectConfig): Promise<void> {
      const dir = path.join(this.cfg.osRoot, 'projects')
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, `${project.name}.yaml`), stringifyYaml(project), 'utf8')
    }
  }
  ```
  Run: `pnpm --filter @agentos/kernel test -- projects/projectService` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/projects/projectService.ts packages/kernel/src/projects/projectService.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add ProjectService with name derivation and yaml writer

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: `ProjectService.addProject` — routine wiring, build-checks inference, first sync

**Files:** `packages/kernel/src/projects/projectService.ts`, `packages/kernel/src/projects/projectService.test.ts`

**Interfaces:**
- Consumes: `gh.getDefaultBranch`, `gh.readRepoFile`, `gh.assertValidRepoName` (Task 3); `Scheduler.registerRoutine` (Task 2); `AdapterHost.sync` (existing); `EventLog.updateRun`/read for routines.yaml persistence is file-based, not EventLog.
- Produces:
  ```ts
  export interface AddProjectResult { project: ProjectConfig; sync: SyncResult; syncError?: string }
  class ProjectService {
    async addProject(input: AddProjectInput): Promise<AddProjectResult>
  }
  ```

- [ ] **Step 1: failing tests**
  ```ts
  // append to packages/kernel/src/projects/projectService.test.ts
  import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

  function seedRoutinesFile(osRoot: string) {
    writeFileSync(
      path.join(osRoot, 'routines.yaml'),
      'defaults:\n  model: sonnet\n  permission_mode: plan\n  allowed_tools: []\n  max_attempts: 2\n  timeout_ms: 600000\nroutines: []\n',
    )
  }

  describe('ProjectService.addProject', () => {
    it('registers a project: writes yaml, appends the sync routine, hot-registers it, runs the first sync', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      process.env.AGENTOS_GH_BIN = fakeGhBin // reuse the Task 3 fake-gh path constant, imported the same way
      process.env.FAKE_GH_DEFAULT_BRANCH = 'main'

      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const syncCalls: string[] = []
      const registry = {
        'techpulse-coo': {
          name: 'techpulse-coo',
          sync: async () => { syncCalls.push('sync'); return { added: [], changed: [], events: [], hasCooLayout: false } },
          applyDecision: async () => {},
        },
      }
      const adapters = new AdapterHost(cfg, log, wiki, registry)
      const scheduler = new Scheduler(cfg, log, async () => {})
      const service = new ProjectService(cfg, adapters, scheduler, log)

      const result = await service.addProject({ repo: 'octo/widgets' })

      expect(result.project.name).toBe('widgets')
      expect(result.project.base_branch).toBe('main')
      expect(result.sync.hasCooLayout).toBe(false)
      expect(syncCalls).toEqual(['sync'])
      expect(existsSync(path.join(osRoot, 'projects', 'widgets.yaml'))).toBe(true)
      const routinesText = readFileSync(path.join(osRoot, 'routines.yaml'), 'utf8')
      expect(routinesText).toContain('widgets-sync')
      expect(scheduler.list().some((l) => l.routine.name === 'widgets-sync')).toBe(true)
    })

    it('rejects an invalid repo name before writing anything', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      const { service } = makeService(osRoot)
      await expect(service.addProject({ repo: 'not-a-repo' })).rejects.toThrow()
      expect(existsSync(path.join(osRoot, 'projects'))).toBe(false)
    })

    it('rejects a name collision with 409-worthy error', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      process.env.AGENTOS_GH_BIN = fakeGhBin
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => ({ added: [], changed: [], events: [] }), applyDecision: async () => {} } }
      const adapters = new AdapterHost(cfg, log, wiki, registry)
      const scheduler = new Scheduler(cfg, log, async () => {})
      const service = new ProjectService(cfg, adapters, scheduler, log)
      await service.addProject({ repo: 'octo/widgets' })

      await expect(service.addProject({ repo: 'other/widgets' })).rejects.toThrow(ProjectNameCollisionError)
    })

    it('keeps the written project and returns syncError when the first sync throws', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      process.env.AGENTOS_GH_BIN = fakeGhBin
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => { throw new Error('clone failed') }, applyDecision: async () => {} } }
      const adapters = new AdapterHost(cfg, log, wiki, registry)
      const scheduler = new Scheduler(cfg, log, async () => {})
      const service = new ProjectService(cfg, adapters, scheduler, log)

      const result = await service.addProject({ repo: 'octo/widgets' })

      expect(result.syncError).toContain('clone failed')
      expect(existsSync(path.join(osRoot, 'projects', 'widgets.yaml'))).toBe(true)
    })

    it('writes a build block with inferred checks when build: true', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      process.env.AGENTOS_GH_BIN = fakeGhBin
      process.env.FAKE_GH_FILE_FIXTURE = path.join(osRoot, 'package.json.fixture')
      writeFileSync(process.env.FAKE_GH_FILE_FIXTURE, JSON.stringify({ scripts: { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run' } }))
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => ({ added: [], changed: [], events: [] }), applyDecision: async () => {} } }
      const adapters = new AdapterHost(cfg, log, wiki, registry)
      const scheduler = new Scheduler(cfg, log, async () => {})
      const service = new ProjectService(cfg, adapters, scheduler, log)

      const result = await service.addProject({ repo: 'octo/widgets', build: true })

      expect(result.project.build?.enabled).toBe(true)
      expect(result.project.build?.checks).toContain('pnpm -r --if-present typecheck')
      expect(result.project.build?.checks).toContain('pnpm -r --if-present lint')
      expect(result.project.build?.checks).toContain('pnpm -r --if-present test')
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test -- projects/projectService` — expected failure: `service.addProject is not a function`.

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/projects/projectService.ts — add imports and the addProject method
  import { readFile, writeFile as writeFileP } from 'node:fs/promises'
  import type { RoutineConfig, RoutinesFile } from '@agentos/shared'
  import { parseRoutinesFile } from '@agentos/shared'
  import type { SyncResult } from '../adapters/types.js'
  import { assertValidRepoName, getDefaultBranch, readRepoFile } from '../github/gh.js'

  export interface AddProjectResult {
    project: ProjectConfig
    sync: SyncResult
    syncError?: string
  }

  const DEFAULT_CHECKS = [
    'pnpm -r --if-present typecheck',
    'pnpm -r --if-present lint',
    'pnpm -r --if-present test',
  ]

  async function inferBuildChecks(repo: string): Promise<string[]> {
    const pkgRaw = await readRepoFile(repo, 'package.json')
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> }
        const checks = ['typecheck', 'lint', 'test']
          .filter((s) => pkg.scripts?.[s])
          .map((s) => `pnpm -r --if-present ${s}`)
        if (checks.length > 0) return checks
      } catch {
        // fall through to the next probe on unparseable package.json
      }
    }
    const pyproject = await readRepoFile(repo, 'pyproject.toml')
    if (pyproject) return ['ruff check .', 'pytest']
    const makefile = await readRepoFile(repo, 'Makefile')
    if (makefile) {
      const targets = [...makefile.matchAll(/^([a-zA-Z][\w-]*):/gm)].map((m) => m[1])
      const checks = ['typecheck', 'lint', 'test'].filter((t) => targets.includes(t)).map((t) => `make ${t}`)
      if (checks.length > 0) return checks
    }
    return DEFAULT_CHECKS
  }

  // (add this method inside class ProjectService, below writeProjectYaml)

    private async loadRoutinesFile(): Promise<{ file: RoutinesFile; path: string }> {
      const p = path.join(this.cfg.osRoot, 'routines.yaml')
      const text = await readFile(p, 'utf8')
      return { file: parseRoutinesFile(text), path: p }
    }

    private async saveRoutinesFile(file: RoutinesFile, filePath: string): Promise<void> {
      await writeFileP(filePath, stringifyYaml(file), 'utf8')
    }

    async addProject(input: AddProjectInput): Promise<AddProjectResult> {
      assertValidRepoName(input.repo)
      const adapter = input.adapter ?? 'techpulse-coo'
      const name = input.name ?? deriveProjectName(input.repo)

      const existing = await this.adapters.loadProjects()
      if (existing.some((p) => p.name === name)) {
        throw new ProjectNameCollisionError(name)
      }

      const baseBranch = input.baseBranch ?? (await getDefaultBranch(input.repo))

      const options =
        adapter === 'techpulse-coo'
          ? {
              proposals_path: 'docs/missions/coo/proposals',
              state_path: 'docs/missions/coo/state.md',
              reports_path: 'docs/missions/coo/reports',
            }
          : {}

      const project: ProjectConfig = {
        name,
        adapter,
        repo: input.repo,
        clone: `\${AGENTOS_CLONES}/${name}`,
        base_branch: baseBranch,
        options,
        ...(input.build
          ? {
              build: {
                enabled: true,
                model: 'sonnet',
                permission_mode: 'acceptEdits' as const,
                allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
                checks: await inferBuildChecks(input.repo),
                timeout_ms: 2_400_000,
              },
            }
          : {}),
      }

      await this.writeProjectYaml(project)

      const routineName = `${name}-sync`
      const { file: routinesFile, path: routinesPath } = await this.loadRoutinesFile()
      if (!routinesFile.routines.some((r) => r.name === routineName)) {
        const routine: RoutineConfig = { name: routineName, every: '1h', adapter: name }
        routinesFile.routines.push(routine)
        await this.saveRoutinesFile(routinesFile, routinesPath)
        this.scheduler.registerRoutine(routine)
      } else {
        this.scheduler.registerRoutine(
          // biome-ignore lint/style/noNonNullAssertion: just checked with .some above
          routinesFile.routines.find((r) => r.name === routineName)!,
        )
      }

      try {
        const sync = await this.adapters.sync(name)
        return { project, sync }
      } catch (err) {
        return {
          project,
          sync: { added: [], changed: [], events: [] },
          syncError: err instanceof Error ? err.message : String(err),
        }
      }
    }
  ```
  Also add `import { stringify as stringifyYaml } from 'yaml'` (already imported in Task 5's version — keep it) and ensure `ProjectConfig` is imported (already is).
  Run: `pnpm --filter @agentos/kernel test -- projects/projectService` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/projects/projectService.ts packages/kernel/src/projects/projectService.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): ProjectService.addProject — routine wiring, build-check inference, first sync

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: `ProjectService.listProjects` / `removeProject`

**Files:** `packages/kernel/src/projects/projectService.ts`, `packages/kernel/src/projects/projectService.test.ts`

**Interfaces:**
- Consumes: `Scheduler.list`, `Scheduler.unregisterRoutine`, `AdapterHost.loadProjects`, `EventLog.listRuns`.
- Produces:
  ```ts
  async listProjects(): Promise<ProjectListItem[]>
  async removeProject(name: string): Promise<void>   // throws ProjectNotFoundError
  ```

- [ ] **Step 1: failing tests**
  ```ts
  // append to packages/kernel/src/projects/projectService.test.ts
  describe('ProjectService.listProjects', () => {
    it('reports config, registered routines, lastSync and hasCooLayout', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      process.env.AGENTOS_GH_BIN = fakeGhBin
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => ({ added: [], changed: [], events: [], hasCooLayout: false }), applyDecision: async () => {} } }
      const adapters = new AdapterHost(cfg, log, wiki, registry)
      const scheduler = new Scheduler(cfg, log, async () => {})
      const service = new ProjectService(cfg, adapters, scheduler, log)
      await service.addProject({ repo: 'octo/widgets' })

      const list = await service.listProjects()

      expect(list).toHaveLength(1)
      expect(list[0].config.name).toBe('widgets')
      expect(list[0].routines).toEqual(['widgets-sync'])
      expect(list[0].lastSync?.status).toBe('success')
      expect(list[0].hasCooLayout).toBe(false)
    })

    it('returns an empty array with no projects registered', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const { service } = makeService(osRoot)
      expect(await service.listProjects()).toEqual([])
    })
  })

  describe('ProjectService.removeProject', () => {
    it('deletes the project yaml, removes the routine from routines.yaml, and unregisters it live -- keeping the clone/raw mirror untouched', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      seedRoutinesFile(osRoot)
      process.env.AGENTOS_GH_BIN = fakeGhBin
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => ({ added: [], changed: [], events: [] }), applyDecision: async () => {} } }
      const adapters = new AdapterHost(cfg, log, wiki, registry)
      const scheduler = new Scheduler(cfg, log, async () => {})
      const service = new ProjectService(cfg, adapters, scheduler, log)
      await service.addProject({ repo: 'octo/widgets' })
      mkdirSync(path.join(osRoot, 'raw', 'widgets'), { recursive: true })
      writeFileSync(path.join(osRoot, 'raw', 'widgets', 'state.md'), '# kept\n')

      await service.removeProject('widgets')

      expect(existsSync(path.join(osRoot, 'projects', 'widgets.yaml'))).toBe(false)
      expect(readFileSync(path.join(osRoot, 'routines.yaml'), 'utf8')).not.toContain('widgets-sync')
      expect(scheduler.list().some((l) => l.routine.name === 'widgets-sync')).toBe(false)
      expect(existsSync(path.join(osRoot, 'raw', 'widgets', 'state.md'))).toBe(true)
    })

    it('throws ProjectNotFoundError for an unknown project', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const { service } = makeService(osRoot)
      await expect(service.removeProject('nope')).rejects.toThrow(ProjectNotFoundError)
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test -- projects/projectService` — expected failure: `service.listProjects`/`removeProject` are not functions.

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/projects/projectService.ts — add imports and two methods
  import { rm } from 'node:fs/promises'
  import { stat } from 'node:fs/promises'
  import type { ProjectListItem } from '@agentos/shared'

  async function pathExists(p: string): Promise<boolean> {
    return stat(p).then(() => true).catch(() => false)
  }

  // inside class ProjectService:

    async listProjects(): Promise<ProjectListItem[]> {
      const projects = await this.adapters.loadProjects()
      const registered = new Set(this.scheduler.list().map((l) => l.routine.name))
      return Promise.all(
        projects.map(async (config) => {
          const routineName = `${config.name}-sync`
          const routines = registered.has(routineName) ? [routineName] : []
          const lastSync = this.log.listRuns({ routine: `adapter:${config.name}`, limit: 1 })[0]
          const proposalsPath = config.options.proposals_path
          const hasCooLayout =
            typeof proposalsPath === 'string'
              ? await pathExists(path.join(config.clone, proposalsPath))
              : true
          return { config, routines, lastSync, hasCooLayout }
        }),
      )
    }

    async removeProject(name: string): Promise<void> {
      const projects = await this.adapters.loadProjects()
      const project = projects.find((p) => p.name === name)
      if (!project) throw new ProjectNotFoundError(name)

      await rm(path.join(this.cfg.osRoot, 'projects', `${name}.yaml`))

      const routineName = `${name}-sync`
      const { file: routinesFile, path: routinesPath } = await this.loadRoutinesFile()
      routinesFile.routines = routinesFile.routines.filter((r) => r.name !== routineName)
      await this.saveRoutinesFile(routinesFile, routinesPath)
      this.scheduler.unregisterRoutine(routineName)
      // clone/ and raw/<name>/ deliberately untouched -- spec §4.2
    }
  ```
  Run: `pnpm --filter @agentos/kernel test -- projects/projectService` — expected: PASS. Then `pnpm --filter @agentos/kernel test` (full suite) — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/projects/projectService.ts packages/kernel/src/projects/projectService.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): ProjectService.listProjects/removeProject, keeping clone and raw/ on removal

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: `api/projects.ts` routes + `kernel.projects` wiring

**Files:** `packages/kernel/src/api/projects.ts`, `packages/kernel/src/api/projects.test.ts`, `packages/kernel/src/api/server.ts` (modify), `packages/kernel/src/kernel.ts` (modify)

**Interfaces:**
- Consumes: `ProjectService` (Tasks 5–7).
- Produces: `export function registerProjectCrudRoutes(app: FastifyInstance, deps: { projects: ProjectService }): void` — `GET /api/projects`, `POST /api/projects`, `DELETE /api/projects/:name`. `Kernel` interface gains `projects: ProjectService`.

- [ ] **Step 1: failing tests**
  ```ts
  // packages/kernel/src/api/projects.test.ts
  import Fastify from 'fastify'
  import { describe, it, expect, vi } from 'vitest'
  import { registerProjectCrudRoutes } from './projects.js'
  import {
    ProjectNameCollisionError,
    ProjectNotFoundError,
  } from '../projects/projectService.js'
  import { GhUnavailableError } from '../github/gh.js'
  import { InvalidRepoNameError } from '../github/gh.js'

  function makeApp(overrides: Partial<Record<'listProjects' | 'addProject' | 'removeProject', unknown>> = {}) {
    const app = Fastify()
    const projects = {
      listProjects: vi.fn(async () => []),
      addProject: vi.fn(async () => ({ project: { name: 'widgets' }, sync: { added: [], changed: [], events: [] } })),
      removeProject: vi.fn(async () => {}),
      ...overrides,
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural ProjectService stub
    } as any
    registerProjectCrudRoutes(app, { projects })
    return { app, projects }
  }

  describe('GET /api/projects', () => {
    it('returns the project list', async () => {
      const { app } = makeApp()
      const res = await app.inject({ method: 'GET', url: '/api/projects' })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('POST /api/projects', () => {
    it('adds a project and returns 201', async () => {
      const { app } = makeApp()
      const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { repo: 'octo/widgets' } })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.body).project.name).toBe('widgets')
    })

    it('maps InvalidRepoNameError to 400', async () => {
      const { app } = makeApp({ addProject: vi.fn(async () => { throw new InvalidRepoNameError('bad') }) })
      const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { repo: 'bad' } })
      expect(res.statusCode).toBe(400)
    })

    it('maps ProjectNameCollisionError to 409', async () => {
      const { app } = makeApp({ addProject: vi.fn(async () => { throw new ProjectNameCollisionError('widgets') }) })
      const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { repo: 'octo/widgets' } })
      expect(res.statusCode).toBe(409)
    })

    it('maps GhUnavailableError to 503 with a hint', async () => {
      const { app } = makeApp({ addProject: vi.fn(async () => { throw new GhUnavailableError('install gh') }) })
      const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { repo: 'octo/widgets' } })
      expect(res.statusCode).toBe(503)
      expect(JSON.parse(res.body).hint).toBe('install gh')
    })
  })

  describe('DELETE /api/projects/:name', () => {
    it('removes a project and returns 200', async () => {
      const { app, projects } = makeApp()
      const res = await app.inject({ method: 'DELETE', url: '/api/projects/widgets' })
      expect(res.statusCode).toBe(200)
      expect(projects.removeProject).toHaveBeenCalledWith('widgets')
    })

    it('maps ProjectNotFoundError to 404', async () => {
      const { app } = makeApp({ removeProject: vi.fn(async () => { throw new ProjectNotFoundError('widgets') }) })
      const res = await app.inject({ method: 'DELETE', url: '/api/projects/widgets' })
      expect(res.statusCode).toBe(404)
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test -- api/projects` — expected failure: cannot find module `./projects.js`.

- [ ] **Step 2: implement + wire into server.ts and kernel.ts**
  ```ts
  // packages/kernel/src/api/projects.ts
  import type { FastifyInstance } from 'fastify'
  import type { AddProjectRequest } from '@agentos/shared'
  import { GhUnavailableError, InvalidRepoNameError } from '../github/gh.js'
  import {
    ProjectNameCollisionError,
    ProjectNotFoundError,
    type ProjectService,
  } from '../projects/projectService.js'

  export function registerProjectCrudRoutes(
    app: FastifyInstance,
    deps: { projects: ProjectService },
  ): void {
    app.get('/api/projects', async () => deps.projects.listProjects())

    app.post('/api/projects', async (req, reply) => {
      const body = req.body as AddProjectRequest
      if (!body?.repo) return reply.code(400).send({ error: 'repo is required' })
      try {
        const result = await deps.projects.addProject({
          repo: body.repo,
          name: body.name,
          adapter: body.adapter,
          baseBranch: body.base_branch,
          build: body.build,
        })
        return reply.code(201).send(result)
      } catch (err) {
        if (err instanceof InvalidRepoNameError) {
          return reply.code(400).send({ error: err.message })
        }
        if (err instanceof ProjectNameCollisionError) {
          return reply.code(409).send({ error: err.message })
        }
        if (err instanceof GhUnavailableError) {
          return reply.code(503).send({ error: 'gh not available', hint: err.hint })
        }
        throw err
      }
    })

    app.delete<{ Params: { name: string } }>('/api/projects/:name', async (req, reply) => {
      try {
        await deps.projects.removeProject(req.params.name)
        return { ok: true }
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message })
        }
        throw err
      }
    })
  }
  ```
  ```ts
  // packages/kernel/src/api/server.ts — add import and call
  import { registerProjectCrudRoutes } from './projects.js'
  // ... near registerGithubRoutes(app)
  registerProjectCrudRoutes(app, { projects: kernel.projects })
  ```
  ```ts
  // packages/kernel/src/kernel.ts — add ProjectService to the Kernel interface and KernelImpl
  import { ProjectService } from './projects/projectService.js'
  // ...
  export interface Kernel {
    cfg: KernelConfig
    log: EventLog
    pm: ProcessManager
    scheduler: Scheduler
    wiki: WikiService
    adapters: AdapterHost
    projects: ProjectService
    start(): Promise<void>
    stop(): Promise<void>
  }
  // ... inside KernelImpl
  projects: ProjectService
  constructor(public cfg: KernelConfig, registry: Record<string, ProjectAdapter> = {}) {
    this.log = new EventLog(cfg.dbPath)
    this.pm = new ProcessManager(cfg, this.log)
    this.wiki = new WikiService(cfg.osRoot, this.log)
    this.adapters = new AdapterHost(cfg, this.log, this.wiki, registry)
    this.scheduler = new Scheduler(cfg, this.log, (routine, payload) => this.exec(routine, payload))
    this.projects = new ProjectService(cfg, this.adapters, this.scheduler, this.log)
  }
  ```
  Run: `pnpm --filter @agentos/kernel test -- api/projects` — expected: PASS. Then `pnpm --filter @agentos/kernel test` (full suite) and `pnpm --filter @agentos/kernel typecheck` — expected: PASS (server.test.ts's `makeKernel()` stub kernel objects will need a `projects` field added wherever they construct a minimal `Kernel`-shaped object by hand — check `server.test.ts` and `decisions.test.ts` for any such stub and add a trivial `projects: { listProjects: async () => [], addProject: async () => { throw new Error('unused') }, removeProject: async () => {} }` stub so those existing tests keep compiling/passing; do not change their assertions).

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/api/projects.ts packages/kernel/src/api/projects.test.ts packages/kernel/src/api/server.ts packages/kernel/src/kernel.ts packages/kernel/src/api/server.test.ts packages/kernel/src/api/decisions.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add GET/POST/DELETE /api/projects and wire ProjectService into the Kernel

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: Dashboard `client.ts` + `mockServer.ts` + `Icon` + `App.tsx` nav

**Files:** `packages/dashboard/src/api/client.ts`, `packages/dashboard/src/api/client.test.ts`, `packages/dashboard/tests/mockServer.ts`, `packages/dashboard/src/components/Icon.tsx`, `packages/dashboard/src/App.tsx`, `packages/dashboard/src/App.test.tsx`

**Interfaces:**
- Produces (on `ApiClient`):
  ```ts
  listGithubRepos(query?: string): Promise<GithubRepo[]>
  listProjects(): Promise<ProjectListItem[]>
  addProject(input: { repo: string; name?: string; adapter?: string; base_branch?: string; build?: boolean }): Promise<AddProjectResponse>
  removeProject(name: string): Promise<{ ok: true }>
  ```
  `App.tsx`: `PanelName` gains `'projects'`, inserted into `NAV` between `'costs'` and `'messages'` (so Messages, already present in this branch, keeps working as an insertion-friendly diff per the coordinating note about a separate Messages PR).

- [ ] **Step 1: failing tests**
  ```ts
  // append to packages/dashboard/src/api/client.test.ts
  describe('ApiClient — projects', () => {
    beforeEach(() => installMockFetch())

    it('lists github repos', async () => {
      const client = new ApiClient()
      const repos = await client.listGithubRepos()
      expect(repos).toEqual(fixtures.githubRepos)
    })

    it('lists projects', async () => {
      const client = new ApiClient()
      const list = await client.listProjects()
      expect(list).toEqual([fixtures.projectListItem])
    })

    it('adds a project', async () => {
      const client = new ApiClient()
      const result = await client.addProject({ repo: 'octo/widgets' })
      expect(result.project.name).toBe('widgets')
    })

    it('removes a project', async () => {
      const client = new ApiClient()
      const result = await client.removeProject('widgets')
      expect(result.ok).toBe(true)
    })
  })
  ```
  ```tsx
  // update packages/dashboard/src/App.test.tsx — extend the existing panel-switch test
  it('switches to the Projects panel', async () => {
    installMockFetch()
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Projects', exact: true }))
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — expected failure: `client.listGithubRepos is not a function`; no `Projects` button in the nav.

- [ ] **Step 2: implement**
  ```ts
  // packages/dashboard/tests/mockServer.ts — add to fixtures and routes
  import type { GithubRepo } from '@agentos/shared'
  // (extend the existing `fixtures` object literal)
  githubRepos: [
    { nameWithOwner: 'octo/widgets', description: 'Widget factory', defaultBranch: 'main', isPrivate: false, updatedAt: '2026-09-01T00:00:00Z' },
  ] satisfies GithubRepo[],
  projectListItem: {
    config: { name: 'techpulse', adapter: 'techpulse-coo', repo: 'octo/techpulse', clone: '/clones/techpulse', base_branch: 'main', options: {} },
    routines: ['techpulse-sync'],
    hasCooLayout: true,
  },
  // (extend the `routes` object literal)
  'GET /api/github/repos': () => fixtures.githubRepos,
  'GET /api/projects': () => [fixtures.projectListItem],
  'POST /api/projects': () => ({ project: { name: 'widgets', adapter: 'techpulse-coo', repo: 'octo/widgets', clone: '/clones/widgets', base_branch: 'main', options: {} }, sync: { added: [], changed: [], events: [], hasCooLayout: false } }),
  'DELETE /api/projects/widgets': () => ({ ok: true }),
  ```
  ```ts
  // packages/dashboard/src/api/client.ts — add imports and methods
  import type { AddProjectResponse, GithubRepo, ProjectListItem } from '@agentos/shared'
  // ... inside class ApiClient
  listGithubRepos(query?: string) {
    return this.req<GithubRepo[]>('GET', `/api/github/repos${query ? `?query=${encodeURIComponent(query)}` : ''}`)
  }
  listProjects() {
    return this.req<ProjectListItem[]>('GET', '/api/projects')
  }
  addProject(input: { repo: string; name?: string; adapter?: string; base_branch?: string; build?: boolean }) {
    return this.req<AddProjectResponse>('POST', '/api/projects', input)
  }
  removeProject(name: string) {
    return this.req<{ ok: true }>('DELETE', `/api/projects/${name}`)
  }
  ```
  ```tsx
  // packages/dashboard/src/components/Icon.tsx — extend IconName and PATHS
  export type IconName =
    | 'overview' | 'runs' | 'decisions' | 'wiki' | 'skills' | 'routines' | 'costs' | 'messages'
    | 'projects'
    | 'close' | 'check' | 'x' | 'play' | 'stop' | 'search'
  // in PATHS:
  projects: 'M4 4h6l2 2h8v12H4z',
  ```
  ```tsx
  // packages/dashboard/src/App.tsx — nav insertion (between costs and messages)
  import { ProjectsPanel } from './panels/ProjectsPanel'
  // ...
  const NAV: Array<{ id: PanelName; label: string; icon: IconName }> = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'runs', label: 'Runs', icon: 'runs' },
    { id: 'decisions', label: 'Decisions', icon: 'decisions' },
    { id: 'wiki', label: 'Wiki', icon: 'wiki' },
    { id: 'skills', label: 'Skills', icon: 'skills' },
    { id: 'routines', label: 'Routines', icon: 'routines' },
    { id: 'costs', label: 'Costs', icon: 'costs' },
    { id: 'projects', label: 'Projects', icon: 'projects' },
    { id: 'messages', label: 'Messages', icon: 'messages' },
  ]
  export type PanelName =
    | 'overview' | 'runs' | 'decisions' | 'wiki' | 'skills' | 'routines' | 'costs'
    | 'projects' | 'messages'
  // ... in the switch:
    case 'projects':
      panel = <ProjectsPanel />
      break
  ```
  (`ProjectsPanel` doesn't exist until Task 11 — Task 9's App.test.tsx assertion only needs the nav button and a heading, so create a one-line placeholder now: `export function ProjectsPanel() { return <h2 className="text-lg font-medium">Projects</h2> }` in a new `packages/dashboard/src/panels/ProjectsPanel.tsx`, exactly like the M5 plan's Task 5 precedent of stubbing panels before their own task fleshes them out. Task 11 replaces this stub's body while keeping the same heading text, so this test keeps passing.)
  Run: `pnpm --filter @agentos/dashboard test` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/dashboard/src/api/client.ts packages/dashboard/src/api/client.test.ts packages/dashboard/tests/mockServer.ts packages/dashboard/src/components/Icon.tsx packages/dashboard/src/App.tsx packages/dashboard/src/App.test.tsx packages/dashboard/src/panels/ProjectsPanel.tsx
  git commit -m "$(cat <<'EOF'
  feat(dashboard): add projects/github ApiClient methods and Projects nav slot

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: `AddProjectDialog`

**Files:** `packages/dashboard/src/components/AddProjectDialog.tsx`, `packages/dashboard/src/components/AddProjectDialog.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.listGithubRepos`, `ApiClient.addProject`, `ConfirmSheet`'s visual/keyboard conventions (Escape to cancel, focus the primary button, `role="alertdialog"`/`aria-modal`).
- Produces:
  ```ts
  export function AddProjectDialog(props: {
    open: boolean
    onClose: () => void
    onAdded: (result: AddProjectResponse) => void
  }): JSX.Element
  ```

- [ ] **Step 1: failing tests**
  ```tsx
  // packages/dashboard/src/components/AddProjectDialog.test.tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen, waitFor } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch, fixtures } from '../../tests/mockServer'
  import { AddProjectDialog } from './AddProjectDialog'

  describe('AddProjectDialog', () => {
    it('lists repos, submits the selected one, and reports the result', async () => {
      installMockFetch()
      const onAdded = vi.fn()
      render(<AddProjectDialog open onClose={() => {}} onAdded={onAdded} />)

      expect(await screen.findByText('octo/widgets')).toBeInTheDocument()
      await userEvent.click(screen.getByText('octo/widgets'))
      await userEvent.click(screen.getByRole('button', { name: /add project/i }))

      await waitFor(() => expect(onAdded).toHaveBeenCalled())
      expect(onAdded.mock.calls[0][0].project.name).toBe('widgets')
    })

    it('shows the gh-unavailable hint instead of the repo list on 503', async () => {
      installMockFetch({
        'GET /api/github/repos': () =>
          new Response(JSON.stringify({ error: 'gh not available', hint: 'run gh auth login' }), { status: 503 }),
      })
      render(<AddProjectDialog open onClose={() => {}} onAdded={() => {}} />)
      expect(await screen.findByText(/run gh auth login/i)).toBeInTheDocument()
    })

    it('does not render when open is false', () => {
      installMockFetch()
      render(<AddProjectDialog open={false} onClose={() => {}} onAdded={() => {}} />)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
  ```
  (`installMockFetch`'s handler signature already supports returning a `Response` object directly for non-200 cases — see the existing `MockWebSocket`/`installMockFetch` pattern in `RunStream.test.tsx`-style tests; if the current `installMockFetch` only supports plain-object 200 handlers, extend it in this step to also accept a handler returning a `Response`, mirroring how `github.test.ts`'s server-side test built its 503 case.)
  Run: `pnpm --filter @agentos/dashboard test -- AddProjectDialog` — expected failure: cannot find module `./AddProjectDialog.js`.

- [ ] **Step 2: implement**
  ```tsx
  // packages/dashboard/src/components/AddProjectDialog.tsx
  import { useEffect, useState } from 'react'
  import type { AddProjectResponse, GithubRepo } from '@agentos/shared'
  import { ApiClient, ApiError } from '../api/client'
  import { useToast } from './Toast'

  const client = new ApiClient()

  export function AddProjectDialog({
    open,
    onClose,
    onAdded,
  }: {
    open: boolean
    onClose: () => void
    onAdded: (result: AddProjectResponse) => void
  }) {
    const [repos, setRepos] = useState<GithubRepo[] | null>(null)
    const [hint, setHint] = useState<string | null>(null)
    const [selected, setSelected] = useState<GithubRepo | null>(null)
    const [name, setName] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [build, setBuild] = useState(false)
    const [busy, setBusy] = useState(false)
    const { push } = useToast()

    useEffect(() => {
      if (!open) return
      setRepos(null)
      setHint(null)
      client
        .listGithubRepos()
        .then(setRepos)
        .catch((e) => {
          if (e instanceof ApiError && e.status === 503) {
            const body = e.body as { hint?: string } | undefined
            setHint(body?.hint ?? e.message)
          } else {
            setHint(e instanceof ApiError ? e.message : 'Failed to load repositories')
          }
        })
    }, [open])

    useEffect(() => {
      if (!selected) return
      setName(selected.nameWithOwner.split('/').pop() ?? '')
      setBaseBranch(selected.defaultBranch)
    }, [selected])

    if (!open) return null

    async function submit() {
      if (!selected) return
      setBusy(true)
      try {
        const result = await client.addProject({
          repo: selected.nameWithOwner,
          name: name || undefined,
          base_branch: baseBranch || undefined,
          build,
        })
        push(`Added ${result.project.name}`)
        onAdded(result)
        onClose()
      } catch (e) {
        push(e instanceof ApiError ? e.message : 'Failed to add project', 'error')
      } finally {
        setBusy(false)
      }
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Cancel"
          onClick={onClose}
          className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-[2px]"
        />
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Add project from GitHub"
          className="card relative w-full max-w-lg p-5 shadow-2xl"
        >
          <h3 className="mb-3 text-base font-medium text-text">Add project from GitHub</h3>

          {hint && (
            <div className="rounded border border-border bg-raised p-3 text-sm text-muted">{hint}</div>
          )}
          {!hint && repos === null && <div className="text-sm text-muted">Loading repositories…</div>}
          {!hint && repos !== null && (
            <div className="max-h-48 overflow-auto rounded border border-border">
              {repos.map((r) => (
                <button
                  key={r.nameWithOwner}
                  type="button"
                  onClick={() => setSelected(r)}
                  aria-current={selected?.nameWithOwner === r.nameWithOwner}
                  className={`block w-full border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 ${
                    selected?.nameWithOwner === r.nameWithOwner ? 'bg-raised' : 'hover:bg-raised/60'
                  }`}
                >
                  {r.nameWithOwner}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm text-muted">
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded border border-border bg-background px-2 py-1 text-text"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted">
                Base branch
                <input
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  className="rounded border border-border bg-background px-2 py-1 text-text"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={build} onChange={(e) => setBuild(e.target.checked)} />
                Let agent-os build features in this repo
              </label>
              {busy && <div className="text-xs text-muted">Cloning and syncing…</div>}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn btn-quiet">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !selected}
              className="btn btn-accent"
            >
              {busy ? 'Adding…' : 'Add project'}
            </button>
          </div>
        </div>
      </div>
    )
  }
  ```
  If `installMockFetch` needs extending to pass a `Response` straight through (Step 1's note), add in `tests/mockServer.ts`:
  ```ts
  const body = handler(url, init)
  if (body instanceof Response) return body
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  ```
  Run: `pnpm --filter @agentos/dashboard test -- AddProjectDialog` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/dashboard/src/components/AddProjectDialog.tsx packages/dashboard/src/components/AddProjectDialog.test.tsx packages/dashboard/tests/mockServer.ts
  git commit -m "$(cat <<'EOF'
  feat(dashboard): add the Add-from-GitHub dialog with the gh-unavailable hint path

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 11: `ProjectsPanel`

**Files:** `packages/dashboard/src/panels/ProjectsPanel.tsx` (replaces Task 9's stub), `packages/dashboard/src/panels/ProjectsPanel.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.listProjects`, `ApiClient.removeProject`, `ApiClient.listDecisions` (existing), `AddProjectDialog` (Task 10), `ConfirmSheet` (existing, for remove confirmation), `SkeletonRows`/`EmptyState`/`ErrorState`/`StatusBadge`/`relativeTime` (existing conventions).
- Produces: `export function ProjectsPanel(): JSX.Element`.

- [ ] **Step 1: failing tests**
  ```tsx
  // packages/dashboard/src/panels/ProjectsPanel.test.tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen, waitFor } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch, fixtures } from '../../tests/mockServer'
  import { ProjectsPanel } from './ProjectsPanel'

  describe('ProjectsPanel', () => {
    it('lists projects with adapter, base branch, and hasCooLayout copy for a fresh sync', async () => {
      installMockFetch({
        'GET /api/projects': () => [
          { ...fixtures.projectListItem, hasCooLayout: false },
        ],
      })
      render(<ProjectsPanel />)
      expect(await screen.findByText('techpulse')).toBeInTheDocument()
      expect(screen.getByText(/no proposals folder yet/i)).toBeInTheDocument()
    })

    it('shows empty state with no projects', async () => {
      installMockFetch({ 'GET /api/projects': () => [] })
      render(<ProjectsPanel />)
      expect(await screen.findByText(/no projects/i)).toBeInTheDocument()
    })

    it('opens the Add from GitHub dialog', async () => {
      installMockFetch({ 'GET /api/projects': () => [] })
      render(<ProjectsPanel />)
      await userEvent.click(await screen.findByRole('button', { name: /add from github/i }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    })

    it('removes a project after confirmation', async () => {
      installMockFetch()
      render(<ProjectsPanel />)
      await userEvent.click(await screen.findByRole('button', { name: /remove/i }))
      await userEvent.click(await screen.findByRole('button', { name: /confirm/i }))
      await waitFor(() =>
        expect(screen.queryByText(fixtures.projectListItem.config.name)).not.toBeInTheDocument(),
      )
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test -- ProjectsPanel` — expected failure: stub renders only the bare heading, none of the above.

- [ ] **Step 2: implement**
  ```tsx
  // packages/dashboard/src/panels/ProjectsPanel.tsx
  import type { Decision, ProjectListItem } from '@agentos/shared'
  import { useCallback, useEffect, useState } from 'react'
  import { ApiClient, ApiError } from '../api/client'
  import { AddProjectDialog } from '../components/AddProjectDialog'
  import { ConfirmSheet } from '../components/ConfirmSheet'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'
  import { Icon } from '../components/Icon'
  import { SkeletonRows } from '../components/Skeleton'
  import { StatusBadge } from '../components/StatusBadge'
  import { useToast } from '../components/Toast'
  import { relativeTime } from '../lib/time'

  const client = new ApiClient()

  export function ProjectsPanel() {
    const [items, setItems] = useState<ProjectListItem[] | null>(null)
    const [pendingByProject, setPendingByProject] = useState<Record<string, number>>({})
    const [error, setError] = useState<string | null>(null)
    const [addOpen, setAddOpen] = useState(false)
    const [removeTarget, setRemoveTarget] = useState<string | null>(null)
    const [removing, setRemoving] = useState(false)
    const { push } = useToast()

    const load = useCallback(() => {
      setError(null)
      Promise.all([client.listProjects(), client.listDecisions('pending')])
        .then(([projects, decisions]: [ProjectListItem[], Decision[]]) => {
          setItems(projects)
          const counts: Record<string, number> = {}
          for (const d of decisions) {
            if (d.project) counts[d.project] = (counts[d.project] ?? 0) + 1
          }
          setPendingByProject(counts)
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load projects'))
    }, [])

    useEffect(() => {
      load()
    }, [load])

    async function confirmRemove() {
      if (!removeTarget) return
      setRemoving(true)
      try {
        await client.removeProject(removeTarget)
        push(`Removed ${removeTarget}`)
        setRemoveTarget(null)
        load()
      } catch (e) {
        push(e instanceof ApiError ? e.message : 'Failed to remove project', 'error')
      } finally {
        setRemoving(false)
      }
    }

    return (
      <section>
        <div className="mb-4 flex items-end justify-between border-b border-border">
          <h2 className="pb-1.5 text-lg font-medium">Projects</h2>
          <button type="button" onClick={() => setAddOpen(true)} className="btn btn-accent btn-sm">
            <Icon name="projects" size={12} />
            Add from GitHub
          </button>
        </div>

        {error && <ErrorState message={error} onRetry={load} />}
        {!error && items === null && <SkeletonRows rows={3} label="Loading projects…" />}
        {!error && items !== null && items.length === 0 && (
          <EmptyState
            title="No projects yet"
            body="Add a repository from GitHub to start syncing it."
          />
        )}
        {!error && items !== null && items.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-normal">Project</th>
                <th className="font-normal">Adapter</th>
                <th className="font-normal">Base branch</th>
                <th className="font-normal">Last sync</th>
                <th className="font-normal">Pending</th>
                <th className="font-normal">Build</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map(({ config, lastSync, hasCooLayout }) => (
                <tr key={config.name} className="border-t border-border/60">
                  <td className="py-2.5 font-mono text-text">{config.name}</td>
                  <td className="text-muted">{config.adapter}</td>
                  <td className="text-muted">{config.base_branch}</td>
                  <td>
                    {lastSync ? (
                      <span className="inline-flex items-center gap-2">
                        <StatusBadge status={lastSync.status} />
                        <span className="text-xs text-muted">{relativeTime(lastSync.startedAt)}</span>
                      </span>
                    ) : (
                      <span className="text-muted">never</span>
                    )}
                  </td>
                  <td className="text-muted">{pendingByProject[config.name] ?? 0}</td>
                  <td className="text-muted">{config.build?.enabled ? 'on' : 'off'}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await client.request?.('POST', `/api/projects/${config.name}/sync`)
                          } catch {
                            // sync failures surface on next load() via lastSync.status
                          }
                          load()
                        }}
                        className="btn btn-quiet btn-sm"
                      >
                        Sync now
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(config.name)}
                        className="btn btn-quiet btn-sm"
                      >
                        Remove
                      </button>
                    </div>
                    {!hasCooLayout && (
                      <div className="mt-1 text-[11px] text-muted">
                        No proposals folder yet; the first feature request will create it.
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <AddProjectDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => load()} />
        <ConfirmSheet
          open={removeTarget !== null}
          title={`Remove ${removeTarget}?`}
          confirmLabel="Confirm removal"
          tone="danger"
          busy={removing}
          onConfirm={confirmRemove}
          onCancel={() => setRemoveTarget(null)}
        >
          The project's config and sync routine are removed. Its local clone and wiki mirror stay in
          place.
        </ConfirmSheet>
      </section>
    )
  }
  ```
  `ApiClient` has no public `request` method (`req` is private) — replace the "Sync now" button's body with a proper client method added in this step:
  ```ts
  // packages/dashboard/src/api/client.ts — add alongside the other project methods
  syncProject(name: string) {
    return this.req<{ added: string[]; changed: string[]; events: string[] }>('POST', `/api/projects/${name}/sync`)
  }
  ```
  and use `client.syncProject(config.name)` instead of the `client.request?.(...)` placeholder above (the placeholder is not valid code — do not commit it; it is shown only to mark where the real call goes).
  Run: `pnpm --filter @agentos/dashboard test -- ProjectsPanel` — expected: PASS. Then `pnpm --filter @agentos/dashboard test` (full suite) — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/dashboard/src/panels/ProjectsPanel.tsx packages/dashboard/src/panels/ProjectsPanel.test.tsx packages/dashboard/src/api/client.ts packages/dashboard/src/api/client.test.ts
  git commit -m "$(cat <<'EOF'
  feat(dashboard): implement ProjectsPanel with Add/Remove/Sync and the no-COO-layout copy

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 12: CLI `agentos projects` command

**Files:** `packages/cli/src/client.ts` (modify), `packages/cli/src/commands/projects.ts`, `packages/cli/src/commands/projects.test.ts`, `packages/cli/src/bin.ts` (modify)

**Interfaces:**
- Consumes: `ApiClient` (cli) additions.
- Produces:
  ```ts
  // packages/cli/src/client.ts additions
  listProjects(): Promise<ProjectListItem[]>
  addProject(input: { repo: string; name?: string; adapter?: string; base_branch?: string; build?: boolean }): Promise<AddProjectResponse>
  // packages/cli/src/commands/projects.ts
  export function registerProjectsCommand(program: Command, client: ApiClient): void
  ```
  CLI surface: `agentos projects list`, `agentos projects add owner/name [--name n] [--base-branch b] [--build]`.

- [ ] **Step 1: failing test**
  ```ts
  // packages/cli/src/commands/projects.test.ts
  import { Command } from 'commander'
  import { describe, it, expect, vi } from 'vitest'
  import { registerProjectsCommand } from './projects.js'
  import type { ApiClient } from '../client.js'

  function makeClient() {
    return {
      listProjects: vi.fn(async () => [
        { config: { name: 'widgets', adapter: 'techpulse-coo', repo: 'octo/widgets', clone: '/c/widgets', base_branch: 'main', options: {} }, routines: ['widgets-sync'], hasCooLayout: true },
      ]),
      addProject: vi.fn(async (input) => ({
        project: { name: input.name ?? 'widgets', adapter: 'techpulse-coo', repo: input.repo, clone: '/c/widgets', base_branch: 'main', options: {} },
        sync: { added: [], changed: [], events: [] },
      })),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural ApiClient stub
    } as any as ApiClient
  }

  describe('agentos projects', () => {
    it('list prints registered projects', async () => {
      const client = makeClient()
      const program = new Command()
      registerProjectsCommand(program, client)
      const logs: string[] = []
      vi.spyOn(console, 'log').mockImplementation((s: string) => logs.push(s))

      await program.parseAsync(['node', 'agentos', 'projects', 'list'])

      expect(client.listProjects).toHaveBeenCalled()
      expect(logs.join('\n')).toContain('widgets')
    })

    it('add calls addProject with the parsed flags', async () => {
      const client = makeClient()
      const program = new Command()
      registerProjectsCommand(program, client)
      vi.spyOn(console, 'log').mockImplementation(() => {})

      await program.parseAsync(['node', 'agentos', 'projects', 'add', 'octo/widgets', '--name', 'w', '--base-branch', 'dev', '--build'])

      expect(client.addProject).toHaveBeenCalledWith({
        repo: 'octo/widgets', name: 'w', base_branch: 'dev', build: true,
      })
    })

    it('add without --build omits build from the request', async () => {
      const client = makeClient()
      const program = new Command()
      registerProjectsCommand(program, client)
      vi.spyOn(console, 'log').mockImplementation(() => {})

      await program.parseAsync(['node', 'agentos', 'projects', 'add', 'octo/widgets'])

      expect(client.addProject).toHaveBeenCalledWith({ repo: 'octo/widgets', name: undefined, base_branch: undefined, build: false })
    })
  })
  ```
  Run: `pnpm --filter @agentos/cli test -- commands/projects` — expected failure: cannot find module `./projects.js`.

- [ ] **Step 2: implement**
  ```ts
  // packages/cli/src/client.ts — additions
  import type { AddProjectResponse, ProjectListItem } from '@agentos/shared'
  // ... inside class ApiClient
  listProjects(): Promise<ProjectListItem[]> {
    return this.request('/api/projects')
  }
  addProject(input: { repo: string; name?: string; adapter?: string; base_branch?: string; build?: boolean }): Promise<AddProjectResponse> {
    return this.request('/api/projects', { method: 'POST', body: JSON.stringify(input) })
  }
  ```
  ```ts
  // packages/cli/src/commands/projects.ts
  import type { Command } from 'commander'
  import type { ApiClient } from '../client.js'

  export function registerProjectsCommand(program: Command, client: ApiClient): void {
    const projects = program.command('projects').description('manage agent-os projects')

    projects
      .command('list')
      .description('list registered projects')
      .action(async () => {
        const items = await client.listProjects()
        for (const { config, routines, lastSync, hasCooLayout } of items) {
          console.log(
            `${config.name}  adapter=${config.adapter}  base=${config.base_branch}  routines=${routines.join(',') || 'none'}  lastSync=${lastSync?.status ?? 'never'}  hasCooLayout=${hasCooLayout}`,
          )
        }
      })

    projects
      .command('add <repo>')
      .description('register a GitHub repo as a project')
      .option('--name <name>', 'project name (defaults to the repo name)')
      .option('--base-branch <branch>', 'base branch (defaults to the repo default branch)')
      .option('--build', 'allow agent-os to build features in this repo', false)
      .action(async (repo: string, opts: { name?: string; baseBranch?: string; build?: boolean }) => {
        const result = await client.addProject({
          repo,
          name: opts.name,
          base_branch: opts.baseBranch,
          build: opts.build ?? false,
        })
        console.log(
          `added ${result.project.name} (${result.project.repo}) -- sync: added ${result.sync.added.length}, changed ${result.sync.changed.length}${result.syncError ? `, error: ${result.syncError}` : ''}`,
        )
      })
  }
  ```
  ```ts
  // packages/cli/src/bin.ts — add import and registration call
  import { registerProjectsCommand } from './commands/projects.js'
  // ... alongside the other register* calls
  registerProjectsCommand(program, client())
  ```
  Run: `pnpm --filter @agentos/cli test -- commands/projects` — expected: PASS. Then `pnpm --filter @agentos/cli test` (full suite) — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/cli/src/client.ts packages/cli/src/commands/projects.ts packages/cli/src/commands/projects.test.ts packages/cli/src/bin.ts
  git commit -m "$(cat <<'EOF'
  feat(cli): add agentos projects list/add

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 13: e2e coverage + `docs/SECURITY.md` + Self-Review

**Files:** `packages/dashboard/e2e/projects.spec.ts`, `docs/SECURITY.md` (modify)

**Interfaces:** none new — this task closes out spec §9's dashboard e2e line for W2 ("e2e adds a project from a fake gh") and spec §8's `gh` documentation obligation.

- [ ] **Step 1: write the e2e spec** (no "failing test" TDD cycle applies to e2e per the M5 precedent — it's written once the underlying pages exist and run against the built dashboard + kernel)
  ```ts
  // packages/dashboard/e2e/projects.spec.ts
  import { expect, test } from '@playwright/test'

  test('adds a project from a fake gh repo list and shows the no-COO-layout copy', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

    await page.getByRole('button', { name: /add from github/i }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByText('octo/widgets').click()
    await page.getByRole('button', { name: /add project/i }).click()

    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByText('widgets')).toBeVisible()
    await expect(page.getByText(/no proposals folder yet/i)).toBeVisible()
  })
  ```
  This requires the Playwright `webServer` (already configured in `packages/dashboard/playwright.config.ts` per the M5 plan) to boot the kernel with `AGENTOS_GH_BIN` pointed at `tools/fake-gh/bin.js` and `FAKE_GH_REPOS_FIXTURE`/`FAKE_GH_DEFAULT_BRANCH` set, and with a `registry` that includes a stub or real `techpulse-coo` adapter pointed at a seeded bare repo with no `docs/missions/coo/proposals` dir (so `hasCooLayout: false` is genuine, not mocked) — check `playwright.config.ts` and whatever `os/` fixture directory it already points the kernel `webServer` at (per M5's e2e task) and extend that fixture's env block; add the new env vars there rather than duplicating a second `webServer` block.
  Run: `pnpm --filter @agentos/dashboard e2e -- projects` — expected: PASS once wired into the existing e2e kernel fixture's env.

- [ ] **Step 2: `docs/SECURITY.md` — new paragraph**
  ```md
  ## The `gh` CLI
  Everything agent-os knows about GitHub — the operator's repo list, a
  project's default branch, and the presence of `package.json`/
  `pyproject.toml`/`Makefile` used to infer build checks — comes from
  shelling out to the operator's own `gh` CLI (`packages/kernel/src/github/gh.ts`),
  never from a stored token. Every call goes through `execa(bin, [...args])`
  with an argument array — never a shell string — and every repo name is
  checked against `^[\w.-]+\/[\w.-]+$` (`assertValidRepoName`) before it is
  used in an argv element or a filesystem path segment. `gh`'s own local
  login (`gh auth login`, outside agent-os entirely) is the only credential
  involved; if it isn't present, `GET /api/github/repos` and `POST
  /api/projects` return `503 { error: 'gh not available', hint }` rather
  than failing partway through. Tests and CI never touch the real `gh`
  binary — `AGENTOS_GH_BIN` points them at `tools/fake-gh/bin.js`, a
  fixture-driven stand-in with the same shape as `tools/fake-claude`.
  ```
  Insert this as a new `##` section, placed after "## Where secrets live" and before "## Local secret scanning" (it belongs next to the other secrets-related material, not at the end after the approval-boundary section).

- [ ] **Step 3: commit**
  ```
  git add packages/dashboard/e2e/projects.spec.ts docs/SECURITY.md
  git commit -m "$(cat <<'EOF'
  test(dashboard): add e2e coverage for adding a GitHub project via fake gh

  docs(security): document the gh CLI boundary

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Self-Review

**Spec §4 coverage:**
- §4.1 Access / 503 path: Task 3 (`checkGhAvailable`, `GhUnavailableError`), Task 4 (`GET /api/github/repos` 503), Task 6/8 (`POST /api/projects` 503 via `getDefaultBranch`/`readRepoFile`), Task 10 (dialog renders the hint instead of the repo list). ✅
- §4.2 API shapes (`GET /api/github/repos`, `GET/POST/DELETE /api/projects`): Tasks 4, 6–8, matching the exact request/response shapes in the Contract additions section, including the `name` derivation rule, `clone` always `${AGENTOS_CLONES}/<name>`, and `base_branch` defaulting from `gh`. ✅
- §4.3 First sync with no COO layout: `SyncResult.hasCooLayout` (Task 1) threads through `addProject`'s response (Task 6) and `listProjects`'s live fs check (Task 7) to the Projects panel's exact copy, "No proposals folder yet; the first feature request will create it." (Task 11). The `docs/missions/coo/{proposals,reports}/.gitkeep` bootstrap-on-first-proposal itself is explicitly W3 scope (spec §4.3's last sentence, `write-proposal` step) — correctly out of this plan. ✅
- §4.4 Build permission block: `ProjectBuildConfig` type (Task 1), inferred `checks` from `package.json`/`pyproject.toml`/`Makefile` via `gh api .../contents/...` (Task 6), the dialog's "Let agent-os build features in this repo" switch (Task 10). ✅
- DELETE keeps clone and raw/: explicit test assertion in Task 7. ✅
- Name collision → 409, invalid repo name → 400, gh unavailable → 503, clone failure keeps the yaml and returns the error (`syncError`): Tasks 6 and 8, matching spec §8 exactly (including the one documented, additive deviation from the assigning message's literal return-type signature, called out in "Reconciliation note"). ✅

**§6 dashboard, §7 CLI:** Projects panel with Add-from-GitHub dialog (searchable list, name, base branch, build switch, a progress line during first sync) — Tasks 10–11; nav slot 8, inserted so the concurrent Messages-panel PR's diff still applies cleanly — Task 9. `agentos projects list`/`add` — Task 12 (the spec's other CLI lines, `request`/`workflows`, are W1/W3 scope, correctly excluded).

**Placeholders:** none left in committed code. The two places with inline commentary about *not* committing something as-written — the dead `args`/`if (query)` lines sketched mid-explanation in Task 3 Step 2, and the invalid `client.request?.(...)` call sketched in Task 11 Step 2 — are both explicitly flagged in their own step text as "do not commit this; here is the real call," with the real call given immediately after. Every other code block is meant to be typed and run verbatim.

**Type consistency:** `SyncResult` (kernel-owned, contract §5) gains `hasCooLayout?` in Task 1 and is never redefined elsewhere. `ProjectListItem`/`AddProjectRequest`/`AddProjectResponse`/`GithubRepo` are shared-owned wire types; `SyncResultShape` in shared is a deliberate, precedented structural twin of kernel's `SyncResult` (matching the existing `RoutineListItem` duplication between `dashboard/src/api/client.ts` and `cli/src/client.ts`), not an accidental second source of truth. `ProjectService.addProject`'s actual return type (`AddProjectResult = { project; sync; syncError? }`) is a superset of the assigning message's literal ask and is called out as such rather than silently diverging.

**Fixes applied during self-review:** the initial draft of Task 3's `listRepos` had a dead first `execa` call sketched while reasoning through the `--query` flag name — left in Step 2 as explicit "delete this" commentary rather than silently cleaned up, since removing it would hide the reasoning an implementer needs to avoid reintroducing the same mistake with a wrong flag name.
