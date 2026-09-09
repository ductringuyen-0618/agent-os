import type { Decision } from '@agentos/shared'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ApiClient } from '../api/client'
import { relativeTime } from '../lib/time'
import { ConfirmSheet } from './ConfirmSheet'
import { StatusBadge } from './StatusBadge'
import { useToast } from './Toast'

const client = new ApiClient()

type Kind = 'approve' | 'reject'

/** First paragraph of the body, headings stripped, for the compact card. */
function summary(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'))
  return line ? line.replace(/^([-*+]|\d+\.)\s+/, '').replace(/[*_`]/g, '') : ''
}

function consequence(decision: Decision, kind: Kind): string {
  const verb = kind === 'approve' ? 'approved' : 'rejected'
  if (decision.adapter) {
    const what = decision.ref ?? 'the proposal'
    return `Marks ${what} as ${verb} in the project repo, commits that change and pushes it to the project's base branch. The project's agents pick it up on their next run.`
  }
  return `Marks this decision ${verb}. The agent that asked reads your answer on its next run.`
}

export function DecisionCard({
  decision,
  onResolved,
  variant = 'full',
}: {
  decision: Decision
  onResolved: (d: Decision) => void
  variant?: 'full' | 'compact'
}) {
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<Kind | null>(null)
  const { push } = useToast()

  async function resolve(kind: Kind) {
    setBusy(true)
    const optimistic: Decision = {
      ...decision,
      status: kind === 'approve' ? 'approved' : 'rejected',
    }
    onResolved(optimistic)
    try {
      const result =
        kind === 'approve'
          ? await client.approveDecision(decision.id)
          : await client.rejectDecision(decision.id)
      onResolved(result)
      push(`${kind === 'approve' ? 'Approved' : 'Rejected'}: ${decision.title}`)
    } catch {
      onResolved(decision)
      push(`Failed to ${kind} "${decision.title}"`, 'error')
    } finally {
      setBusy(false)
      setAsking(null)
    }
  }

  const pending = decision.status === 'pending'
  const actions = pending && (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => setAsking('approve')}
        className="btn btn-accent btn-sm"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setAsking('reject')}
        className="btn btn-danger btn-sm"
      >
        Reject
      </button>
    </div>
  )

  const sheet = (
    <ConfirmSheet
      open={asking !== null}
      title={
        asking === 'approve'
          ? `Approve "${decision.title}"?`
          : `Reject "${decision.title}"?`
      }
      confirmLabel={
        asking === 'approve' ? 'Confirm approval' : 'Confirm rejection'
      }
      tone={asking === 'approve' ? 'accent' : 'danger'}
      busy={busy}
      onConfirm={() => asking && resolve(asking)}
      onCancel={() => setAsking(null)}
    >
      {asking && <p>{consequence(decision, asking)}</p>}
    </ConfirmSheet>
  )

  if (variant === 'compact') {
    const text = summary(decision.body)
    return (
      <div className="card border-l-2 border-l-signal p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-text">
              {decision.title}
            </div>
            {text && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted">{text}</p>
            )}
            <div className="mt-1 font-mono text-[11px] text-muted/80">
              {decision.adapter ? `${decision.adapter}, ` : ''}
              {relativeTime(decision.createdAt)}
            </div>
          </div>
        </div>
        <div className="mt-2">{actions}</div>
        {sheet}
      </div>
    )
  }

  return (
    <article className="flex h-full flex-col">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-text">{decision.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge status={decision.status} />
            {decision.adapter && (
              <span className="chip">{decision.adapter}</span>
            )}
            {decision.ref && (
              <span className="font-mono text-[11px]">{decision.ref}</span>
            )}
            <span>opened {relativeTime(decision.createdAt)}</span>
            {decision.resolvedAt && (
              <span>resolved {relativeTime(decision.resolvedAt)}</span>
            )}
          </div>
          {decision.error && (
            <p className="mt-2 text-xs text-danger">{decision.error}</p>
          )}
        </div>
        {actions}
      </header>
      <div className="prose-agentos min-h-0 flex-1">
        <ReactMarkdown>{decision.body}</ReactMarkdown>
      </div>
      {sheet}
    </article>
  )
}
