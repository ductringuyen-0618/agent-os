import type { Decision, DecisionStatus } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { DecisionCard } from '../components/DecisionCard'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

const client = new ApiClient()

export function DecisionsPanel() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [decisions, setDecisions] = useState<Decision[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((t: 'pending' | 'history') => {
    setError(null)
    const status: DecisionStatus | undefined =
      t === 'pending' ? 'pending' : undefined
    client
      .listDecisions(status)
      .then((d) =>
        setDecisions(
          t === 'history' ? d.filter((x) => x.status !== 'pending') : d,
        ),
      )
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : 'Failed to load decisions',
        ),
      )
  }, [])

  useEffect(() => {
    load(tab)
  }, [load, tab])

  function onResolved(updated: Decision) {
    setDecisions((prev) => {
      const list = prev ?? []
      // A failed optimistic update hands the original decision back after it
      // was filtered out of the list, so re-insert it rather than dropping it.
      const next = list.some((d) => d.id === updated.id)
        ? list.map((d) => (d.id === updated.id ? updated : d))
        : [updated, ...list]
      return next.filter((d) => tab === 'history' || d.status === 'pending')
    })
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-medium">Decisions</h2>
      <div className="mb-4 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={tab === 'pending' ? 'text-accent' : 'text-muted'}
        >
          Pending
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={tab === 'history' ? 'text-accent' : 'text-muted'}
        >
          History
        </button>
      </div>
      {error && <ErrorState message={error} onRetry={() => load(tab)} />}
      {!error && decisions === null && <Spinner label="Loading decisions…" />}
      {!error && decisions !== null && decisions.length === 0 && (
        <EmptyState
          title={tab === 'pending' ? 'Nothing pending' : 'No history yet'}
          body={
            tab === 'pending'
              ? 'Approvals requested by agents will show up here.'
              : 'Resolved decisions will show up here.'
          }
        />
      )}
      {!error && decisions !== null && decisions.length > 0 && (
        <div className="flex flex-col gap-3">
          {decisions.map((d) => (
            <DecisionCard key={d.id} decision={d} onResolved={onResolved} />
          ))}
        </div>
      )}
    </section>
  )
}
