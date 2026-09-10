import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AdapterContext } from '@agentos/kernel/adapters/types'
import type { Decision } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import {
  APPROVE_LABEL,
  DECISION_LABEL,
  type GithubDecisionPort,
  type GithubIssue,
  REJECT_LABEL,
  decisionIdOf,
  issueBody,
  issueMarker,
  reconcileGithubDecisions,
  verdictOf,
} from './decisions.js'

function decision(
  id: string,
  status: Decision['status'] = 'pending',
): Decision {
  return {
    id,
    title: `Idea ${id}`,
    body: '## What you get\nA thing.',
    status,
    project: 'techpulse',
    adapter: 'techpulse-coo',
    ref: `proposals/00${id.slice(-1)}-idea.md`,
    createdAt: '2026-09-10T00:00:00Z',
  }
}

function issue(
  number: number,
  decisionId: string,
  extra: Partial<GithubIssue> = {},
): GithubIssue {
  return {
    number,
    title: `Decide: Idea ${decisionId}`,
    body: `<!-- agentos:decision ${decisionId} -->\nbody`,
    state: 'OPEN',
    labels: [{ name: DECISION_LABEL }],
    comments: [],
    ...extra,
  }
}

function makeCtx(
  decisions: Decision[],
  repo = 'https://github.com/octo/tp.git',
) {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = []
  const ctx = {
    cfg: {
      osRoot: mkdtempSync(path.join(tmpdir(), 'agentos-dec-')),
      runtimeDir: 'unused',
      dbPath: ':memory:',
      claudeBin: 'true',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'info',
    },
    log: {
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
      append: (e: any) => {
        events.push(e)
        return { id: events.length, ts: '', ...e }
      },
      listDecisions: () => decisions,
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub for EventLog
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: not exercised
    wiki: {} as any,
    project: {
      name: 'techpulse',
      adapter: 'techpulse-coo',
      repo,
      clone: '/clones/techpulse',
      base_branch: 'main',
      options: {},
    },
    runId: 'run-1',
  } satisfies AdapterContext
  return { ctx, events }
}

function fakePort(issues: GithubIssue[]) {
  const calls: string[] = []
  const port: GithubDecisionPort = {
    listIssues: async () => issues,
    createIssue: async (_repo, title, body, labels) => {
      calls.push(`create ${title} [${labels.join(',')}]`)
      expect(body).toContain('<!-- agentos:decision')
      return 41
    },
    closeIssue: async (_repo, number, comment) => {
      calls.push(`close #${number}: ${comment.split('.')[0]}`)
    },
    ensureLabels: async () => {
      calls.push('labels')
    },
  }
  return { port, calls }
}

describe('verdictOf', () => {
  it('reads labels from anyone and one-word comments from the owner only', () => {
    expect(
      verdictOf(issue(1, 'd1', { labels: [{ name: APPROVE_LABEL }] }), 'octo'),
    ).toBe('approved')
    expect(
      verdictOf(issue(1, 'd1', { labels: [{ name: REJECT_LABEL }] }), 'octo'),
    ).toBe('rejected')
    expect(
      verdictOf(
        issue(1, 'd1', {
          comments: [{ author: { login: 'Octo' }, body: 'Approve, ship it' }],
        }),
        'octo',
      ),
    ).toBe('approved')
    expect(
      verdictOf(
        issue(1, 'd1', {
          comments: [{ author: { login: 'stranger' }, body: 'approve' }],
        }),
        'octo',
      ),
    ).toBeUndefined()
    expect(
      verdictOf(
        issue(1, 'd1', {
          comments: [{ author: { login: 'octo' }, body: 'looks interesting' }],
        }),
        'octo',
      ),
    ).toBeUndefined()
  })
})

describe('issueBody / issueMarker', () => {
  it('round-trips the decision id and proposal ref through the hidden marker', () => {
    const body = issueBody(decision('d7'), 'techpulse')
    expect(decisionIdOf({ ...issue(1, 'x'), body })).toBe('d7')
    expect(issueMarker({ ...issue(1, 'x'), body })).toEqual({
      id: 'd7',
      ref: 'proposals/007-idea.md',
    })
    expect(body).toContain('agentos:approve')
  })
  it('reads a cloud-written ref-only marker and a legacy bare id', () => {
    expect(
      issueMarker({
        ...issue(1, 'x'),
        body: '<!-- agentos:decision ref=proposals/003-x.md -->
hi',
      }),
    ).toEqual({ ref: 'proposals/003-x.md' })
    expect(issueMarker(issue(1, 'legacy'))).toEqual({ id: 'legacy' })
  })
})

describe('reconcileGithubDecisions', () => {
  it('opens one issue per pending decision that has none', async () => {
    const { ctx, events } = makeCtx([
      decision('d1'),
      decision('d2', 'approved'),
    ])
    const { port, calls } = fakePort([])
    const out = await reconcileGithubDecisions(ctx, async () => {}, port)
    expect(out.opened).toEqual([41])
    expect(calls).toEqual([
      'labels',
      `create Decide: Idea d1 [${DECISION_LABEL}]`,
    ])
    expect(events.map((e) => e.type)).toContain('custom.decision.issue')
  })

  it('applies a verdict from the issue and closes it', async () => {
    const { ctx } = makeCtx([decision('d1')])
    const { port, calls } = fakePort([
      issue(5, 'd1', {
        labels: [{ name: DECISION_LABEL }, { name: APPROVE_LABEL }],
      }),
    ])
    calls.length = 0
    const applied: string[] = []
    const out = await reconcileGithubDecisions(
      ctx,
      async (d, status) => {
        applied.push(`${d.id}:${status}`)
      },
      port,
    )
    expect(applied).toEqual(['d1:approved'])
    expect(out.resolved).toEqual([{ decisionId: 'd1', status: 'approved' }])
    expect(calls).toEqual(['labels', 'close #5: Approved via GitHub'])
  })

  it('leaves an issue open while nobody has decided, and closes one decided elsewhere', async () => {
    const { ctx } = makeCtx([decision('d1'), decision('d2', 'rejected')])
    const { port, calls } = fakePort([issue(5, 'd1'), issue(6, 'd2')])
    const out = await reconcileGithubDecisions(ctx, async () => {}, port)
    expect(out.resolved).toEqual([])
    expect(calls).toEqual(['labels', 'close #6: Decided elsewhere: rejected'])
  })

  it('adopts an issue the cloud COO opened for the same proposal instead of opening another', async () => {
    const { ctx } = makeCtx([decision('d1')])
    const cloudIssue: GithubIssue = {
      ...issue(9, 'ignored'),
      body: '<!-- agentos:decision ref=proposals/001-idea.md -->
body',
      labels: [{ name: DECISION_LABEL }, { name: APPROVE_LABEL }],
    }
    const { port, calls } = fakePort([cloudIssue])
    const applied: string[] = []
    const out = await reconcileGithubDecisions(
      ctx,
      async (d, status) => {
        applied.push(`${d.id}:${status}`)
      },
      port,
    )
    expect(out.opened).toEqual([])
    expect(applied).toEqual(['d1:approved'])
    expect(calls).toEqual(['labels', 'close #9: Approved via GitHub'])
  })

  it('does nothing for a remote that is not on GitHub', async () => {
    const { ctx } = makeCtx([decision('d1')], '/tmp/bare.git')
    const { port, calls } = fakePort([])
    const out = await reconcileGithubDecisions(ctx, async () => {}, port)
    expect(out).toEqual({ opened: [], resolved: [], closed: [] })
    expect(calls).toEqual([])
  })

  it('alerts instead of throwing when GitHub is unreachable', async () => {
    const { ctx, events } = makeCtx([decision('d1')])
    const port: GithubDecisionPort = {
      listIssues: async () => {
        throw new Error('gh: HTTP 502')
      },
      createIssue: async () => 0,
      closeIssue: async () => {},
      ensureLabels: async () => {},
    }
    const out = await reconcileGithubDecisions(ctx, async () => {}, port)
    expect(out.opened).toEqual([])
    expect(events.some((e) => e.type === 'ops.alert')).toBe(true)
  })
})
