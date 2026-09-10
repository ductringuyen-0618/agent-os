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
 *
 * Silence has a policy too: a decision nobody has made after 3 and again
 * after 6 days gets a reminder comment on its issue (GitHub emails it), and
 * after 7 days it expires -- the proposal is marked `expired` in the repo,
 * the issue closes, and the project's COO is free to propose something
 * else. Every reminder carries a marker so the cloud COO, which follows the
 * same protocol, and this sync never post the same one twice.
 */

export const DECISION_LABEL = 'agentos:decision'
export const APPROVE_LABEL = 'agentos:approve'
export const REJECT_LABEL = 'agentos:reject'
/** Days of silence after which a reminder is posted, in order. */
export const NUDGE_AFTER_DAYS: readonly number[] = [3, 6]
/** Days of silence after which a pending decision expires. */
export const EXPIRE_AFTER_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const MARKER = /<!--\s*agentos:decision\s+([^>]*?)\s*-->/

export type Verdict = 'approved' | 'rejected' | 'expired'

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
  commentIssue(repo: string, number: number, body: string): Promise<void>
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
  async commentIssue(repo, number, body) {
    await ghInvoke([
      'issue',
      'comment',
      String(number),
      '--repo',
      repo,
      '--body',
      body,
    ])
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

/**
 * The hidden marker names the decision and its proposal. agent-os writes
 * `id=<decisionId> ref=<proposal ref>`; the cloud COO, which knows no
 * decision ids, writes `ref=<proposal ref>` only; a bare token is a legacy
 * decision id. Matching by ref is what lets both sides share one issue.
 */
export function issueMarker(issue: GithubIssue): { id?: string; ref?: string } {
  const raw = MARKER.exec(issue.body ?? '')?.[1]
  if (!raw) return {}
  const out: { id?: string; ref?: string } = {}
  for (const token of raw.split(/\s+/)) {
    if (token.startsWith('id=')) out.id = token.slice(3)
    else if (token.startsWith('ref=')) out.ref = token.slice(4)
    else if (!out.id && /^[\w-]+$/.test(token)) out.id = token
  }
  return out
}

export function decisionIdOf(issue: GithubIssue): string | undefined {
  return issueMarker(issue).id
}

export function issueBody(decision: Decision, project: string): string {
  return [
    `<!-- agentos:decision id=${decision.id} ref=${decision.ref ?? ''} -->`,
    `agent-os is waiting for your decision on **${project}**.`,
    '',
    '**To decide from here:** add the label `agentos:approve` or `agentos:reject`,',
    'or reply with a comment that is just `approve` or `reject`. agent-os picks',
    'it up on its next sync (hourly), rewrites the proposal, closes this issue,',
    'and an approval is built on the next COO fire. Any other comment is ignored.',
    `Undecided after ${EXPIRE_AFTER_DAYS} days, it expires and a different idea takes its place.`,
    '',
    '---',
    '',
    decision.body,
  ].join('\n')
}

/** Hidden marker on the n-th reminder comment; both sides look for it before posting. */
export function nudgeMarker(n: number): string {
  return `<!-- agentos:nudge n=${n} -->`
}

export function nudgeBody(
  decision: Decision,
  n: number,
  daysLeft: number,
): string {
  const when =
    daysLeft <= 1 ? 'It expires tomorrow' : `It expires in ${daysLeft} days`
  return [
    nudgeMarker(n),
    `Still waiting on your decision for **${decision.title}**. ${when} unless you`,
    'add the label `agentos:approve` / `agentos:reject` or reply `approve` / `reject`.',
    '',
    '---',
    '',
    decision.body,
  ].join('\n')
}

export function hasNudge(issue: GithubIssue, n: number): boolean {
  const marker = nudgeMarker(n)
  return issue.comments.some((c) => c.body?.includes(marker))
}

/** Whole days since the decision was raised. */
export function ageDays(decision: Decision, now: number): number {
  const created = Date.parse(decision.createdAt)
  if (Number.isNaN(created)) return 0
  return Math.floor((now - created) / DAY_MS)
}

/** Which reminders are due for a decision this old and not yet posted. */
export function dueNudges(issue: GithubIssue, age: number): number[] {
  const due: number[] = []
  NUDGE_AFTER_DAYS.forEach((days, i) => {
    const n = i + 1
    if (age >= days && !hasNudge(issue, n)) due.push(n)
  })
  return due
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
  resolved: Array<{ decisionId: string; status: Verdict }>
  closed: number[]
  /** Reminder comments posted this pass, by issue and reminder number. */
  nudged: Array<{ issue: number; n: number }>
}

function isGithub(repo: string): boolean {
  return /github\.com[/:]/.test(repo)
}

function emptyOutcome(): GithubDecisionOutcome {
  return { opened: [], resolved: [], closed: [], nudged: [] }
}

function expiryComment(): string {
  return `No decision in ${EXPIRE_AFTER_DAYS} days: expired. agent-os keeps this idea on file so it is not proposed again, and proposes something different next. To bring it back, edit the proposal's status to \`proposed\` on main.`
}

/**
 * One pass, called from sync: open issues for pending decisions that have
 * none, resolve decisions whose issue carries a verdict, remind about and
 * expire the ones nobody decides, close issues whose decision was resolved
 * elsewhere (the dashboard, a status edit). `apply` performs the
 * resolution the same way the dashboard does. Expiry does not need GitHub,
 * so a project on any other remote still gets it.
 */
export async function reconcileGithubDecisions(
  ctx: AdapterContext,
  apply: (decision: Decision, status: Verdict) => Promise<void>,
  port: GithubDecisionPort = ghDecisionPort,
  now: number = Date.now(),
): Promise<GithubDecisionOutcome> {
  const outcome = emptyOutcome()
  const mine = ctx.log
    .listDecisions()
    .filter((d) => d.project === ctx.project.name && d.ref)
  if (mine.length === 0) return outcome

  const expire = async (decision: Decision): Promise<void> => {
    await apply(decision, 'expired')
    outcome.resolved.push({ decisionId: decision.id, status: 'expired' })
    ctx.log.append({
      type: 'custom.decision.expired',
      runId: ctx.runId,
      payload: {
        decisionId: decision.id,
        ref: decision.ref,
        ageDays: ageDays(decision, now),
      },
    })
  }

  if (!isGithub(ctx.project.repo)) {
    for (const decision of mine) {
      if (
        decision.status === 'pending' &&
        ageDays(decision, now) >= EXPIRE_AFTER_DAYS
      )
        await expire(decision)
    }
    return outcome
  }
  const repo = repoSlug(ctx.project.repo)
  const owner = repo.split('/')[0]

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
  const byRef = new Map<string, GithubIssue>()
  for (const issue of issues) {
    const marker = issueMarker(issue)
    if (marker.id) byDecision.set(marker.id, issue)
    // Prefer an open issue per ref: a closed one from an earlier decision
    // on the same file must not hide a fresh one.
    if (marker.ref) {
      const existing = byRef.get(marker.ref)
      if (!existing || issue.state.toUpperCase() === 'OPEN')
        byRef.set(marker.ref, issue)
    }
  }

  for (const decision of mine) {
    const issue =
      byDecision.get(decision.id) ??
      (decision.ref ? byRef.get(decision.ref) : undefined)
    const age = ageDays(decision, now)
    if (decision.status === 'pending' && !issue) {
      if (age >= EXPIRE_AFTER_DAYS) {
        await expire(decision)
        continue
      }
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
      if (verdict) {
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
        continue
      }
      if (age >= EXPIRE_AFTER_DAYS) {
        await expire(decision)
        await port.closeIssue(repo, issue.number, expiryComment())
        outcome.closed.push(issue.number)
        continue
      }
      for (const n of dueNudges(issue, age)) {
        await port.commentIssue(
          repo,
          issue.number,
          nudgeBody(decision, n, EXPIRE_AFTER_DAYS - age),
        )
        outcome.nudged.push({ issue: issue.number, n })
        ctx.log.append({
          type: 'custom.decision.nudge',
          runId: ctx.runId,
          payload: { decisionId: decision.id, issue: issue.number, n },
        })
      }
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
