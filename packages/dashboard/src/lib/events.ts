import type { Decision, Event, Run } from '@agentos/shared'

/**
 * Every event falls into one of five kinds. The kind decides colour and
 * emphasis everywhere: `human` is the only thing drawn in amber.
 */
export type EventKind = 'run' | 'human' | 'memory' | 'git' | 'alert'

export interface FeedItem {
  id: string
  ts: string
  kind: EventKind
  text: string
  runId?: string
}

export function classifyEvent(type: string): EventKind {
  if (type === 'run.failed' || type === 'ops.alert') return 'alert'
  if (type === 'security.redacted') return 'alert'
  if (type.startsWith('run.')) return 'run'
  if (type.startsWith('workflow.')) return 'run'
  if (type.startsWith('decision.')) return 'human'
  if (type.startsWith('git.')) return 'git'
  return 'memory'
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** One plain sentence per event, written for the person reading the feed. */
export function describeEvent(e: Event): string {
  const p = e.payload ?? {}
  const routine = str(p.routine)
  const who = routine ?? (e.runId ? `run ${e.runId.slice(0, 8)}` : 'a run')
  switch (e.type) {
    case 'run.queued':
      return `${who} queued`
    case 'run.started':
      return `${who} started`
    case 'run.wrapup':
      return `${who} is wrapping up`
    case 'run.finished':
      return `${who} finished`
    case 'run.failed':
      return `${who} failed${str(p.error) ? `: ${str(p.error)}` : ''}`
    case 'run.killed':
      return `${who} was stopped`
    case 'raw.added':
      return `New source ${str(p.path) ?? str(p.file) ?? ''}`.trim()
    case 'raw.changed':
      return `Source changed ${str(p.path) ?? str(p.file) ?? ''}`.trim()
    case 'proposal.changed':
      return `Proposal updated ${str(p.file) ?? ''}`.trim()
    case 'decision.created':
      return `Waiting on you: ${str(p.title) ?? 'a decision'}`
    case 'decision.resolved':
      return `Decision ${str(p.status) ?? 'resolved'}${str(p.title) ? `: ${str(p.title)}` : ''}`
    case 'message.sent':
      return `Message to ${str(p.to) ?? 'an agent'}`
    case 'wiki.written':
      return `Wiki ${str(p.result) ?? 'updated'} ${str(p.path) ?? ''}`.trim()
    case 'schedule.created':
      return `Scheduled ${str(p.skill) ?? str(p.routine) ?? 'a run'}`
    case 'git.commit':
      return `Committed ${str(p.message) ?? str(p.sha)?.slice(0, 7) ?? ''}`.trim()
    case 'git.push':
      return `Pushed to ${str(p.branch) ?? 'remote'}`
    case 'ops.alert':
      return `Alert: ${str(p.message) ?? str(p.reason) ?? 'see run'}`
    case 'security.redacted':
      return 'A secret was redacted before it reached memory'
    case 'workflow.created':
      return `Request started: ${str(p.title) ?? str(p.kind) ?? 'a feature request'}`
    case 'workflow.step.started':
      return `${str(p.step) ?? 'a step'} started`
    case 'workflow.step.succeeded':
      return `${str(p.step) ?? 'a step'} finished`
    case 'workflow.step.failed':
      return `${str(p.step) ?? 'a step'} failed`
    case 'workflow.waiting':
      return `Waiting on ${str(p.step) ?? 'an event'}`
    case 'workflow.resumed':
      return 'Request resumed'
    case 'workflow.paused':
      return 'Request paused'
    case 'workflow.succeeded':
      return 'Request completed'
    case 'workflow.failed':
      return `Request failed${str(p.step) ? ` at ${str(p.step)}` : ''}`
    case 'workflow.terminated':
      return 'Request terminated'
    default:
      return e.type.replace('.', ' ')
  }
}

export function feedItemFromEvent(e: Event): FeedItem {
  return {
    id: `ev-${e.id}`,
    ts: e.ts,
    kind: classifyEvent(e.type),
    text: describeEvent(e),
    runId: e.runId,
  }
}

/** Seed the feed from history the API already exposes (runs, decisions). */
export function feedItemsFromHistory(
  runs: Run[],
  decisions: Decision[],
): FeedItem[] {
  const items: FeedItem[] = []
  for (const r of runs) {
    if (r.startedAt)
      items.push({
        id: `run-start-${r.id}`,
        ts: r.startedAt,
        kind: 'run',
        text: `${r.routine} started`,
        runId: r.id,
      })
    if (r.endedAt) {
      const failed = r.status === 'failed' || r.status === 'killed'
      items.push({
        id: `run-end-${r.id}`,
        ts: r.endedAt,
        kind: failed ? 'alert' : 'run',
        text: failed
          ? `${r.routine} ${r.status === 'killed' ? 'was stopped' : 'failed'}`
          : `${r.routine} finished`,
        runId: r.id,
      })
    }
  }
  for (const d of decisions) {
    items.push({
      id: `dec-${d.id}`,
      ts: d.createdAt,
      kind: 'human',
      text: `Waiting on you: ${d.title}`,
    })
    if (d.resolvedAt && d.status !== 'pending')
      items.push({
        id: `dec-res-${d.id}`,
        ts: d.resolvedAt,
        kind: 'human',
        text: `You ${d.status === 'error' ? 'hit an error on' : d.status} ${d.title}`,
      })
  }
  return items
}

/** Newest first, de-duplicated by id. */
export function mergeFeed(...lists: FeedItem[][]): FeedItem[] {
  const seen = new Map<string, FeedItem>()
  for (const list of lists) for (const item of list) seen.set(item.id, item)
  return [...seen.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1))
}
