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
export interface FeatureRequestDeps {
  registry: Record<string, ProjectAdapter>
  getKernel: () => FeatureRequestKernelDeps
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
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
    permissionMode: 'plan',
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
    throw new Error(
      `${stepName} step failed (status ${result.status}): ${result.error ?? 'no error detail'}`,
    )
  }
}

function parsePassFail(resultText: string | undefined): {
  pass: boolean
  text: string
} {
  const text = (resultText ?? '').trim()
  const firstLine = text.split('\n', 1)[0]?.trim().toUpperCase()
  return { pass: firstLine === 'PASS', text }
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
      const proposalPath = `output/requests/${ctx.id}/proposal.md`

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

      const branch = `req/${slug}`
      const buildTask = {
        branch,
        slug,
        title: ctx.input.title,
        description: ctx.input.description,
        proposalPath,
      }
      await runBuildStep(ctx, project, buildTask, 'build')

      let validateRun = await ctx.step.run(
        'validate',
        checkSpec(
          project,
          'feature-validate',
          { branch, checks: project.build.checks },
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
            'plan',
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
            { branch, checks: project.build.checks },
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
            'plan',
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
          slug,
          branch,
          prUrl: pr.url,
          validationOutput: validateOutcome.text,
          reviewOutput: reviewOutcome.text,
        })
        return pr
      })

      await ctx.step.do('done', {}, async () => {
        await kernel.wiki.writePage({
          path: `output/requests/${ctx.id}/summary.md`,
          content: renderSummary(ctx.input, {
            slug,
            branch,
            prUrl: openPr.url,
          }),
          op: 'note',
        })
        await kernel.wiki.writePage({
          path: `projects/${project.name}/requests/${slug}.md`,
          content: renderRequestPage(ctx.input, {
            slug,
            branch,
            prUrl: openPr.url,
          }),
          op: 'note',
          links: [pushResult.file],
        })
      })
    },
  }
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
