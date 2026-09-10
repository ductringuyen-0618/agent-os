import type { AdapterContext } from '@agentos/kernel/adapters/types'
import { repoSlug } from '@agentos/kernel/github/gh'
import type { Decision } from '@agentos/shared'
import { ghInvoke } from './requests.js'

/**
 * Decisions on GitHub: every pending decision of a project gets one issue
 * in the project's repo, and a label or a one-word comment on that issue
 * resolves it. Nothing here needs the dashboard, a tunnel, or any inbound
 * connection: the daemon polls GitHub on every sync, and the human decides
 * from the GitHub app with their own login.
 */

export const DECISION_LABEL = 'agentos:decision'
export const APPROVE_LABEL = 'agentos:approve'
export const REJECT_LABEL = 'agentos:reject'
const MARKER = /<!--\s*agentos:decision\s+([\w-]+)\s*-->/

export interface GithubIssue {
  number: number
  title: string
  body: string
  state: string
  labels: Array<{ name: string }>
  comments: Array<{ author: { login: string }; body: string }>
}

export interface GithubDecisionPort {
  listIssues(repo: string): Promise<GithubIssue[]>
  createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[],
  ): Promise<number>
  closeIssue(repo: string, number: number, comment: string): Promise<void>
  ensureLabels(repo: string): Promise<void>
}

/** The real port, over the gh CLI. */
export const ghDecisionPort: GithubDecisionPort = {
  async listIssues(repo) {
    const result = await ghInvoke([
      'issue',
      'list',
      '--repo',
      repo,
      '--label',
      DECISION_LABEL,
      '--state',
      'all',
      '--limit',
      '100',
      '--json',
      'number,title,body,state,labels,comments',
    ])
    return JSON.parse(result.stdout || '[]') as GithubIssue[]
  },
  async createIssue(repo, title, body, labels) {
    const result = await ghInvoke([
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      title,
      '--body',
      body,
      ...labels.flatMap((l) => ['--label', l]),
    ])
    const url = result.stdout.trim().split('\n').pop() ?? ''
    const m = /\/issues\/(\d+)/.exec(url)
    return m ? Number(m[1]) : 0
  },
  async closeIssue(repo, number, comment) {
    await ghInvoke([
      'issue',
      'close',
      String(number),
      '--repo',
      repo,
      '--comment',
      comment,
    ])
  },
  async ensureLabels(repo) {
    const labels: Array<[string, string, string]> = [
      [DECISION_LABEL, '5319e7', 'agent-os is waiting for a decision'],
      [APPROVE_LABEL, '0e8a16', 'add to approve the decision'],
      [REJECT_LABEL, 'b60205', 'add to reject the decision'],
    ]
    for (const [name, color, description] of labels) {
      await ghInvoke([
        'label',
        'create',
        name,
        '--repo',
        repo,
        '--color',
        color,
        '--description',
        description,
        '--force',
      ])
    }
  },
}

export function decisionIdOf(issue: GithubIssue): string | undefined {
  return MARKER.exec(issue.body ?? '')?.[1]
}

export function issueBody(decision: Decision, project: string): string {
  return [
    `<!-- agentos:decision ${decision.id} -->`,
    `agent-os is waiting for your decision on **${project}**.`,
    '',
    '**To decide from here:** add the label `agentos:approve` or `agentos:reject`,',
    'or reply with a comment that is just `approve` or `reject`. agent-os picks',
    'it up on its next sync (hourly), rewrites the proposal, closes this issue,',
    'and an approval is built on the next COO fire. Any other comment is ignored.',
    '',
    '---',
    '',
    decision.body,
  ].join('\n')
}

const YES = /^\s*(approve|approved|yes|lgtm|ship it)\b/i
const NO = /^\s*(reject|rejected|no|decline)\b/i

/**
 * What an issue says the human decided, if anything. Labels count from
 * anyone who can set them (a collaborator); a comment counts only from
 * the repo owner, since anyone can comment on a public repo.
 */
export function verdictOf(
  issue: GithubIssue,
  owner: string,
): 'approved' | 'rejected' | undefined {
  const names = new Set(issue.labels.map((l) => l.name))
  if (names.has(APPROVE_LABEL)) return 'approved'
  if (names.has(REJECT_LABEL)) return 'rejected'
  for (const c of issue.comments) {
    if (c.author?.login?.toLowerCase() !== owner.toLowerCase()) continue
    if (YES.test(c.body)) return 'approved'
    if (NO.test(c.body)) return 'rejected'
  }
  return undefined
}

export interface GithubDecisionOutcome {
  opened: number[]
  resolved: Array<{ decisionId: string; status: 'approved' | 'rejected' }>
  closed: number[]
}

function isGithub(repo: string): boolean {
  return /github\.com[/:]/.test(repo)
}

/**
 * One pass, called from sync: open issues for pending decisions that have
 * none, resolve decisions whose issue carries a verdict, close issues whose
 * decision was resolved elsewhere (the dashboard, a status edit).
 * `apply` performs the resolution the same way the dashboard does.
 */
export async function reconcileGithubDecisions(
  ctx: AdapterContext,
  apply: (decision: Decision, status: 'approved' | 'rejected') => Promise<void>,
  port: GithubDecisionPort = ghDecisionPort,
): Promise<GithubDecisionOutcome> {
  const outcome: GithubDecisionOutcome = {
    opened: [],
    resolved: [],
    closed: [],
  }
  if (!isGithub(ctx.project.repo)) return outcome
  const repo = repoSlug(ctx.project.repo)
  const owner = repo.split('/')[0]
  const mine = ctx.log
    .listDecisions()
    .filter((d) => d.project === ctx.project.name && d.ref)

  if (mine.length === 0) return outcome

  let issues: GithubIssue[]
  try {
    // Labels first: listing by a label that does not exist yet is an error.
    await port.ensureLabels(repo)
    issues = await port.listIssues(repo)
  } catch (err) {
    ctx.log.append({
      type: 'ops.alert',
      runId: ctx.runId,
      payload: {
        project: ctx.project.name,
        error: `github decisions: ${err instanceof Error ? err.message : String(err)}`,
      },
    })
    return outcome
  }
  const byDecision = new Map<string, GithubIssue>()
  for (const issue of issues) {
    const id = decisionIdOf(issue)
    if (id) byDecision.set(id, issue)
  }

  for (const decision of mine) {
    const issue = byDecision.get(decision.id)
    if (decision.status === 'pending' && !issue) {
      const number = await port.createIssue(
        repo,
        `Decide: ${decision.title}`,
        issueBody(decision, ctx.project.name),
        [DECISION_LABEL],
      )
      outcome.opened.push(number)
      ctx.log.append({
        type: 'custom.decision.issue',
        runId: ctx.runId,
        payload: { decisionId: decision.id, issue: number, repo },
      })
      continue
    }
    if (!issue || issue.state.toUpperCase() !== 'OPEN') continue
    if (decision.status === 'pending') {
      const verdict = verdictOf(issue, owner)
      if (!verdict) continue
      await apply(decision, verdict)
      outcome.resolved.push({ decisionId: decision.id, status: verdict })
      await port.closeIssue(
        repo,
        issue.number,
        verdict === 'approved'
          ? 'Approved via GitHub. agent-os rewrote the proposal to `approved`; the build starts on the next COO fire.'
          : 'Rejected via GitHub. agent-os rewrote the proposal to `rejected`.',
      )
      outcome.closed.push(issue.number)
    } else {
      await port.closeIssue(
        repo,
        issue.number,
        `Decided elsewhere: ${decision.status}. Closing.`,
      )
      outcome.closed.push(issue.number)
    }
  }
  return outcome
}
