# Feature requests, GitHub projects, and a durable workflow engine

Status: approved design, 2026-09-09. Builds on `2026-09-08-agent-os-design.md`.

## 1. Goal

Three things the operator can do from the dashboard that they cannot today:

1. **Add a project from GitHub.** Pick one of their repositories and have
   agent-os register it, clone it, and start syncing it, without editing
   YAML or storing a token.
2. **Request a feature.** Pick a project, describe the feature in plain
   words, and have agent-os turn that into a proposal in the project's repo
   and then build it: proposal, branch, implementation, validation, review,
   pull request.
3. **Watch it happen.** A live view of that request as it moves through
   its steps, with the agent's output streaming inline, elapsed time and
   cost, and the ability to pause or stop it.

Underneath all three is one new kernel subsystem: a **durable workflow
engine**. A feature request is one workflow instance. Future work (project
bootstrap, scheduled multi-step jobs) reuses the same engine.

## 2. Influences

Two Cloudflare primitives shaped the engine. Both are mirrored into the
private instance under `raw/reference/` so the librarian keeps them in the
wiki.

- **Workflows** (developers.cloudflare.com/workflows). A workflow is a
  durable multi-step program; an *instance* is one execution. Steps are
  the unit of durability: `step.do()` runs a retriable unit of work whose
  result is persisted, `step.sleep()` parks the instance for a duration,
  `step.waitForEvent()` parks it until an external event arrives or a
  timeout passes. Instances can be triggered, paused, resumed, terminated,
  and their status observed. We borrow the step model, the persisted
  step results, retry-per-step, wait-for-event, and the lifecycle verbs.
- **Durable Objects** (developers.cloudflare.com/durable-objects). One
  named object per entity; every request to it is serialized through that
  object; it owns transactional storage co-located with its compute;
  alarms wake it in the future; it fans out live updates over WebSockets.
  We borrow the per-instance serialization (one instance never runs two
  steps at once), the per-instance state row, alarms (timeouts and
  sleeps stored as `wake_at`), and websocket fan-out (the event log
  already does this).

What we deliberately do not borrow: distribution. agent-os is one
daemon and one SQLite file; the engine is an in-process scheduler over
rows, not a cluster.

## 3. Workflow engine (`packages/kernel/src/workflow/`)

### 3.1 Data model (new tables in `schema.sql`, additive migration)

```
workflows
  id TEXT PK            nanoid
  kind TEXT             'feature-request' | future kinds
  status TEXT           queued | running | waiting | sleeping | paused
                        | succeeded | failed | terminated
  project TEXT          project name, nullable
  title TEXT
  input TEXT            JSON, immutable after creation
  state TEXT            JSON, the instance's working memory
  current_step TEXT     step name currently executing/waiting, nullable
  wake_at TEXT          ISO time for sleep/timeout, nullable
  wait_event TEXT       event type being waited on, nullable
  error TEXT
  created_at, started_at, ended_at, updated_at TEXT

workflow_steps
  id TEXT PK
  workflow_id TEXT FK
  name TEXT             stable step name
  seq INTEGER           1-based order within the instance
  status TEXT           running | succeeded | failed | skipped | waiting | sleeping
  attempt INTEGER       1..max
  run_id TEXT           the kernel Run this step spawned, nullable
  output TEXT           JSON result persisted on success
  error TEXT
  started_at, ended_at TEXT
```

`workflows.state` is the only mutable memory a definition has. Step
outputs are also written into `state` under the step's name so a resumed
instance sees them.

### 3.2 Definitions

A workflow definition is TypeScript, registered by kind:

```ts
interface WorkflowDefinition<I> {
  kind: string
  run(ctx: WorkflowContext<I>): Promise<void>
}
interface WorkflowContext<I> {
  input: I
  state: Record<string, unknown>
  step: {
    do<T>(name: string, opts: StepOptions, fn: () => Promise<T>): Promise<T>
    sleep(name: string, ms: number): Promise<void>
    waitForEvent<T>(name: string, eventType: EventType, opts: {
      match?: (e: Event) => boolean; timeoutMs: number
    }): Promise<T>
    run(name: string, spec: StepRunSpec): Promise<RunResult>  // spawn a claude -p run as a step
  }
  emit(type: EventType, payload: Record<string, unknown>): void
}
interface StepOptions { retries?: number; backoffMs?: number; timeoutMs?: number }
```

`step.run` is the agent-os-specific primitive: it starts a kernel `Run`
(through the existing `ProcessManager.runToCompletion`) with the step's
`SpawnSpec`, records `run_id` on the step row, and resolves with the run's
result. The dashboard follows `run_id` to stream the step's output.

### 3.3 Execution semantics

- **Replay, not resume.** Like Cloudflare, `run()` is re-invoked from the
  top whenever the instance is (re)scheduled. Each `step.*` call looks up
  its step row by name: if it already succeeded, its persisted output is
  returned immediately without executing; if it is the current step, it
  executes. This is what makes daemon restarts safe: on boot the engine
  reloads every instance in `running | waiting | sleeping` and replays it.
- **One step at a time per instance.** An in-process mutex per workflow id
  (the Durable Object property). Different instances run concurrently, up
  to `workflows.max_concurrent` from `routines.yaml` defaults (default 2).
- **Retries per step.** `step.do` retries up to `retries` (default 2)
  with exponential backoff from `backoffMs` (default 10s), recording each
  attempt on the step row. A step that exhausts retries fails the
  instance.
- **Wait-for-event.** The step row goes `waiting`, the instance goes
  `waiting`, `wait_event` and `wake_at` are set. The engine subscribes
  to the event log; the first matching event (by type and `match`)
  stores its payload as the step output and reschedules the instance.
  If `wake_at` passes first, the step fails with `timeout`.
- **Sleep.** Instance goes `sleeping` with `wake_at`; a single engine
  timer (the "alarm") wakes due instances every 5s.
- **Pause / resume / terminate.** Pause sets `paused`; the current step
  finishes (a running claude process is not interrupted) and no further
  step starts. Resume replays. Terminate kills the current step's run if
  any, marks remaining work `terminated`, and emits the final event.
- **Events.** `workflow.created`, `workflow.step.started`,
  `workflow.step.succeeded`, `workflow.step.failed`, `workflow.waiting`,
  `workflow.resumed`, `workflow.paused`, `workflow.succeeded`,
  `workflow.failed`, `workflow.terminated`; every payload carries
  `workflowId`, `kind`, `project`, `step`, `seq`. `EventType` in shared
  gains a `workflow.${string}` template member.

### 3.4 API

```
GET    /api/workflows?status=&project=&kind=       list
GET    /api/workflows/:id                          instance + steps
POST   /api/workflows                              { kind, project?, input } -> 202 { workflowId }
POST   /api/workflows/:id/pause
POST   /api/workflows/:id/resume
POST   /api/workflows/:id/terminate
POST   /api/workflows/:id/events                   { type, payload } deliver an external event to a waiting instance (dashboard "Approve" for waitForEvent steps)
```

## 4. Projects from GitHub

### 4.1 Access

The kernel shells out to the operator's `gh` CLI (`gh repo list`,
`gh api`), never to a stored token. If `gh` is missing or not logged in,
`GET /api/github/repos` returns `503 { error: 'gh not available', hint }`
and the dashboard shows that hint instead of a list. `gh` is invoked
through `execa` with an argument array, never a shell string; the repo
name is validated against `^[\w.-]+/[\w.-]+$` before any use.

### 4.2 API

```
GET  /api/github/repos?query=            [{ nameWithOwner, description, defaultBranch, isPrivate, updatedAt }] (gh repo list --limit 100)
GET  /api/projects                       [{ config, registered routines, lastSync, hasCooLayout }]
POST /api/projects                       { repo: 'owner/name', name?, adapter?: 'techpulse-coo', base_branch? } -> 201 project
       writes os/projects/<name>.yaml, appends `<name>-sync` (every: 1h, adapter: <name>) to os/routines.yaml if absent,
       hot-registers the routine in the Scheduler (no daemon restart), runs the first sync, returns SyncResult.
DELETE /api/projects/:name               removes the yaml and its sync routine; keeps the clone and raw/ mirror.
```

`name` defaults to the repo name, lower-cased, non `[a-z0-9-]` replaced by
`-`, and must be unique. `clone` is always `${AGENTOS_CLONES}/<name>`.
`base_branch` defaults to the repo's default branch as reported by `gh`.

### 4.3 First sync on a repo with no COO layout

The adapter's `sync` returns `hasCooLayout: false` when
`docs/missions/coo/proposals` is absent. The project still registers; the
Projects panel shows "No proposals folder yet; the first feature request
will create it." The feature-request workflow's `write-proposal` step
creates `docs/missions/coo/{proposals,reports}/.gitkeep` and `state.md`
if missing, in the same commit as the proposal.

### 4.4 Build permission

Building runs `claude -p` inside the project's clone with edit and shell
tools. That is a bigger grant than any existing routine has, so it is
explicit and per project, in the project yaml:

```yaml
build:
  enabled: true
  model: sonnet
  permission_mode: acceptEdits
  allowed_tools: [Bash, Read, Write, Edit, Glob, Grep]
  checks:                       # what the validate step must run and pass
    - pnpm -r --if-present typecheck
    - pnpm lint
    - pnpm -r --if-present test
  timeout_ms: 2400000
```

Without a `build:` block the workflow stops after approval (`succeeded`
with only brief / push-proposal / await-approval steps) and the project's
own COO routine builds the approved proposal on its next run; the Requests
view says so. With one, the workflow first flips the proposal's frontmatter
to `status: building` (`mark-building`) so a concurrently firing COO
routine, which only takes `approved` proposals, never builds the same
feature twice; a failed pipeline hands it back as `approved`
(`unmark-building`), a shipped one ends as `shipped`.

The Add-project dialog has a "Let agent-os build features in this repo"
switch that writes this block with sensible defaults (checks inferred
from the repo: package.json scripts, pyproject, Makefile). Without it a
feature request stops after `push-proposal` with status `waiting` on
`decision.resolved`, i.e. the existing approve-then-cloud-COO path.

## 5. Feature requests

### 5.1 Input

```ts
interface FeatureRequestInput {
  project: string
  title: string          // short, becomes the proposal H1 and branch slug
  description: string    // the operator's own words, any length
  autoApprove: boolean   // default true: the operator wrote it, so it is approved
}
```

### 5.2 Workflow `feature-request`

| seq | step | kind | what it does |
|---|---|---|---|
| 1 | `brief` | `step.run` (skill `feature-brief`, agent `ops`, plan mode, no file tools) | Reads the project's wiki overview and the description, writes the full proposal markdown (What you get, Why start this now, Problem, Proposed solution, Effort, Validation contract, Risks) via `mcp__agentos__remember` to `requests/<id>/proposal.md`. Output: proposal path, slug, next NNN. |
| 2 | `push-proposal` | `step.do` | Adapter commits `docs/missions/coo/proposals/NNN-slug.md` with `status: approved` (or `proposed` when `autoApprove` is false), bootstrapping the COO layout if missing; pushes to `base_branch`; syncs so the Decision row exists (already approved). Output: commit sha, file. |
| 3 | `await-approval` | `step.waitForEvent('decision.resolved')` | Only when `autoApprove` is false. Timeout 7 days. |
| 4 | `build` | `step.run` (skill `feature-build`, cwd = clone, project `build` grants) | Creates branch `req/<slug>`, implements per the validation contract, commits as it goes. Output: branch, head sha, files changed. |
| 5 | `validate` | `step.run` (skill `feature-validate`, same cwd, Bash only) | Runs every `build.checks` command; must actually run them; output: pass/fail per check with tails of failing output. Fails the step if any check fails; the engine retries `build` once with the failure output injected (a `fix` sub-attempt), then fails the instance. |
| 6 | `review` | `step.run` (skill `feature-review`, plan mode, read-only) | Product/professional-feel review against the proposal; output: pass/fail with reasons. Fail follows the same one-retry path as validate. |
| 7 | `open-pr` | `step.do` | Pushes the branch, opens a PR via `gh pr create` (then a **CI gate**: `ci-*` steps poll the PR checks until none is pending; a red CI triggers one `build-fix-ci` + `push-fix` cycle; a second red fails the request; `ship` marks shipped only after green) with the proposal's What/Why and the validation and review outputs as the body; flips the proposal to `status: shipped` on `base_branch`; writes `reports/<slug>.md`. Output: PR URL. |
| 8 | `done` | `step.do` | Writes `requests/<id>/summary.md`, `remember`s a wiki page `projects/<project>/requests/<slug>.md`, emits `workflow.succeeded`. |

Skills live in the template under `os/skills/feature-{brief,build,validate,review}/skill.md` with the same `learnings.md`/`eval.json` layout as existing skills. `feature-build` and `feature-validate` are the first skills that run outside `agents/<name>/workspace`; the kernel allows this only when the spawning workflow's project has `build.enabled: true`, and it passes `--add-dir <clone>` plus the OS root, nothing else.

### 5.3 Containment

- The build run gets exactly the tools in `build.allowed_tools`, `--strict-mcp-config`, and the per-run syscall token like every other run.
- It runs in the clone, on a branch; the workflow never pushes to `base_branch` except the proposal and report commits in `push-proposal` and `open-pr`, which the adapter makes, not the agent.
- `remember` still refuses `raw/` writes and scans for secrets; the PR body is scanned with `findSecrets` before `gh pr create`.
- A terminated or failed instance leaves the branch in place for a human; nothing is force-pushed or deleted.

## 6. Dashboard

- **Projects panel** (new, nav slot 8): list of projects with adapter,
  base branch, last sync, pending decisions, build enabled; **Add from
  GitHub** opens a dialog: searchable repo list from `gh`, name, base
  branch, build switch; submit registers and runs the first sync with a
  progress line.
- **Requests panel** (new, nav slot 9): **New request** form (project
  select, title, description, auto-approve switch) and the list of
  instances with status, project, elapsed, cost. Selecting one opens the
  **RequestView**: a vertical stepper (one row per step: status dot,
  name, attempt, duration, cost) with the active step expanded to show
  its `RunStream` inline, plus Pause / Resume / Terminate. Everything
  updates from `workflow.*` events over the existing websocket; no
  polling.
- **Overview** gains a "Requests in flight" stat and feed lines for
  `workflow.*` events (kind `run`).

## 7. CLI

```
agentos projects list
agentos projects add owner/name [--name n] [--base-branch b] [--build]
agentos request <project> "<title>" [--description "..." | --file f.md] [--no-auto-approve]
agentos workflows [list|show <id>|pause|resume|terminate <id>]
```

## 8. Error handling

- `gh` absent or logged out: 503 with a hint; the UI explains what to install or run.
- Project name collision: 409.
- Clone failure on add: the project yaml is still written; the error is returned and the Projects panel shows "clone failed, retry sync".
- Any step failure after retries: instance `failed` with the step's error; the RequestView shows the failing step expanded with its run output and a **Retry from this step** button (`POST /resume` after the operator fixes something).
- Daemon restart mid-build: the step's run is marked `killed` by the existing process-manager recovery; the engine replays, sees the step incomplete, and re-runs it (the skill is told the branch already exists and reads its commits first).

## 9. Testing

- Engine unit tests with a fake definition: replay returns persisted outputs; retries and backoff; waitForEvent match and timeout; sleep and alarm; pause blocks the next step; terminate kills the current run; restart-resume from every status.
- Feature-request definition test with a stub `step.run` and a temp bare repo (reuse `createTempTechpulseRepo`): proposal committed with the right frontmatter, branch created, PR body built, `shipped` flipped, report written; the no-build path parks on `await-approval`.
- GitHub routes with `gh` stubbed by an env override (`AGENTOS_GH_BIN`) pointing at a fake script: repo list, 503 path, name validation.
- Dashboard: Projects and Requests panels against the mock server; RequestView stepper reacts to `workflow.*` events from the mock socket; e2e adds a project from a fake `gh` and submits a request that runs the fake-claude kernel end to end.
- Guard tests unchanged: no absolute paths, no secrets.

## 10. Milestones

- **W1 workflow engine**: tables, migration, engine, API, events, CLI `workflows`, tests. No UI.
- **W2 GitHub projects**: `gh` service, projects API, hot routine registration, Projects panel, CLI `projects`.
- **W3 feature-request workflow**: the four skills in the template, the definition, adapter helpers (bootstrap layout, push proposal, open PR, flip shipped), CLI `request`.
- **W4 Requests panel**: form, list, RequestView stepper with live stream, Overview stat, e2e.

W1 and W2 are independent and can be built in parallel; W3 needs W1; W4 needs W1 and W3.

## 11. Deferred

- Webhooks from GitHub into `waitForEvent` (PR merged, CI status).
- Multiple builders per instance (parallel steps).
- Cross-daemon workflows; anything distributed.
- A generic YAML workflow DSL; definitions stay in TypeScript for now.
