import type { Decision } from '@agentos/shared'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ApiClient } from '../api/client'
import { useToast } from './Toast'

const client = new ApiClient()

export function DecisionCard({
  decision,
  onResolved,
}: {
  decision: Decision
  onResolved: (d: Decision) => void
}) {
  const [busy, setBusy] = useState(false)
  const { push } = useToast()

  async function resolve(kind: 'approve' | 'reject') {
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
    } catch {
      onResolved(decision)
      push(`Failed to ${kind} "${decision.title}"`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 font-medium text-text">{decision.title}</div>
      <div className="prose prose-invert prose-sm max-w-none text-muted">
        <ReactMarkdown>{decision.body}</ReactMarkdown>
      </div>
      {decision.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve('approve')}
            className="rounded border border-accent px-3 py-1 text-xs text-accent disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve('reject')}
            className="rounded border border-danger px-3 py-1 text-xs text-danger disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
