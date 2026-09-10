import path from 'node:path'
import type {
  FeatureRequestInput,
  PermissionMode,
  ProjectConfig,
} from '@agentos/shared'
import matter from 'gray-matter'
import type { AdapterHost } from '../../adapters/adapterHost.js'
import type { AdapterContext, ProjectAdapter } from '../../adapters/types.js'
import type { KernelConfig } from '../../config.js'
import { type PrChecks, getFailedJobLog, getPrChecks } from '../../github/gh.js'
import type { EventLog } from '../../log/eventLog.js'
import type { RunResult } from '../../process/processManager.js'
import type { WikiService } from '../../wiki/wikiService.js'
import { assertCloneCwdAllowed } from '../buildContainment.js'
import { slugify } from '../slug.js'
import type {
  StepRunSpec,
  WorkflowContext,
  WorkflowDefinition,
} from '../types.js'

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
export interface FeatureRequestGithub {
  getPrChecks(repo: string, number: number): Promise<PrChecks>
  getFailedJobLog(repo: string, url: string): Promise<string>
}

export interface FeatureRequestDeps {
  registry: Record<string, ProjectAdapter>
  getKernel: () => FeatureRequestKernelDeps
  /** GitHub access for the CI gate; defaults to the local gh CLI. */
  github?: FeatureRequestGithub
  /** How long the CI gate waits for checks to finish (default 30 min). */
  ciTimeoutMs?: number
  /** Polling interval for the CI gate (default 30 s). */
  ciPollMs?: number
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const CI_TIMEOUT_MS = 30 * 60 * 1000
const CI_POLL_MS = 30 * 1000
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

function requireFeatureRequestOps(
  deps: FeatureRequestDeps,
  project: ProjectConfig,
) {
  const adapter = deps.registry[project.adapter]
  if (!adapter)
    throw new Error(`no adapter registered for '${project.adapter}'`)
  if (!adapter.featureRequests) {
    throw new Error(
      `adapter '${project.adapter}' does not support feature requests`,
    )
  }
  return adapter.featureRequests
}

function adapterContext(
  kernel: FeatureRequestKernelDeps,
  project: ProjectConfig,
  runId: string,
): AdapterContext {
  return { cfg: kernel.cfg, log: kernel.log, wiki: kernel.wiki, project, runId }
}

function briefSpec(
  project: ProjectConfig,
  input: FeatureRequestInput,
  proposalPath: string,
): StepRunSpec {
  return {
    skill: 'feature-brief',
    agent: 'ops',
    // `default`, not `plan`: claude -p refuses every MCP call in plan mode,
    // and this step's only tools are the agentos syscalls listed below.
    permissionMode: 'default',
    allowedTools: [
      'mcp__agentos__get_context',
      'mcp__agentos__read_wiki',
      'mcp__agentos__remember',
    ],
    task: {
      project: project.name,
      title: input.title,
      description: input.description,
      proposalPath,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}

async function runBuildStep(
  ctx: WorkflowContext<FeatureRequestInput>,
  project: ProjectConfig,
  task: Record<string, unknown>,
  stepName: 'build' | 'build-fix' | 'build-fix-ci',
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
    throw new Error(
      `${stepName} step failed (status ${result.status}): ${result.error ?? 'no error detail'}`,
    )
  }
}

/**
 * The verdict is the first line that is exactly PASS or FAIL. The skills
 * are told to put it first, but an agent that narrates before the verdict
 * must not be read as a failure.
 */
export function parsePassFail(resultText: string | undefined): {
  pass: boolean
  text: string
} {
  const text = (resultText ?? '').trim()
  const verdict = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l === 'PASS' || l === 'FAIL')
  return { pass: verdict === 'PASS', text }
}

function extractWhatWhy(proposalBody: string): string {
  const match = /^##\s*What you get[\s\S]*?(?=\n##\s*Problem\b)/im.exec(
    proposalBody,
  )
  return (match ? match[0] : proposalBody).trim()
}

function renderSummary(
  input: FeatureRequestInput,
  info: { slug: string; branch: string; prUrl: string },
): string {
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

function renderRequestPage(
  input: FeatureRequestInput,
  info: { slug: string; branch: string; prUrl: string },
): string {
  return [
    `# ${input.title}`,
    '',
    `Shipped via ${info.branch}: ${info.prUrl}`,
    '',
    input.description.trim(),
    '',
  ].join('\n')
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
      const proposalPath = `requests/${ctx.id}/proposal.md`

      const briefRun = await ctx.step.run(
        'brief',
        briefSpec(project, ctx.input, proposalPath),
      )
      assertRunSucceeded(briefRun, 'brief')

      const proposalPage = await kernel.wiki.readPage(proposalPath)
      const { content: proposalBody } = matter(proposalPage)
      if (proposalBody.trim().length === 0) {
        throw new Error(
          `feature-brief did not write a non-empty proposal to wiki/${proposalPath}`,
        )
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
      const buildCfg = project.build

      const branch = `req/${slug}`
      const buildTask = {
        branch,
        slug,
        title: ctx.input.title,
        description: ctx.input.description,
        proposalPath,
      }

      // The project's own COO routine also builds `approved` proposals.
      // Flip this one to `building` for the duration so the two never
      // build the same feature; a failure hands it back as `approved`.
      // An arrow, not a hoisted function declaration, so TypeScript keeps
      // the `project` narrowing from the guard above inside the closure.
      const buildAndShip = async (): Promise<void> => {
        await runBuildStep(ctx, project, buildTask, 'build')

        let validateRun = await ctx.step.run(
          'validate',
          checkSpec(
            project,
            'feature-validate',
            { branch, checks: buildCfg.checks },
            'acceptEdits',
            ['Bash'],
          ),
        )
        assertRunSucceeded(validateRun, 'validate')
        let validateOutcome = parsePassFail(validateRun.resultText)

        let reviewOutcome = { pass: false, text: '' }
        if (validateOutcome.pass) {
          const reviewRun = await ctx.step.run(
            'review',
            checkSpec(
              project,
              'feature-review',
              { branch, proposalMarkdown: proposalBody },
              'default',
              ['Read', 'Glob', 'Grep'],
            ),
          )
          assertRunSucceeded(reviewRun, 'review')
          reviewOutcome = parsePassFail(reviewRun.resultText)
        }

        if (!validateOutcome.pass || !reviewOutcome.pass) {
          const failureOutput = !validateOutcome.pass
            ? validateOutcome.text
            : reviewOutcome.text
          await runBuildStep(
            ctx,
            project,
            { ...buildTask, priorFailure: failureOutput },
            'build-fix',
          )

          validateRun = await ctx.step.run(
            'validate-fix',
            checkSpec(
              project,
              'feature-validate',
              { branch, checks: buildCfg.checks },
              'acceptEdits',
              ['Bash'],
            ),
          )
          assertRunSucceeded(validateRun, 'validate-fix')
          validateOutcome = parsePassFail(validateRun.resultText)
          if (!validateOutcome.pass) {
            throw new Error(
              `validate failed after one fix attempt:\n${validateOutcome.text}`,
            )
          }

          const reviewFixRun = await ctx.step.run(
            'review-fix',
            checkSpec(
              project,
              'feature-review',
              { branch, proposalMarkdown: proposalBody },
              'default',
              ['Read', 'Glob', 'Grep'],
            ),
          )
          assertRunSucceeded(reviewFixRun, 'review-fix')
          reviewOutcome = parsePassFail(reviewFixRun.resultText)
          if (!reviewOutcome.pass) {
            throw new Error(
              `review failed after one fix attempt:\n${reviewOutcome.text}`,
            )
          }
        }

        const openPr = await ctx.step.do('open-pr', {}, () =>
          ops.openPullRequest(actx, {
            branch,
            slug,
            title: ctx.input.title,
            proposalFile: pushResult.file,
            proposalWhatWhy: extractWhatWhy(proposalBody),
            validationOutput: validateOutcome.text,
            reviewOutput: reviewOutcome.text,
          }),
        )

        // CI gate: nothing is shipped until the pull request's checks pass.
        // Local validation is necessary, never sufficient. One fix cycle is
        // allowed; a second red CI fails the request and leaves the branch
        // and PR in place for a human.
        let ciSummary = openPr.skipped
          ? `no CI: ${openPr.skipped}`
          : 'CI not run'
        if (openPr.number > 0) {
          const github = deps.github ?? {
            getPrChecks,
            getFailedJobLog,
          }
          const first = await waitForChecks(
            ctx,
            github,
            project.repo,
            openPr.number,
            deps,
            1,
          )
          if (first.failed.length > 0) {
            const log = await ctx.step.do('ci-failure-log', {}, () =>
              github.getFailedJobLog(project.repo, first.failed[0].url),
            )
            const ciFailure = [
              `CI failed on the pull request: ${first.failed.map((f) => f.name).join(', ')}`,
              log ? `\nFailing job log (tail):\n${log}` : '',
            ].join('')
            await runBuildStep(
              ctx,
              project,
              { ...buildTask, priorFailure: ciFailure },
              'build-fix-ci',
            )
            await ctx.step.do('push-fix', {}, () =>
              ops.pushBranch(actx, branch),
            )
            const second = await waitForChecks(
              ctx,
              github,
              project.repo,
              openPr.number,
              deps,
              2,
            )
            if (second.failed.length > 0) {
              throw new Error(
                `CI still failing after one fix attempt: ${second.failed.map((f) => f.name).join(', ')} (${openPr.url})`,
              )
            }
            ciSummary = `CI passed after one fix: ${second.passed.join(', ')}`
          } else {
            ciSummary = `CI passed: ${first.passed.join(', ')}`
          }
        }

        await ctx.step.do('ship', {}, async () => {
          await ops.markShipped(actx, slug, pushResult.file)
          await ops.writeReport(actx, {
            slug,
            branch,
            prUrl: openPr.url || (openPr.skipped ?? ''),
            validationOutput: `${validateOutcome.text}\n\n${ciSummary}`,
            reviewOutput: reviewOutcome.text,
          })
        })

        await ctx.step.do('done', {}, async () => {
          await kernel.wiki.writePage({
            path: `requests/${ctx.id}/summary.md`,
            content: renderSummary(ctx.input, {
              slug,
              branch,
              prUrl: openPr.url || (openPr.skipped ?? ''),
            }),
            op: 'note',
          })
          await kernel.wiki.writePage({
            path: `projects/${project.name}/requests/${slug}.md`,
            content: renderRequestPage(ctx.input, {
              slug,
              branch,
              prUrl: openPr.url || (openPr.skipped ?? ''),
            }),
            op: 'note',
            links: [pushResult.file],
          })
        })
      }

      // The project's own COO routine also builds `approved` proposals.
      // Flip this one to `building` for the duration so the two never
      // build the same feature; a failure hands it back as `approved`.
      await ctx.step.do('mark-building', {}, () =>
        ops.setProposalStatus(actx, slug, pushResult.file, 'building'),
      )
      try {
        await buildAndShip()
      } catch (err) {
        await ctx.step.do('unmark-building', {}, () =>
          ops.setProposalStatus(actx, slug, pushResult.file, 'approved'),
        )
        throw err
      }
    },
  }
}

/**
 * Polls the pull request's checks until none is pending, sleeping between
 * polls through the engine so a restart resumes the wait instead of
 * restarting it. Returns the final check state; throws on timeout.
 */
async function waitForChecks(
  ctx: WorkflowContext<FeatureRequestInput>,
  github: FeatureRequestGithub,
  repo: string,
  number: number,
  deps: FeatureRequestDeps,
  round: number,
): Promise<PrChecks> {
  const timeoutMs = deps.ciTimeoutMs ?? CI_TIMEOUT_MS
  const pollMs = deps.ciPollMs ?? CI_POLL_MS
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / pollMs))
  for (let i = 1; i <= maxPolls; i++) {
    const checks = await ctx.step.do(`ci-${round}-poll-${i}`, {}, () =>
      github.getPrChecks(repo, number),
    )
    ctx.emit('workflow.ci', {
      round,
      poll: i,
      pending: checks.pending,
      failed: checks.failed.map((f) => f.name),
      passed: checks.passed,
    })
    if (checks.pending.length === 0) return checks
    if (i < maxPolls) await ctx.step.sleep(`ci-${round}-sleep-${i}`, pollMs)
  }
  throw new Error(
    `CI did not finish within ${Math.round(timeoutMs / 60000)} minutes`,
  )
}

function hasProjectField(input: unknown): input is { project: string } {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { project?: unknown }).project === 'string'
  )
}

/**
 * Builds the `cwdPolicy` function the workflow engine calls (W1's
 * `WorkflowRuntimeDeps.cwdPolicy`, per team-lead ruling) before spawning
 * any `step.run` whose `cwd` is outside `agents/<agent>/workspace`. This
 * is deliberately synchronous -- `getCachedProjects` (Task 2) reads
 * `AdapterHost`'s last `loadProjects()` result rather than re-reading
 * `os/projects/*.yaml`, because the engine's hook cannot `await` a fresh
 * lookup at spawn time. `run()` above always calls (indirectly, via
 * `kernel.adapters.loadProjects()`) a fresh load before any step that
 * could trigger this policy, so the cache is never stale for a check made
 * during that same instance's execution. Only `feature-request`'s own
 * `StepRunSpec`s ever set a non-workspace `cwd`; any other workflow
 * kind's `input` without a `project: string` field is rejected outright
 * by `assertCloneCwdAllowed`'s "no project" branch.
 */
export function createFeatureRequestCwdPolicy(
  osRoot: string,
  getCachedProjects: () => ProjectConfig[],
): (cwd: string, spec: StepRunSpec, input: unknown) => void {
  return (cwd, spec, input) => {
    const projectName = hasProjectField(input) ? input.project : undefined
    const project = projectName
      ? getCachedProjects().find((p) => p.name === projectName)
      : undefined
    assertCloneCwdAllowed({ cwd, osRoot, agent: spec.agent, project })
  }
}
