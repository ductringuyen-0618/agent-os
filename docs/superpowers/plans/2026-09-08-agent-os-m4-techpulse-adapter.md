# agent-os M4 — TechPulse Adapter & Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `techpulse-coo` project adapter and `AdapterHost` so agent-os mirrors TechPulse's COO proposals into `raw/`, raises a pending Decision for every newly-`proposed` proposal, and lets a human approve/reject from the dashboard/CLI by flipping frontmatter, committing, and pushing to the TechPulse repo.
**Architecture:** `packages/adapters` holds the pure, git/fs-driven `techpulse-coo` adapter (frontmatter flip + mirror + decision extraction) implementing the `ProjectAdapter` interface owned by `packages/kernel`; `AdapterHost` (kernel) loads `os/projects/*.yaml`, wraps every `sync`/`applyDecision` call in a tracked `Run`, and is wired into the HTTP API (`/api/decisions*`, `/api/projects/:name/sync`) and the CLI (`decisions`, `approve`, `reject`, `sync`).
**Tech Stack:** TypeScript ^5.6 strict/ESM, Vitest, `simple-git@^3`, `gray-matter@^4`, `yaml@^2`, `fastify@^5`, `commander@^12`, `better-sqlite3@^11`.
**Spec:** docs/superpowers/specs/2026-09-08-agent-os-design.md
**Contract:** docs/superpowers/plans/2026-09-08-agent-os-00-contract.md

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only
  (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome (single tool).
- Runtime deps (pinned major): `zod@^3`, `better-sqlite3@^11`, `croner@^9`,
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
---

## File structure
- `packages/adapters/package.json`, `tsconfig.json` — new package `@agentos/adapters`.
- `packages/adapters/src/index.ts` — adapter registry (`{'techpulse-coo': techpulseCooAdapter}`).
- `packages/adapters/src/techpulseCoo/frontmatter.ts` — `readStatus`/`setStatus`, byte-preserving.
- `packages/adapters/src/techpulseCoo/frontmatter.test.ts` — frontmatter unit tests.
- `packages/adapters/src/techpulseCoo/adapter.ts` — `techpulseCooAdapter: ProjectAdapter` (`sync`, `applyDecision`).
- `packages/adapters/src/techpulseCoo/adapter.test.ts` — sync/decision unit tests against a temp repo.
- `packages/adapters/src/techpulseCoo/applyDecision.test.ts` — applyDecision unit tests.
- `packages/adapters/src/techpulseCoo/test-helpers.ts` — temp bare+clone TechPulse repo builder (test-only, not imported by `index.ts`).
- `packages/adapters/src/index.test.ts` — registry test.
- `packages/kernel/package.json` — **modify**: add `./adapters/types` export subpath.
- `packages/kernel/src/adapters/adapterHost.ts` — **modify**: implement `AdapterHost.loadProjects/sync/applyDecision` (currently a stub from M1–M3).
- `packages/kernel/src/adapters/adapterHost.test.ts` — loadProjects + sync/applyDecision Run-lifecycle tests.
- `packages/kernel/src/log/eventLog.ts` — **modify**: add `getDecision(id)` (Contract addition, §below).
- `packages/kernel/src/api/server.ts` — **modify**: add `GET/POST /api/decisions*`, `POST /api/projects/:name/sync` to `buildServer(kernel)`.
- `packages/kernel/src/api/decisions.test.ts` — route tests via `app.inject`.
- `packages/cli/src/client.ts` — **modify**: add `listDecisions/approveDecision/rejectDecision/syncProject`.
- `packages/cli/src/commands/decisions.ts`, `approve.ts`, `reject.ts`, `sync.ts` — new CLI commands (files already reserved by contract §1.3).
- `packages/cli/src/commands/decisions.test.ts` — CLI command tests against a real in-process server.
- `examples/os-template/os/projects/techpulse.yaml` — TechPulse project config.

## Task 1: Frontmatter helpers
**Files:** `packages/adapters/src/techpulseCoo/frontmatter.ts`, `frontmatter.test.ts`
**Interfaces:**
- Consumes: nothing.
- Produces: `readStatus(content: string): string`, `setStatus(content: string, status: string): string` (both operate on raw file text, not paths).

- [ ] **Step 1: failing test for readStatus/setStatus**
  ```ts
  // packages/adapters/src/techpulseCoo/frontmatter.test.ts
  import { describe, it, expect } from 'vitest'
  import { readStatus, setStatus } from './frontmatter.js'

  const sample = `---
title: Add dark mode toggle
status: proposed
attempts: 0
branch: null
---

# Add dark mode toggle

## Why this increases engagement
Users have asked for this repeatedly.

## Effort estimate
Small, about 2 hours.
`

  describe('frontmatter', () => {
    it('reads the status field', () => {
      expect(readStatus(sample)).toBe('proposed')
    })

    it('flips status while preserving body and other keys byte-for-byte', () => {
      const updated = setStatus(sample, 'approved')
      expect(readStatus(updated)).toBe('approved')
      expect(updated).toContain('attempts: 0')
      expect(updated).toContain('branch: null')
      const [, , sampleBody] = sample.split('---')
      const [, , updatedBody] = updated.split('---')
      expect(updatedBody).toBe(sampleBody)
    })

    it('throws when there is no frontmatter block', () => {
      expect(() => readStatus('# no frontmatter here')).toThrow()
    })

    it('throws when there is no status line', () => {
      const noStatus = '---\ntitle: x\n---\nbody'
      expect(() => setStatus(noStatus, 'approved')).toThrow()
    })
  })
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected failure: cannot find module `./frontmatter.js`.

- [ ] **Step 2: minimal implementation**
  ```ts
  // packages/adapters/src/techpulseCoo/frontmatter.ts
  import matter from 'gray-matter'

  export function readStatus(content: string): string {
    const { data } = matter(content)
    if (typeof data.status !== 'string') {
      throw new Error('frontmatter has no status field')
    }
    return data.status
  }

  export function setStatus(content: string, status: string): string {
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---/)
    if (!fmMatch || fmMatch.index === undefined) {
      throw new Error('no YAML frontmatter block found')
    }
    const block = fmMatch[0]
    const statusLineRe = /^status:\s*.*$/m
    if (!statusLineRe.test(block)) {
      throw new Error('frontmatter has no status line to replace')
    }
    const newBlock = block.replace(statusLineRe, `status: ${status}`)
    return content.slice(0, fmMatch.index) + newBlock + content.slice(fmMatch.index + block.length)
  }
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected: PASS (4 tests).

- [ ] **Step 3: commit**
  ```
  git add packages/adapters/src/techpulseCoo/frontmatter.ts packages/adapters/src/techpulseCoo/frontmatter.test.ts
  git commit -m "$(cat <<'EOF'
  feat(adapters): add byte-preserving frontmatter status helpers

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 2: `@agentos/adapters` package scaffold + registry
**Files:** `packages/adapters/package.json`, `packages/adapters/tsconfig.json`, `packages/adapters/src/index.ts`, `packages/adapters/src/index.test.ts`, `packages/adapters/src/techpulseCoo/adapter.ts` (skeleton), `packages/kernel/package.json` (modify)
**Interfaces:**
- Consumes: `ProjectAdapter`, `AdapterContext`, `SyncResult` from `@agentos/kernel/adapters/types` (contract §5).
- Produces: `export const adapterRegistry: Record<string, ProjectAdapter>` from `packages/adapters/src/index.ts`.

- [ ] **Step 1: failing test for the registry**
  ```ts
  // packages/adapters/src/index.test.ts
  import { describe, it, expect } from 'vitest'
  import { adapterRegistry } from './index.js'

  describe('adapterRegistry', () => {
    it('registers techpulse-coo', () => {
      expect(adapterRegistry['techpulse-coo']).toBeDefined()
      expect(adapterRegistry['techpulse-coo'].name).toBe('techpulse-coo')
      expect(typeof adapterRegistry['techpulse-coo'].sync).toBe('function')
      expect(typeof adapterRegistry['techpulse-coo'].applyDecision).toBe('function')
    })
  })
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected failure: cannot find package `@agentos/adapters` / module `./index.js` (package not yet scaffolded).

- [ ] **Step 2: scaffold package + kernel export subpath + skeleton adapter**
  ```json
  // packages/adapters/package.json
  {
    "name": "@agentos/adapters",
    "version": "0.1.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
    "scripts": {
      "build": "tsup src/index.ts --format esm --dts",
      "test": "vitest run",
      "lint": "biome check ."
    },
    "dependencies": {
      "@agentos/kernel": "workspace:*",
      "@agentos/shared": "workspace:*",
      "gray-matter": "^4",
      "simple-git": "^3"
    },
    "devDependencies": { "typescript": "^5.6", "tsup": "^8", "vitest": "^2" }
  }
  ```
  ```json
  // packages/adapters/tsconfig.json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "include": ["src"]
  }
  ```
  ```jsonc
  // packages/kernel/package.json — modify "exports" only:
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./adapters/types": { "types": "./dist/adapters/types.d.ts", "import": "./dist/adapters/types.js" }
  }
  ```
  ```ts
  // packages/adapters/src/techpulseCoo/adapter.ts
  import type { ProjectAdapter } from '@agentos/kernel/adapters/types'

  export const techpulseCooAdapter: ProjectAdapter = {
    name: 'techpulse-coo',
    async sync() {
      return { added: [], changed: [], events: [] }
    },
    async applyDecision() {
      throw new Error('techpulse-coo applyDecision not implemented')
    },
  }
  ```
  ```ts
  // packages/adapters/src/index.ts
  import type { ProjectAdapter } from '@agentos/kernel/adapters/types'
  import { techpulseCooAdapter } from './techpulseCoo/adapter.js'

  export const adapterRegistry: Record<string, ProjectAdapter> = {
    'techpulse-coo': techpulseCooAdapter,
  }
  ```
  Run: `pnpm install && pnpm --filter @agentos/adapters test` — expected: PASS (1 test).

- [ ] **Step 3: commit**
  ```
  git add packages/adapters packages/kernel/package.json
  git commit -m "$(cat <<'EOF'
  feat(adapters): scaffold @agentos/adapters package and registry

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 3: `sync()` — clone/fetch + mirror into `raw/`
**Files:** `packages/adapters/src/techpulseCoo/adapter.ts`, `packages/adapters/src/techpulseCoo/adapter.test.ts`, `packages/adapters/src/techpulseCoo/test-helpers.ts`
**Interfaces:**
- Consumes: `AdapterContext { cfg, log, wiki, project, runId? }` (contract §5), `EventLog.append` (contract §4).
- Produces: `techpulseCooAdapter.sync(ctx): Promise<SyncResult>` mirrors `proposals/`, `reports/`, `state.md` into `raw/<project.name>/...`, emits `raw.added` for new files.

- [ ] **Step 1: test helper (temp bare repo + seed clone)**
  ```ts
  // packages/adapters/src/techpulseCoo/test-helpers.ts
  import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import simpleGit from 'simple-git'

  export const PROPOSAL_1 = `---
title: Add dark mode toggle
status: proposed
attempts: 0
branch: null
---

# Add dark mode toggle

## Why this increases engagement
Users have asked for this repeatedly.

## Effort estimate
Small, about 2 hours.
`

  export async function createTempTechpulseRepo() {
    const root = mkdtempSync(path.join(tmpdir(), 'agentos-techpulse-'))
    const bareDir = path.join(root, 'bare.git')
    const seedDir = path.join(root, 'seed')
    const cloneDir = path.join(root, 'clone')

    await simpleGit().raw(['init', '--bare', '--initial-branch=main', bareDir])

    mkdirSync(seedDir, { recursive: true })
    const seedGit = simpleGit(seedDir)
    await seedGit.raw(['init', '--initial-branch=main'])
    await seedGit.addConfig('user.name', 'Test User')
    await seedGit.addConfig('user.email', 'test@example.com')

    const proposalsDir = path.join(seedDir, 'docs/missions/coo/proposals')
    mkdirSync(proposalsDir, { recursive: true })
    writeFileSync(path.join(proposalsDir, '001-dark-mode.md'), PROPOSAL_1)
    mkdirSync(path.join(seedDir, 'docs/missions/coo/reports'), { recursive: true })
    writeFileSync(path.join(seedDir, 'docs/missions/coo/state.md'), '# COO state\n\nAll quiet.\n')

    await seedGit.add('.')
    await seedGit.commit('seed')
    await seedGit.addRemote('origin', bareDir)
    await seedGit.push('origin', 'main')

    await simpleGit().clone(bareDir, cloneDir)
    const cloneGit = simpleGit(cloneDir)
    await cloneGit.addConfig('user.name', 'Test User')
    await cloneGit.addConfig('user.email', 'test@example.com')
    await cloneGit.checkout('main')

    return { root, bareDir, seedDir, cloneDir }
  }
  ```

- [ ] **Step 2: failing test for sync mirroring**
  ```ts
  // packages/adapters/src/techpulseCoo/adapter.test.ts
  import { describe, it, expect, beforeEach } from 'vitest'
  import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import type { AdapterContext } from '@agentos/kernel/adapters/types'
  import { techpulseCooAdapter } from './adapter.js'
  import { createTempTechpulseRepo } from './test-helpers.js'

  function fakeCtx(clone: string, osRoot: string): AdapterContext {
    const events: unknown[] = []
    const decisions: Array<{ id: string; adapter?: string; ref?: string }> = []
    return {
      cfg: { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1', port: 0, logLevel: 'info' },
      log: {
        append: (e: any) => { events.push(e); return { id: events.length, ts: new Date().toISOString(), ...e } },
        createDecision: (d: any) => { const dec = { id: `d${decisions.length + 1}`, status: 'pending', createdAt: new Date().toISOString(), ...d }; decisions.push(dec); return dec },
        listDecisions: () => decisions,
      } as any,
      wiki: {} as any,
      project: {
        name: 'techpulse', adapter: 'techpulse-coo', repo: 'unused', clone, base_branch: 'main',
        options: { proposals_path: 'docs/missions/coo/proposals', state_path: 'docs/missions/coo/state.md', reports_path: 'docs/missions/coo/reports' },
      },
      runId: 'run-1',
    }
  }

  describe('techpulseCooAdapter.sync', () => {
    it('mirrors proposals, reports dir and state.md into raw/ and emits raw.added', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)

      const result = await techpulseCooAdapter.sync(ctx)

      expect(result.added).toContain(path.join('proposals', '001-dark-mode.md'))
      expect(result.added).toContain('state.md')
      expect(result.events).toContain('raw.added')
      const mirrored = readFileSync(path.join(osRoot, 'raw', 'techpulse', 'proposals', '001-dark-mode.md'), 'utf8')
      expect(mirrored).toContain('status: proposed')
      expect(existsSync(path.join(osRoot, 'raw', 'techpulse', 'state.md'))).toBe(true)
    })

    it('is a no-op on the second run when nothing changed', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)
      await techpulseCooAdapter.sync(ctx)
      const second = await techpulseCooAdapter.sync(ctx)
      expect(second.added).toEqual([])
      expect(second.changed).toEqual([])
    })
  })
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected failure: `result.added` is `[]` (stub sync returns empty result).

- [ ] **Step 3: implement mirroring**
  ```ts
  // packages/adapters/src/techpulseCoo/adapter.ts
  import { createHash } from 'node:crypto'
  import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
  import path from 'node:path'
  import simpleGit from 'simple-git'
  import type { AdapterContext, ProjectAdapter, SyncResult } from '@agentos/kernel/adapters/types'
  import { readStatus } from './frontmatter.js'

  interface TechpulseCooOptions {
    proposals_path: string
    state_path: string
    reports_path: string
  }

  function hash(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  async function pathExists(p: string): Promise<boolean> {
    return stat(p).then(() => true).catch(() => false)
  }

  async function ensureClone(ctx: AdapterContext): Promise<void> {
    const { project } = ctx
    if (await pathExists(path.join(project.clone, '.git'))) {
      const repoGit = simpleGit(project.clone)
      await repoGit.fetch('origin')
      await repoGit.checkout(project.base_branch)
      await repoGit.pull('origin', project.base_branch, ['--ff-only'])
      return
    }
    await mkdir(path.dirname(project.clone), { recursive: true })
    await simpleGit().clone(project.repo, project.clone)
  }

  async function listMdFiles(dir: string): Promise<string[]> {
    if (!(await pathExists(dir))) return []
    const entries = await readdir(dir)
    return entries.filter((f) => f.endsWith('.md')).sort()
  }

  interface MirrorOutcome { oldContent?: string; newContent: string }

  async function mirrorFile(ctx: AdapterContext, srcPath: string, destRelPath: string, result: SyncResult): Promise<MirrorOutcome | null> {
    const content = await readFile(srcPath, 'utf8')
    const destPath = path.join(ctx.cfg.osRoot, 'raw', ctx.project.name, destRelPath)
    const destExisted = await pathExists(destPath)
    let oldContent: string | undefined
    if (destExisted) {
      oldContent = await readFile(destPath, 'utf8')
      if (hash(oldContent) === hash(content)) return null
    }
    await mkdir(path.dirname(destPath), { recursive: true })
    await writeFile(destPath, content, 'utf8')
    if (destExisted) {
      result.changed.push(destRelPath)
    } else {
      result.added.push(destRelPath)
      result.events.push('raw.added')
      ctx.log.append({ type: 'raw.added', runId: ctx.runId, payload: { project: ctx.project.name, file: destRelPath } })
    }
    return { oldContent, newContent: content }
  }

  export const techpulseCooAdapter: ProjectAdapter = {
    name: 'techpulse-coo',
    async sync(ctx: AdapterContext): Promise<SyncResult> {
      const opts = ctx.project.options as unknown as TechpulseCooOptions
      await ensureClone(ctx)
      const result: SyncResult = { added: [], changed: [], events: [] }

      const proposalsDir = path.join(ctx.project.clone, opts.proposals_path)
      for (const file of await listMdFiles(proposalsDir)) {
        await mirrorFile(ctx, path.join(proposalsDir, file), path.join('proposals', file), result)
      }

      const reportsDir = path.join(ctx.project.clone, opts.reports_path)
      for (const file of await listMdFiles(reportsDir)) {
        await mirrorFile(ctx, path.join(reportsDir, file), path.join('reports', file), result)
      }

      const statePath = path.join(ctx.project.clone, opts.state_path)
      if (await pathExists(statePath)) {
        await mirrorFile(ctx, statePath, 'state.md', result)
      }

      return result
    },
    async applyDecision() {
      throw new Error('techpulse-coo applyDecision not implemented')
    },
  }

  export { readStatus }
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected: PASS (index 1, frontmatter 4, adapter 2 tests).

- [ ] **Step 4: commit**
  ```
  git add packages/adapters/src/techpulseCoo/adapter.ts packages/adapters/src/techpulseCoo/adapter.test.ts packages/adapters/src/techpulseCoo/test-helpers.ts
  git commit -m "$(cat <<'EOF'
  feat(adapters): mirror TechPulse proposals/reports/state into raw/

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 4: `sync()` — proposal.changed events + Decision creation
**Files:** `packages/adapters/src/techpulseCoo/adapter.ts`, `packages/adapters/src/techpulseCoo/adapter.test.ts`
**Interfaces:**
- Consumes: `EventLog.createDecision`, `EventLog.listDecisions` (contract §4), `Decision` type (contract §3).
- Produces: for each mirrored proposal with status transition, emits `proposal.changed` `{file, oldStatus, newStatus}`; for each proposal with status `proposed` lacking a Decision (`adapter='techpulse-coo'`, `ref=file`), creates one.

- [ ] **Step 1: failing tests**
  ```ts
  // append to packages/adapters/src/techpulseCoo/adapter.test.ts
  import { writeFileSync } from 'node:fs'

  describe('techpulseCooAdapter.sync — decisions', () => {
    it('creates a pending decision for a newly-proposed proposal', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)

      await techpulseCooAdapter.sync(ctx)

      const decisions = (ctx.log as any).listDecisions()
      expect(decisions).toHaveLength(1)
      expect(decisions[0]).toMatchObject({ adapter: 'techpulse-coo', ref: path.join('proposals', '001-dark-mode.md'), status: 'pending', title: 'Add dark mode toggle' })
      expect(decisions[0].body).toContain('Why this increases engagement')
      expect(decisions[0].body).toContain('Effort estimate')
    })

    it('does not duplicate a decision on a second sync', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)
      await techpulseCooAdapter.sync(ctx)
      await techpulseCooAdapter.sync(ctx)
      expect((ctx.log as any).listDecisions()).toHaveLength(1)
    })

    it('emits proposal.changed when a mirrored status transitions', async () => {
      const { cloneDir, seedDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const ctx = fakeCtx(cloneDir, osRoot)
      await techpulseCooAdapter.sync(ctx)

      const seedGit = (await import('simple-git')).default(seedDir)
      const proposalPath = path.join(seedDir, 'docs/missions/coo/proposals/001-dark-mode.md')
      writeFileSync(proposalPath, readFileSync(proposalPath, 'utf8').replace('status: proposed', 'status: approved'))
      await seedGit.add('.')
      await seedGit.commit('approve')
      await seedGit.push('origin', 'main')

      const result = await techpulseCooAdapter.sync(ctx)
      expect(result.events).toContain('proposal.changed')
    })
  })
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected failure: `listDecisions()` returns `[]` (no decision-creation logic yet).

- [ ] **Step 2: implement**
  ```ts
  // packages/adapters/src/techpulseCoo/adapter.ts — add near the top, after readStatus import:
  import { readStatus } from './frontmatter.js'

  function extractTitle(content: string): string {
    const h1 = content.match(/^#\s+(.+)$/m)
    return h1 ? h1[1].trim() : 'Untitled proposal'
  }

  function extractDecisionBody(content: string): string {
    const why = content.match(/^##\s+Why this increases engagement\s*\n([\s\S]*?)(?=\n##\s|$)/m)
    const effort = content.match(/^##\s+Effort estimate\s*\n([\s\S]*?)(?=\n##\s|$)/m)
    if (why || effort) {
      return [
        why ? `## Why this increases engagement\n${why[1].trim()}` : null,
        effort ? `## Effort estimate\n${effort[1].trim()}` : null,
      ].filter((s): s is string => s !== null).join('\n\n')
    }
    return content.slice(0, 1500)
  }

  async function ensureDecision(ctx: AdapterContext, file: string, content: string): Promise<void> {
    const existing = ctx.log
      .listDecisions()
      .find((d) => d.adapter === 'techpulse-coo' && d.ref === file)
    if (existing) return
    const decision = ctx.log.createDecision({
      title: extractTitle(content),
      body: extractDecisionBody(content),
      adapter: 'techpulse-coo',
      ref: file,
      createdByRun: ctx.runId,
    })
    ctx.log.append({ type: 'decision.created', runId: ctx.runId, payload: { decisionId: decision.id, ref: file } })
  }
  ```
  Then replace the proposals loop inside `sync()`:
  ```ts
      const proposalsDir = path.join(ctx.project.clone, opts.proposals_path)
      for (const file of await listMdFiles(proposalsDir)) {
        const destRel = path.join('proposals', file)
        const mirrored = await mirrorFile(ctx, path.join(proposalsDir, file), destRel, result)
        if (!mirrored) continue
        const newStatus = readStatus(mirrored.newContent)
        const oldStatus = mirrored.oldContent ? readStatus(mirrored.oldContent) : undefined
        if (oldStatus && oldStatus !== newStatus) {
          result.events.push('proposal.changed')
          ctx.log.append({ type: 'proposal.changed', runId: ctx.runId, payload: { file: destRel, oldStatus, newStatus } })
        }
        if (newStatus === 'proposed') {
          await ensureDecision(ctx, destRel, mirrored.newContent)
        }
      }
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected: PASS (all adapter.test.ts cases).

- [ ] **Step 3: commit**
  ```
  git add packages/adapters/src/techpulseCoo/adapter.ts packages/adapters/src/techpulseCoo/adapter.test.ts
  git commit -m "$(cat <<'EOF'
  feat(adapters): raise pending decisions for newly-proposed COO proposals

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 5: `applyDecision()` — flip, commit, push, record
**Files:** `packages/adapters/src/techpulseCoo/adapter.ts`, `packages/adapters/src/techpulseCoo/applyDecision.test.ts`
**Interfaces:**
- Consumes: `Decision` (contract §3), `WikiService.writePage` (contract §4), `EventLog.resolveDecision`/`append`.
- Produces: `techpulseCooAdapter.applyDecision(decision, ctx): Promise<void>` — reads `decision.status` (`'approved'|'rejected'`) as the target, flips frontmatter via `setStatus`, commits, pushes, writes `output/approvals/<date>-<slug>.md`, calls `wiki.writePage`, resolves the decision, and on push failure resolves it as `'error'` + emits `ops.alert`.

- [ ] **Step 1: failing tests**
  ```ts
  // packages/adapters/src/techpulseCoo/applyDecision.test.ts
  import { describe, it, expect } from 'vitest'
  import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import simpleGit from 'simple-git'
  import type { AdapterContext } from '@agentos/kernel/adapters/types'
  import { techpulseCooAdapter } from './adapter.js'
  import { createTempTechpulseRepo } from './test-helpers.js'

  function fakeCtx(clone: string, osRoot: string, wiki: { writePage: (i: any) => Promise<any> }) {
    const resolved: Array<{ id: string; status: string; error?: string }> = []
    const events: any[] = []
    return {
      ctx: {
        cfg: { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1', port: 0, logLevel: 'info' },
        log: {
          append: (e: any) => { events.push(e); return { id: events.length, ts: new Date().toISOString(), ...e } },
          resolveDecision: (id: string, status: string, error?: string) => { const d = { id, status, error }; resolved.push(d); return d },
        } as any,
        wiki: wiki as any,
        project: {
          name: 'techpulse', adapter: 'techpulse-coo', repo: 'unused', clone, base_branch: 'main',
          options: { proposals_path: 'docs/missions/coo/proposals', state_path: 'docs/missions/coo/state.md', reports_path: 'docs/missions/coo/reports' },
        },
        runId: 'run-1',
      } as AdapterContext,
      resolved,
      events,
    }
  }

  describe('techpulseCooAdapter.applyDecision', () => {
    it('flips status, commits, pushes, writes approval output and wiki page', async () => {
      const { bareDir, cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const wikiWrites: any[] = []
      const { ctx, resolved, events } = fakeCtx(cloneDir, osRoot, { writePage: async (i) => { wikiWrites.push(i); return { result: 'created', path: i.path } } })
      const decision = { id: 'd1', title: 'Add dark mode toggle', body: '', adapter: 'techpulse-coo', ref: path.join('proposals', '001-dark-mode.md'), status: 'approved', createdAt: new Date().toISOString() }

      await techpulseCooAdapter.applyDecision(decision as any, ctx)

      expect(resolved).toEqual([{ id: 'd1', status: 'approved', error: undefined }])
      expect(events.some((e) => e.type === 'git.commit')).toBe(true)
      expect(events.some((e) => e.type === 'git.push')).toBe(true)
      expect(wikiWrites).toHaveLength(1)
      expect(wikiWrites[0].path).toBe('projects/techpulse/proposals/001-dark-mode.md')

      const verifyDir = path.join(osRoot, '..', 'verify')
      await simpleGit().clone(bareDir, verifyDir)
      const pushed = readFileSync(path.join(verifyDir, 'docs/missions/coo/proposals/001-dark-mode.md'), 'utf8')
      expect(pushed).toContain('status: approved')
      expect(pushed).toContain('attempts: 0')

      const approvalsDir = path.join(osRoot, 'output', 'approvals')
      const { readdirSync } = await import('node:fs')
      const files = readdirSync(approvalsDir)
      expect(files.some((f) => f.endsWith('-001-dark-mode.md'))).toBe(true)
    })

    it('resolves the decision as error and alerts on push failure', async () => {
      const { cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const { ctx, resolved, events } = fakeCtx(cloneDir, osRoot, { writePage: async (i) => ({ result: 'created', path: i.path }) })
      // break the remote so push fails
      await simpleGit(cloneDir).removeRemote('origin')
      await simpleGit(cloneDir).addRemote('origin', path.join(osRoot, 'does-not-exist.git'))
      const decision = { id: 'd1', title: 'x', body: '', adapter: 'techpulse-coo', ref: path.join('proposals', '001-dark-mode.md'), status: 'rejected', createdAt: new Date().toISOString() }

      await expect(techpulseCooAdapter.applyDecision(decision as any, ctx)).rejects.toThrow()

      expect(resolved[0].status).toBe('error')
      expect(events.some((e) => e.type === 'ops.alert')).toBe(true)
    })
  })
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected failure: `applyDecision not implemented`.

- [ ] **Step 2: implement**
  ```ts
  // packages/adapters/src/techpulseCoo/adapter.ts — add imports:
  import { setStatus } from './frontmatter.js'
  import type { Decision } from '@agentos/shared'

  // replace the applyDecision stub:
  async applyDecision(decision: Decision, ctx: AdapterContext): Promise<void> {
    const opts = ctx.project.options as unknown as TechpulseCooOptions
    const git = simpleGit(ctx.project.clone)
    try {
      await git.checkout(ctx.project.base_branch)
      await git.pull('origin', ctx.project.base_branch, ['--ff-only'])

      const file = decision.ref
      if (!file) throw new Error(`decision ${decision.id} has no ref`)
      const filePath = path.join(ctx.project.clone, opts.proposals_path, path.basename(file))
      const content = await readFile(filePath, 'utf8')
      const targetStatus = decision.status === 'rejected' ? 'rejected' : 'approved'
      await writeFile(filePath, setStatus(content, targetStatus), 'utf8')

      const slug = path.basename(file).replace(/\.md$/, '')
      const verb = targetStatus === 'approved' ? 'approve' : 'reject'
      await git.add([path.join(opts.proposals_path, path.basename(file))])
      const subject = `chore(coo): ${verb} ${slug}`
      const commitResult = await git.commit(`${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`)
      ctx.log.append({ type: 'git.commit', runId: ctx.runId, payload: { decisionId: decision.id, sha: commitResult.commit, message: subject } })

      await git.push('origin', ctx.project.base_branch)
      ctx.log.append({ type: 'git.push', runId: ctx.runId, payload: { decisionId: decision.id, branch: ctx.project.base_branch } })

      const date = new Date().toISOString().slice(0, 10)
      const approvalPath = path.join(ctx.cfg.osRoot, 'output', 'approvals', `${date}-${slug}.md`)
      await mkdir(path.dirname(approvalPath), { recursive: true })
      await writeFile(
        approvalPath,
        `# ${verb === 'approve' ? 'Approved' : 'Rejected'}: ${slug}\n\n- decision: ${targetStatus}\n- timestamp: ${new Date().toISOString()}\n- commit: ${commitResult.commit}\n`,
        'utf8',
      )

      await ctx.wiki.writePage({
        path: `projects/techpulse/proposals/${slug}.md`,
        content: `# ${slug}\n\nStatus: ${targetStatus}\n\nDecision ${decision.id} resolved as ${targetStatus} (commit ${commitResult.commit}).\n`,
        op: 'decision',
        runId: ctx.runId,
      })

      ctx.log.resolveDecision(decision.id, targetStatus)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.log.resolveDecision(decision.id, 'error', message)
      ctx.log.append({ type: 'ops.alert', runId: ctx.runId, payload: { decisionId: decision.id, error: message } })
      throw err
    }
  }
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/adapters/src/techpulseCoo/adapter.ts packages/adapters/src/techpulseCoo/applyDecision.test.ts
  git commit -m "$(cat <<'EOF'
  feat(adapters): implement techpulse-coo applyDecision (flip, commit, push, record)

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 6: `AdapterHost.loadProjects`
**Files:** `packages/kernel/src/adapters/adapterHost.ts`, `packages/kernel/src/adapters/adapterHost.test.ts`
**Interfaces:**
- Consumes: `ProjectConfigSchema` (contract §3), `KernelConfig` (contract §4).
- Produces: `AdapterHost.loadProjects(): Promise<ProjectConfig[]>`, expanding `${AGENTOS_HOME}` → `cfg.osRoot` and `${AGENTOS_CLONES}` → `path.join(cfg.runtimeDir, 'clones')`.

- [ ] **Step 1: failing test**
  ```ts
  // packages/kernel/src/adapters/adapterHost.test.ts
  import { describe, it, expect } from 'vitest'
  import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import { AdapterHost } from './adapterHost.js'
  import type { KernelConfig } from '../config.js'

  function makeCfg(osRoot: string): KernelConfig {
    return { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1', port: 0, logLevel: 'info' }
  }

  describe('AdapterHost.loadProjects', () => {
    it('parses projects/*.yaml and expands variables', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
      writeFileSync(
        path.join(osRoot, 'projects', 'techpulse.yaml'),
        'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: ${AGENTOS_CLONES}/techpulse\nbase_branch: main\noptions:\n  proposals_path: docs/missions/coo/proposals\n  state_path: docs/missions/coo/state.md\n  reports_path: docs/missions/coo/reports\n',
      )
      const cfg = makeCfg(osRoot)
      const host = new AdapterHost(cfg, {} as any, {} as any, {})

      const projects = await host.loadProjects()

      expect(projects).toHaveLength(1)
      expect(projects[0].name).toBe('techpulse')
      expect(projects[0].clone).toBe(path.join(cfg.runtimeDir, 'clones', 'techpulse'))
    })

    it('returns an empty array when no projects directory exists', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const host = new AdapterHost(makeCfg(osRoot), {} as any, {} as any, {})
      expect(await host.loadProjects()).toEqual([])
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected failure: `AdapterHost` constructor/`loadProjects` not implemented (stub throws or returns `[]` unconditionally without expansion).

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/adapters/adapterHost.ts
  import { readFile, readdir } from 'node:fs/promises'
  import path from 'node:path'
  import { parse as parseYaml } from 'yaml'
  import { ProjectConfigSchema } from '@agentos/shared'
  import type { ProjectConfig, Decision } from '@agentos/shared'
  import type { KernelConfig } from '../config.js'
  import type { EventLog } from '../log/eventLog.js'
  import type { WikiService } from '../wiki/wikiService.js'
  import type { AdapterContext, ProjectAdapter, SyncResult } from './types.js'

  export class AdapterHost {
    constructor(
      private cfg: KernelConfig,
      private log: EventLog,
      private wiki: WikiService,
      private registry: Record<string, ProjectAdapter>,
    ) {}

    private expand(value: string): string {
      return value
        .replaceAll('${AGENTOS_HOME}', this.cfg.osRoot)
        .replaceAll('${AGENTOS_CLONES}', path.join(this.cfg.runtimeDir, 'clones'))
    }

    async loadProjects(): Promise<ProjectConfig[]> {
      const dir = path.join(this.cfg.osRoot, 'projects')
      const files = await readdir(dir).catch(() => null)
      if (!files) return []
      const projects: ProjectConfig[] = []
      for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
        const raw = await readFile(path.join(dir, file), 'utf8')
        const parsed = parseYaml(raw) as Record<string, unknown>
        const expanded = { ...parsed, clone: typeof parsed.clone === 'string' ? this.expand(parsed.clone) : parsed.clone }
        projects.push(ProjectConfigSchema.parse(expanded))
      }
      return projects
    }

    private getAdapter(project: ProjectConfig): ProjectAdapter {
      const adapter = this.registry[project.adapter]
      if (!adapter) throw new Error(`no adapter registered for '${project.adapter}'`)
      return adapter
    }

    async sync(_projectName: string, _runId?: string): Promise<SyncResult> {
      throw new Error('not implemented') // Task 7
    }

    async applyDecision(_decision: Decision): Promise<void> {
      throw new Error('not implemented') // Task 7
    }
  }
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected: PASS (loadProjects tests).

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/adapters/adapterHost.ts packages/kernel/src/adapters/adapterHost.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): implement AdapterHost.loadProjects with variable expansion

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 7: `AdapterHost.sync` / `applyDecision` — Run lifecycle
**Files:** `packages/kernel/src/adapters/adapterHost.ts`, `packages/kernel/src/adapters/adapterHost.test.ts`, `packages/kernel/src/log/eventLog.ts` (modify)
**Interfaces:**
- Consumes: `EventLog.createRun/updateRun/getRun` (contract §4), `EventLog.getDecision` (**Contract addition**, below).
- Produces: `AdapterHost.sync(projectName, runId?): Promise<SyncResult>` creates+tracks a `Run` (`adapter: project.adapter`, `status: running→success|failed`) when no `runId` is supplied, else reuses it; `AdapterHost.applyDecision(decision): Promise<void>` always creates its own tracked `Run` and forwards `ctx.runId` to the adapter.

- [ ] **Step 1: Contract addition + failing test**
  ```ts
  // packages/kernel/src/log/eventLog.ts — add method to the EventLog class:
  getDecision(id: string): Decision | undefined {
    return this.listDecisions().find((d) => d.id === id)
  }
  ```
  ```ts
  // append to packages/kernel/src/adapters/adapterHost.test.ts
  import { EventLog } from '../log/eventLog.js'
  import { WikiService } from '../wiki/wikiService.js'

  describe('AdapterHost.sync / applyDecision — Run lifecycle', () => {
    it('creates a Run, calls the adapter, and marks it success', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
      writeFileSync(
        path.join(osRoot, 'projects', 'techpulse.yaml'),
        'name: techpulse\nadapter: techpulse-coo\nrepo: https://example.com/x.git\nclone: /tmp/does-not-matter\nbase_branch: main\noptions: {}\n',
      )
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const syncCalls: string[] = []
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => { syncCalls.push('sync'); return { added: [], changed: [], events: [] } }, applyDecision: async () => {} } }
      const host = new AdapterHost(cfg, log, wiki, registry)

      const result = await host.sync('techpulse')

      expect(result).toEqual({ added: [], changed: [], events: [] })
      expect(syncCalls).toEqual(['sync'])
      const runs = log.listRuns({ routine: 'adapter:techpulse' })
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe('success')
      expect(runs[0].adapter).toBe('techpulse-coo')
    })

    it('marks the Run failed when the adapter throws', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
      writeFileSync(path.join(osRoot, 'projects', 'techpulse.yaml'), 'name: techpulse\nadapter: techpulse-coo\nrepo: x\nclone: /tmp/x\nbase_branch: main\noptions: {}\n')
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => { throw new Error('boom') }, applyDecision: async () => {} } }
      const host = new AdapterHost(cfg, log, wiki, registry)

      await expect(host.sync('techpulse')).rejects.toThrow('boom')
      const runs = log.listRuns({ routine: 'adapter:techpulse' })
      expect(runs[0].status).toBe('failed')
      expect(runs[0].error).toBe('boom')
    })

    it('applyDecision creates its own Run and forwards runId to the adapter', async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
      writeFileSync(path.join(osRoot, 'projects', 'techpulse.yaml'), 'name: techpulse\nadapter: techpulse-coo\nrepo: x\nclone: /tmp/x\nbase_branch: main\noptions: {}\n')
      const cfg = makeCfg(osRoot)
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const seenRunIds: (string | undefined)[] = []
      const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => ({ added: [], changed: [], events: [] }), applyDecision: async (_d: any, ctx: any) => { seenRunIds.push(ctx.runId) } } }
      const host = new AdapterHost(cfg, log, wiki, registry)
      const decision = log.createDecision({ title: 't', body: 'b', adapter: 'techpulse-coo', ref: '001.md' })

      await host.applyDecision({ ...decision, status: 'approved' })

      expect(seenRunIds).toHaveLength(1)
      expect(seenRunIds[0]).toBeTruthy()
      const runs = log.listRuns({ routine: 'adapter:apply-decision' })
      expect(runs[0].status).toBe('success')
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected failure: `sync`/`applyDecision` throw `not implemented`.

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/adapters/adapterHost.ts — replace the two stub methods:
  async sync(projectName: string, runId?: string): Promise<SyncResult> {
    const projects = await this.loadProjects()
    const project = projects.find((p) => p.name === projectName)
    if (!project) throw new Error(`unknown project '${projectName}'`)
    const adapter = this.getAdapter(project)

    const ownRun = !runId
    const run = ownRun
      ? this.log.createRun({ routine: `adapter:${projectName}`, adapter: project.adapter, payload: { action: 'sync', project: projectName } })
      : this.log.getRun(runId)
    if (ownRun && run) this.log.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() })
    const activeRunId = run?.id ?? runId

    const ctx: AdapterContext = { cfg: this.cfg, log: this.log, wiki: this.wiki, project, runId: activeRunId }
    try {
      const result = await adapter.sync(ctx)
      if (ownRun && run) this.log.updateRun(run.id, { status: 'success', endedAt: new Date().toISOString() })
      return result
    } catch (err) {
      if (ownRun && run) {
        this.log.updateRun(run.id, { status: 'failed', endedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) })
      }
      throw err
    }
  }

  async applyDecision(decision: Decision): Promise<void> {
    if (!decision.adapter) throw new Error(`decision ${decision.id} has no adapter`)
    const projects = await this.loadProjects()
    const project = projects.find((p) => p.adapter === decision.adapter)
    if (!project) throw new Error(`no project configured for adapter '${decision.adapter}'`)
    const adapter = this.getAdapter(project)

    const run = this.log.createRun({ routine: 'adapter:apply-decision', adapter: decision.adapter, payload: { decisionId: decision.id } })
    this.log.updateRun(run.id, { status: 'running', startedAt: new Date().toISOString() })
    const ctx: AdapterContext = { cfg: this.cfg, log: this.log, wiki: this.wiki, project, runId: run.id }
    try {
      await adapter.applyDecision(decision, ctx)
      this.log.updateRun(run.id, { status: 'success', endedAt: new Date().toISOString() })
    } catch (err) {
      this.log.updateRun(run.id, { status: 'failed', endedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/adapters/adapterHost.ts packages/kernel/src/adapters/adapterHost.test.ts packages/kernel/src/log/eventLog.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): track sync/applyDecision as Runs in AdapterHost

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 8: Decisions API + projects sync route
**Files:** `packages/kernel/src/api/server.ts` (modify `buildServer`), `packages/kernel/src/api/decisions.test.ts`
**Interfaces:**
- Consumes: `Kernel { log, adapters, wiki, ... }` (contract §4), `EventLog.listDecisions/getDecision/resolveDecision`.
- Produces: routes per contract §7 — `GET /api/decisions`, `POST /api/decisions/:id/approve`, `POST /api/decisions/:id/reject`, `POST /api/projects/:name/sync`.

- [ ] **Step 1: failing test**
  ```ts
  // packages/kernel/src/api/decisions.test.ts
  import { describe, it, expect } from 'vitest'
  import { mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import { EventLog } from '../log/eventLog.js'
  import { WikiService } from '../wiki/wikiService.js'
  import { AdapterHost } from '../adapters/adapterHost.js'
  import { buildServer } from './server.js'
  import type { KernelConfig } from '../config.js'

  function makeKernel() {
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    const cfg: KernelConfig = { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1', port: 0, logLevel: 'info' }
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const applied: any[] = []
    const registry = { 'techpulse-coo': { name: 'techpulse-coo', sync: async () => ({ added: [], changed: [], events: [] }), applyDecision: async (d: any) => { applied.push(d) } } }
    const adapters = new AdapterHost(cfg, log, wiki, registry)
    return { cfg, log, wiki, adapters, applied }
  }

  describe('decisions + projects routes', () => {
    it('lists decisions and approves a plain (non-adapter) one', async () => {
      const kernel: any = makeKernel()
      kernel.log.createDecision({ title: 'manual', body: 'b' })
      const app = buildServer(kernel)

      const list = await app.inject({ method: 'GET', url: '/api/decisions' })
      expect(list.statusCode).toBe(200)
      const decisions = JSON.parse(list.body)
      expect(decisions).toHaveLength(1)

      const approve = await app.inject({ method: 'POST', url: `/api/decisions/${decisions[0].id}/approve` })
      expect(approve.statusCode).toBe(200)
      expect(JSON.parse(approve.body).status).toBe('approved')
    })

    it('routes adapter-backed approve/reject through AdapterHost.applyDecision', async () => {
      const kernel: any = makeKernel()
      const decision = kernel.log.createDecision({ title: 't', body: 'b', adapter: 'techpulse-coo', ref: '001.md' })
      const app = buildServer(kernel)

      const reject = await app.inject({ method: 'POST', url: `/api/decisions/${decision.id}/reject` })

      expect(reject.statusCode).toBe(200)
      expect(kernel.applied).toHaveLength(1)
      expect(kernel.applied[0].status).toBe('rejected')
    })

    it('rejects re-resolving an already-resolved decision with 409', async () => {
      const kernel: any = makeKernel()
      const decision = kernel.log.createDecision({ title: 't', body: 'b' })
      kernel.log.resolveDecision(decision.id, 'approved')
      const app = buildServer(kernel)

      const res = await app.inject({ method: 'POST', url: `/api/decisions/${decision.id}/approve` })
      expect(res.statusCode).toBe(409)
    })

    it('exposes POST /api/projects/:name/sync', async () => {
      const kernel: any = makeKernel()
      const app = buildServer(kernel)
      const res = await app.inject({ method: 'POST', url: '/api/projects/techpulse/sync' })
      expect([200, 500]).toContain(res.statusCode) // 500 acceptable: no projects/*.yaml seeded in this test osRoot
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected failure: 404 on `/api/decisions*` (routes not yet registered in `buildServer`).

- [ ] **Step 2: implement**
  ```ts
  // packages/kernel/src/api/server.ts — inside buildServer(kernel), alongside the existing route registrations:
  import type { DecisionStatus } from '@agentos/shared'

  app.get('/api/decisions', async (req) => {
    const { status } = req.query as { status?: DecisionStatus }
    return kernel.log.listDecisions(status ? { status } : undefined)
  })

  async function resolveRoute(id: string, target: 'approved' | 'rejected') {
    const decision = kernel.log.getDecision(id)
    if (!decision) return { code: 404, body: { error: 'decision not found' } }
    if (decision.status !== 'pending') return { code: 409, body: { error: `decision already ${decision.status}` } }
    if (decision.adapter) {
      await kernel.adapters.applyDecision({ ...decision, status: target })
    } else {
      kernel.log.resolveDecision(id, target)
    }
    return { code: 200, body: kernel.log.getDecision(id) }
  }

  app.post('/api/decisions/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { code, body } = await resolveRoute(id, 'approved')
    return reply.code(code).send(body)
  })

  app.post('/api/decisions/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { code, body } = await resolveRoute(id, 'rejected')
    return reply.code(code).send(body)
  })

  app.post('/api/projects/:name/sync', async (req, reply) => {
    const { name } = req.params as { name: string }
    try {
      return await kernel.adapters.sync(name)
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected: PASS.
  > Note for the implementer: place these registrations at the same point in `buildServer` where the existing `/api/runs*` and `/api/routines*` routes are registered (per M1/M3), using that file's existing `app`/`kernel` variable names.

- [ ] **Step 3: commit**
  ```
  git add packages/kernel/src/api/server.ts packages/kernel/src/api/decisions.test.ts
  git commit -m "$(cat <<'EOF'
  feat(kernel): add decisions and projects/:name/sync HTTP routes

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 9: CLI `decisions` / `approve` / `reject` / `sync`
**Files:** `packages/cli/src/client.ts` (modify), `packages/cli/src/commands/decisions.ts`, `approve.ts`, `reject.ts`, `sync.ts`, `packages/cli/src/commands/decisions.test.ts`
**Interfaces:**
- Consumes: `ApiClient` fetch wrapper (contract §1.3), HTTP routes from Task 8.
- Produces: `ApiClient.listDecisions/approveDecision/rejectDecision/syncProject`; `registerDecisions/registerApprove/registerReject/registerSync(program, client)`.

- [ ] **Step 1: failing test**
  ```ts
  // packages/cli/src/commands/decisions.test.ts
  import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
  import { mkdtempSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import { Command } from 'commander'
  import { EventLog } from '@agentos/kernel/log/eventLog'
  import { WikiService } from '@agentos/kernel/wiki/wikiService'
  import { AdapterHost } from '@agentos/kernel/adapters/adapterHost'
  import { buildServer } from '@agentos/kernel/api/server'
  import { ApiClient } from '../client.js'
  import { registerDecisions } from './decisions.js'
  import { registerApprove } from './approve.js'

  describe('cli decisions/approve', () => {
    let app: ReturnType<typeof buildServer>
    let client: ApiClient
    let log: EventLog

    beforeAll(async () => {
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      const cfg = { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1' as const, port: 0, logLevel: 'info' as const }
      log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const adapters = new AdapterHost(cfg, log, wiki, {})
      app = buildServer({ cfg, log, wiki, adapters } as any)
      await app.listen({ port: 0, host: '127.0.0.1' })
      const address = app.server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      client = new ApiClient(`http://127.0.0.1:${port}`)
    })

    afterAll(async () => { await app.close() })

    it('lists decisions and approves one', async () => {
      const decision = log.createDecision({ title: 'manual', body: 'b' })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const program = new Command()
      registerDecisions(program, client)
      registerApprove(program, client)
      await program.parseAsync(['node', 'agentos', 'decisions'])
      await program.parseAsync(['node', 'agentos', 'approve', decision.id])

      expect(logSpy.mock.calls.some((c) => String(c[0]).includes(decision.id))).toBe(true)
      const after = log.getDecision(decision.id)
      expect(after?.status).toBe('approved')
      logSpy.mockRestore()
    })
  })
  ```
  Run: `pnpm --filter @agentos/cli test` — expected failure: cannot find module `./decisions.js` / `./approve.js`.

- [ ] **Step 2: implement**
  ```ts
  // packages/cli/src/client.ts — add to the ApiClient class (alongside existing get/post helpers):
  import type { Decision, DecisionStatus } from '@agentos/shared'
  import type { SyncResult } from '@agentos/kernel/adapters/types'

  async listDecisions(status?: DecisionStatus): Promise<Decision[]> {
    return this.get<Decision[]>(`/api/decisions${status ? `?status=${status}` : ''}`)
  }
  async approveDecision(id: string): Promise<Decision> {
    return this.post<Decision>(`/api/decisions/${id}/approve`, {})
  }
  async rejectDecision(id: string): Promise<Decision> {
    return this.post<Decision>(`/api/decisions/${id}/reject`, {})
  }
  async syncProject(name: string): Promise<SyncResult> {
    return this.post<SyncResult>(`/api/projects/${name}/sync`, {})
  }
  ```
  ```ts
  // packages/cli/src/commands/decisions.ts
  import type { Command } from 'commander'
  import type { ApiClient } from '../client.js'

  export function registerDecisions(program: Command, client: ApiClient): void {
    program
      .command('decisions')
      .option('--status <status>', 'filter by status')
      .action(async (opts: { status?: string }) => {
        const decisions = await client.listDecisions(opts.status as any)
        for (const d of decisions) {
          console.log(`${d.id}  [${d.status}]  ${d.title}${d.ref ? ` (${d.ref})` : ''}`)
        }
      })
  }
  ```
  ```ts
  // packages/cli/src/commands/approve.ts
  import type { Command } from 'commander'
  import type { ApiClient } from '../client.js'

  export function registerApprove(program: Command, client: ApiClient): void {
    program.command('approve <id>').action(async (id: string) => {
      const decision = await client.approveDecision(id)
      console.log(`${decision.id}  ${decision.status}`)
    })
  }
  ```
  ```ts
  // packages/cli/src/commands/reject.ts
  import type { Command } from 'commander'
  import type { ApiClient } from '../client.js'

  export function registerReject(program: Command, client: ApiClient): void {
    program.command('reject <id>').action(async (id: string) => {
      const decision = await client.rejectDecision(id)
      console.log(`${decision.id}  ${decision.status}`)
    })
  }
  ```
  ```ts
  // packages/cli/src/commands/sync.ts
  import type { Command } from 'commander'
  import type { ApiClient } from '../client.js'

  export function registerSync(program: Command, client: ApiClient): void {
    program.command('sync <project>').action(async (project: string) => {
      const result = await client.syncProject(project)
      console.log(`added: ${result.added.length}, changed: ${result.changed.length}`)
    })
  }
  ```
  > Note for the implementer: wire `registerDecisions/registerApprove/registerReject/registerSync(program, client)` into `packages/cli/src/bin.ts` next to the existing `register*` calls from M1/M3.

  Run: `pnpm --filter @agentos/cli test` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/cli/src/client.ts packages/cli/src/commands/decisions.ts packages/cli/src/commands/approve.ts packages/cli/src/commands/reject.ts packages/cli/src/commands/sync.ts packages/cli/src/commands/decisions.test.ts
  git commit -m "$(cat <<'EOF'
  feat(cli): add decisions, approve, reject and sync commands

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 10: `examples/os-template` TechPulse project config
**Files:** `examples/os-template/os/projects/techpulse.yaml`
**Interfaces:** Consumes: `ProjectConfigSchema` (contract §3). Produces: a valid, sanitized project config.

- [ ] **Step 1: failing test**
  ```ts
  // packages/kernel/src/adapters/exampleProject.test.ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync } from 'node:fs'
  import path from 'node:path'
  import { parse as parseYaml } from 'yaml'
  import { ProjectConfigSchema } from '@agentos/shared'

  describe('examples/os-template techpulse.yaml', () => {
    it('parses as a valid ProjectConfig', () => {
      const p = path.resolve(__dirname, '../../../../../examples/os-template/os/projects/techpulse.yaml')
      const parsed = parseYaml(readFileSync(p, 'utf8'))
      const config = ProjectConfigSchema.parse(parsed)
      expect(config.adapter).toBe('techpulse-coo')
      expect(config.repo).toBe('https://github.com/ductringuyen-0618/ai-tech-news-assistant')
      expect(config.options.proposals_path).toBe('docs/missions/coo/proposals')
    })
  })
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected failure: file not found.

- [ ] **Step 2: implement**
  ```yaml
  # examples/os-template/os/projects/techpulse.yaml
  name: techpulse
  adapter: techpulse-coo
  repo: https://github.com/ductringuyen-0618/ai-tech-news-assistant
  clone: ${AGENTOS_CLONES}/techpulse
  base_branch: main
  options:
    proposals_path: docs/missions/coo/proposals
    state_path: docs/missions/coo/state.md
    reports_path: docs/missions/coo/reports
  ```
  Run: `pnpm --filter @agentos/kernel test` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add examples/os-template/os/projects/techpulse.yaml packages/kernel/src/adapters/exampleProject.test.ts
  git commit -m "$(cat <<'EOF'
  feat(examples): add techpulse project config to os-template

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Task 11: End-to-end integration test (network-free)
**Files:** `packages/adapters/src/techpulseCoo/e2e.test.ts`
**Interfaces:** Consumes: `AdapterHost`, `EventLog`, `WikiService`, `adapterRegistry` (Tasks 1–9). Produces: no new production code — proves `sync → decision → approve → push` end to end against a temp bare repo.

- [ ] **Step 1: failing test**
  ```ts
  // packages/adapters/src/techpulseCoo/e2e.test.ts
  import { describe, it, expect } from 'vitest'
  import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import path from 'node:path'
  import simpleGit from 'simple-git'
  import { EventLog } from '@agentos/kernel/log/eventLog'
  import { WikiService } from '@agentos/kernel/wiki/wikiService'
  import { AdapterHost } from '@agentos/kernel/adapters/adapterHost'
  import { adapterRegistry } from './../index.js'
  import { createTempTechpulseRepo } from './test-helpers.js'

  describe('techpulse-coo end-to-end', () => {
    it('mirrors, raises a decision, and approve pushes the flip to the bare repo', async () => {
      const { bareDir, cloneDir } = await createTempTechpulseRepo()
      const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
      mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
      writeFileSync(
        path.join(osRoot, 'projects', 'techpulse.yaml'),
        `name: techpulse\nadapter: techpulse-coo\nrepo: ${bareDir.replace(/\\/g, '/')}\nclone: ${cloneDir.replace(/\\/g, '/')}\nbase_branch: main\noptions:\n  proposals_path: docs/missions/coo/proposals\n  state_path: docs/missions/coo/state.md\n  reports_path: docs/missions/coo/reports\n`,
      )
      const cfg = { osRoot, runtimeDir: path.join(osRoot, '..', '.agentos'), dbPath: ':memory:', claudeBin: 'true', host: '127.0.0.1' as const, port: 0, logLevel: 'info' as const }
      const log = new EventLog(cfg.dbPath)
      const wiki = new WikiService(osRoot, log)
      const host = new AdapterHost(cfg, log, wiki, adapterRegistry)

      const syncResult = await host.sync('techpulse')
      expect(syncResult.added.length).toBeGreaterThan(0)

      const pending = log.listDecisions({ status: 'pending' })
      expect(pending).toHaveLength(1)

      await host.applyDecision({ ...pending[0], status: 'approved' })

      expect(log.getDecision(pending[0].id)?.status).toBe('approved')

      const verifyDir = path.join(osRoot, '..', 'verify')
      await simpleGit().clone(bareDir, verifyDir)
      const pushed = readFileSync(path.join(verifyDir, 'docs/missions/coo/proposals/001-dark-mode.md'), 'utf8')
      expect(pushed).toContain('status: approved')

      const rerun = await host.sync('techpulse')
      expect(rerun.events).toContain('proposal.changed')
      expect(log.listDecisions({ status: 'pending' })).toHaveLength(0)
    })
  })
  ```
  Run: `pnpm --filter @agentos/adapters test` — expected failure at first write (should already mostly pass given Tasks 1–7; failure here signals an integration gap, e.g. a path/type mismatch between the kernel's `AdapterHost` and `@agentos/adapters`' registry exports).

- [ ] **Step 2: fix any integration gap found**
  Apply the minimal fix surfaced by Step 1's failure (e.g., aligning the `ProjectConfig.options` cast in `adapter.ts`, or an export path in `packages/adapters/src/index.ts`) — no new abstractions, just make the already-implemented pieces agree.
  Run: `pnpm --filter @agentos/adapters test` — expected: PASS.

- [ ] **Step 3: commit**
  ```
  git add packages/adapters/src/techpulseCoo/e2e.test.ts
  git commit -m "$(cat <<'EOF'
  test(adapters): add network-free end-to-end sync/approve/push test

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

## Self-review
- **Spec §5 (adapters)** — `sync()` clones/fetches, mirrors proposals/reports/state into `raw/<project>/...` with content-hash change detection, emits `raw.added`/`proposal.changed` (Tasks 3–4); `applyDecision()` flips frontmatter, commits `chore(coo): approve|reject <slug>`, pushes, writes `output/approvals/`, calls `remember`/`wiki.writePage`, and on push failure keeps the decision resolvable as `error` with the error attached (Task 5). One deliberate deviation from spec §5.1's wording: the adapter's own `sync()` creates the Decision directly (per this milestone's explicit task brief) rather than deferring to a separate `ingest` skill — this is called out here rather than silently diverging.
- **Spec §8 (security)** — all git/file operations happen inside the adapter's own clone under `<runtimeDir>/clones/`, never touching `raw/` except via the mirror step; `raw/` is written only by `mirrorFile`, never by `applyDecision`; every commit/push is paired with a `git.commit`/`git.push` event carrying `runId` + `decisionId` (Task 5, 7).
- **Spec §9 (error handling)** — adapter/push failures never fail silently: `AdapterHost.sync`/`applyDecision` mark the `Run` `failed` with `error` set (Task 7); `applyDecision` failures also resolve the `Decision` to `error` and emit `ops.alert` (Task 5).
- **Contract §1.5** — `packages/adapters/src` matches exactly: `index.ts`, `techpulseCoo/adapter.ts`, `techpulseCoo/frontmatter.ts` (plus test-only `test-helpers.ts`, not part of the contracted surface).
- **Contract §4 AdapterHost** — constructor and method signatures match exactly; `loadProjects` does the `${AGENTOS_HOME}`/`${AGENTOS_CLONES}` expansion; `sync`/`applyDecision` both track `Run`s.
- **Contract §5 ProjectAdapter** — `sync(ctx): Promise<SyncResult>` / `applyDecision(decision, ctx): Promise<void>` implemented exactly; options typed per `{ proposals_path, state_path, reports_path }`.
- **Contract §7** — `GET /api/decisions?status=`, `POST /api/decisions/:id/approve|reject`, `POST /api/projects/:name/sync` implemented with the documented `{ error }` 4xx/5xx shape.
- **Placeholder scan** — no `TBD`/`TODO`/"similar to Task N" in any code block; every function referenced (`readStatus`, `setStatus`, `mirrorFile`, `ensureClone`, `ensureDecision`, `extractTitle`, `extractDecisionBody`, `getDecision`, `resolveRoute`, `registerDecisions/Approve/Reject/Sync`) is fully defined in the same or an earlier task.
- **Type consistency** — `Decision`, `ProjectConfig`, `SyncResult`, `AdapterContext`, `KernelConfig` all imported from `@agentos/shared` / `@agentos/kernel/adapters/types` per contract §3–§5, never redeclared.
- **Windows-friendly** — all temp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), ...))`; every temp git repo sets `user.name`/`user.email`; `path.join`/`path.basename` used throughout instead of manual `/` concatenation (except inside YAML string literals in Task 11, where forward slashes are forced via `.replace(/\\/g, '/')` since YAML/git URLs need `/`).

## Contract additions
```ts
// packages/kernel/src/log/eventLog.ts — new method on EventLog
getDecision(id: string): Decision | undefined
```
Needed because the Decisions API (contract §7) and `AdapterHost.applyDecision`'s route wiring (Task 8) must fetch a single decision by id to check its current `status` before resolving it; the contract's `EventLog` only exposed `listDecisions(opts?)`, which has no by-id filter.
