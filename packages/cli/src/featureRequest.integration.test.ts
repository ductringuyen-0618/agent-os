import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { adapterRegistry } from '@agentos/adapters'
// Lives in the CLI package on purpose: it exercises the real techpulse-coo
// adapter against the kernel's feature-request definition, and the CLI is
// the one package that legitimately depends on both. Keeping it inside the
// kernel would make the kernel depend on adapters and break the build order.
import {
  EventLog,
  type FeatureRequestDeps,
  type FeatureRequestKernelDeps,
  type ProjectAdapter,
  type RunResult,
  WikiService,
  createFeatureRequestCwdPolicy,
  createFeatureRequestWorkflow,
  parsePassFail,
} from '@agentos/kernel'
import type { FeatureRequestInput, ProjectConfig } from '@agentos/shared'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @agentos/adapters is built against @agentos/kernel's PUBLISHED (dist)
// type declarations; this file, compiled as part of @agentos/kernel
// itself, sees the same interfaces via their internal src/ declaration
// sites instead. EventLog/WikiService each carry a private field, so
// TypeScript treats the two declaration sites as nominally distinct even
// though they're structurally identical -- a cross-package boundary
// quirk of the test-only devDependency (see the plan's Global
// Constraints), not a runtime bug. Bridge it with one narrow cast where
// adapterRegistry crosses that boundary.
const registry = adapterRegistry as unknown as Record<string, ProjectAdapter>

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
  mkdirSync(path.join(seedDir, 'docs/missions/coo/proposals'), {
    recursive: true,
  })
  mkdirSync(path.join(seedDir, 'docs/missions/coo/reports'), {
    recursive: true,
  })
  writeFileSync(path.join(seedDir, 'docs/missions/coo/proposals/.gitkeep'), '')
  writeFileSync(path.join(seedDir, 'docs/missions/coo/reports/.gitkeep'), '')
  writeFileSync(
    path.join(seedDir, 'docs/missions/coo/state.md'),
    '# COO state\n\nAll quiet.\n',
  )
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
    repo: 'https://github.com/owner/sandbox.git',
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
  const waitForEventCalls: Array<{
    name: string
    eventType: string
    opts: unknown
  }> = []
  return {
    runCalls,
    waitForEventCalls,
    step: {
      do: async <T>(_name: string, _opts: unknown, fn: () => Promise<T>) =>
        fn(),
      sleep: async () => {},
      waitForEvent: async <T = Record<string, unknown>>(
        name: string,
        eventType: string,
        opts: unknown,
      ): Promise<T> => {
        waitForEventCalls.push({ name, eventType, opts })
        return {} as T
      },
      run: async (
        name: string,
        spec: { task?: Record<string, unknown>; cwd?: string },
      ) => {
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
        if (name === 'build' || name === 'build-fix') {
          // Simulates what the real feature-build skill does in the
          // project's clone: create (or resume) payload.branch and commit.
          // step.run itself has no filesystem access in this stub, so the
          // git side effect has to happen here for the later validate/
          // review/open-pr steps' real git operations (pushing the branch)
          // to have something to push.
          const branch = spec.task?.branch as string
          const cwd = spec.cwd as string
          const git = simpleGit(cwd)
          const branches = await git.branchLocal()
          if (branches.all.includes(branch)) {
            await git.checkout(branch)
          } else {
            await git.checkoutLocalBranch(branch)
          }
          const fs = await import('node:fs/promises')
          await fs.writeFile(
            path.join(cwd, `CHANGED-${name}.md`),
            `change from ${name}\n`,
            'utf8',
          )
          await git.add('.')
          await git.commit(`feat: ${name} change`)
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
      // Delegates to the real techpulseCooAdapter.sync (not a plain stub)
      // so that a pushed 'proposed' proposal actually raises a pending
      // Decision through the same ensureDecision path production code
      // takes -- the "waits on decision.resolved" test below needs a real
      // decision.ref to match against.
      sync: async (name: string) => {
        syncCalls.push(name)
        const projects = await kernelDeps.adapters.loadProjects()
        const proj = projects.find((p) => p.name === name)
        if (!proj) throw new Error(`unknown project '${name}'`)
        const adapter = registry[proj.adapter]
        return adapter.sync({ cfg: kernelDeps.cfg, log, wiki, project: proj })
      },
    },
  }
  deps = { registry, getKernel: () => kernelDeps }
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
    const files = await fs.readdir(
      path.join(verifyDir, 'docs/missions/coo/proposals'),
    )
    const proposalFile = files.find((f) => f.endsWith('.md'))
    expect(proposalFile).toBeTruthy()
    const content = await fs.readFile(
      path.join(
        verifyDir,
        'docs/missions/coo/proposals',
        proposalFile as string,
      ),
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
    const match = (waitForEventCalls[0].opts as any).match as (
      e: unknown,
    ) => boolean
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
      "#!/usr/bin/env node\nconsole.log('https://github.com/owner/sandbox/pull/7')\nprocess.exit(0)\n",
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
      if (originalGhBin === undefined) {
        // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
        delete process.env.AGENTOS_GH_BIN
      } else {
        process.env.AGENTOS_GH_BIN = originalGhBin
      }
    }

    expect(runCalls.map((c) => c.name)).toEqual([
      'brief',
      'build',
      'validate',
      'review',
    ])

    const summary = await wiki.readPage('requests/wf-3/summary.md')
    expect(summary).toContain('pull request')
    const requestPage = await wiki.readPage(
      'projects/sandbox/requests/add-dark-mode-toggle.md',
    )
    expect(requestPage).toContain('https://github.com/owner/sandbox/pull/7')

    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-fr-verify2-'))
    await simpleGit().clone(bareDir, verifyDir)
    const branches = await simpleGit(verifyDir).branch(['-r'])
    expect(branches.all).toContain('origin/req/add-dark-mode-toggle')
    const fs = await import('node:fs/promises')
    const files = await fs.readdir(
      path.join(verifyDir, 'docs/missions/coo/proposals'),
    )
    const proposalFile = files.find((f) => f.endsWith('.md'))
    const content = await fs.readFile(
      path.join(
        verifyDir,
        'docs/missions/coo/proposals',
        proposalFile as string,
      ),
      'utf8',
    )
    expect(content).toContain('status: shipped')
    expect(
      await fs.readFile(
        path.join(
          verifyDir,
          'docs/missions/coo/reports/add-dark-mode-toggle.md',
        ),
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
    wf(
      ghScript,
      "#!/usr/bin/env node\nconsole.log('https://github.com/owner/sandbox/pull/9')\nprocess.exit(0)\n",
      'utf8',
    )
    chmodSync(ghScript, 0o755)
    const originalGhBin = process.env.AGENTOS_GH_BIN
    process.env.AGENTOS_GH_BIN = ghScript

    const def = createFeatureRequestWorkflow(deps)
    const { step, runCalls } = fakeStep(wiki, {
      validate: {
        status: 'success',
        resultText: 'FAIL\ntypecheck failed on Foo.ts',
      },
      'validate-fix': {
        status: 'success',
        resultText: 'PASS\nall checks green',
      },
      'review-fix': { status: 'success', resultText: 'PASS\nlooks good' },
    })
    const input: FeatureRequestInput = {
      project: 'sandbox',
      title: 'Fix thing',
      description: 'desc',
      autoApprove: true,
    }

    try {
      await def.run({ id: 'wf-4', input, state: {}, step, emit: vi.fn() })
    } finally {
      if (originalGhBin === undefined) {
        // biome-ignore lint/performance/noDelete: assigning undefined would stringify to "undefined"
        delete process.env.AGENTOS_GH_BIN
      } else {
        process.env.AGENTOS_GH_BIN = originalGhBin
      }
    }

    expect(runCalls.map((c) => c.name)).toEqual([
      'brief',
      'build',
      'validate',
      'build-fix',
      'validate-fix',
      'review-fix',
    ])
    const buildFixCall = runCalls.find((c) => c.name === 'build-fix')
    // biome-ignore lint/suspicious/noExplicitAny: reading the injected task back
    expect((buildFixCall?.spec as any).task.priorFailure).toContain(
      'typecheck failed on Foo.ts',
    )
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
      project: 'sandbox',
      title: 'Fix thing',
      description: 'desc',
      autoApprove: true,
    }

    await expect(
      def.run({ id: 'wf-5', input, state: {}, step, emit: vi.fn() }),
    ).rejects.toThrow(/validate failed after one fix attempt/)
    expect(runCalls.map((c) => c.name)).toEqual([
      'brief',
      'build',
      'validate',
      'build-fix',
      'validate-fix',
    ])
  })
})

describe('createFeatureRequestCwdPolicy', () => {
  const cwdOsRoot = path.join('fake', 'os')
  const workspace = path.join(cwdOsRoot, 'agents', 'ops', 'workspace')
  const buildEnabledProject: ProjectConfig = {
    name: 'sandbox',
    adapter: 'techpulse-coo',
    repo: 'https://github.com/owner/sandbox.git',
    clone: path.join('fake', 'clones', 'sandbox'),
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

  it('allows the default workspace cwd with no project lookup at all', () => {
    const policy = createFeatureRequestCwdPolicy(cwdOsRoot, () => [])
    expect(() =>
      policy(
        workspace,
        { skill: 'feature-build', agent: 'ops' },
        { project: 'sandbox' },
      ),
    ).not.toThrow()
  })

  it("allows a non-workspace cwd matching the named project's clone when build.enabled", () => {
    const policy = createFeatureRequestCwdPolicy(cwdOsRoot, () => [
      buildEnabledProject,
    ])
    expect(() =>
      policy(
        buildEnabledProject.clone,
        { skill: 'feature-build', agent: 'ops' },
        { project: 'sandbox' },
      ),
    ).not.toThrow()
  })

  it('rejects a non-workspace cwd when input has no project field', () => {
    const policy = createFeatureRequestCwdPolicy(cwdOsRoot, () => [
      buildEnabledProject,
    ])
    expect(() =>
      policy(
        buildEnabledProject.clone,
        { skill: 'feature-build', agent: 'ops' },
        {},
      ),
    ).toThrow()
  })

  it('rejects a non-workspace cwd when the named project is not in the cache', () => {
    const policy = createFeatureRequestCwdPolicy(cwdOsRoot, () => [])
    expect(() =>
      policy(
        buildEnabledProject.clone,
        { skill: 'feature-build', agent: 'ops' },
        { project: 'sandbox' },
      ),
    ).toThrow()
  })

  it("rejects a cwd that is not exactly the named project's clone", () => {
    const policy = createFeatureRequestCwdPolicy(cwdOsRoot, () => [
      buildEnabledProject,
    ])
    expect(() =>
      policy(
        path.join('fake', 'somewhere', 'else'),
        { skill: 'feature-build', agent: 'ops' },
        { project: 'sandbox' },
      ),
    ).toThrow(/must be exactly/)
  })
})

describe('parsePassFail', () => {
  it('takes the first PASS/FAIL line even after narration', () => {
    const nl = String.fromCharCode(10)
    expect(parsePassFail(['PASS', 'all good'].join(nl)).pass).toBe(true)
    expect(
      parsePassFail(
        ['Already on the branch.', '', 'PASS', '', 'checks: none'].join(nl),
      ).pass,
    ).toBe(true)
    expect(
      parsePassFail(['FAIL', '- README.md:1 remove the header'].join(nl)).pass,
    ).toBe(false)
    expect(parsePassFail('I ran things and they passed').pass).toBe(false)
    expect(parsePassFail(undefined).pass).toBe(false)
  })
})
