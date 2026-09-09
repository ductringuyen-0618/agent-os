import type { Decision, DecisionStatus } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { DecisionCard } from '../components/DecisionCard'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { relativeTime } from '../lib/time'

const client = new ApiClient()

type Tab = 'pending' | 'history'

export function DecisionsPanel() {
  const [tab, setTab] = useState<Tab>('pending')
  const [decisions, setDecisions] = useState<Decision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { events } = useEvents((e) => e.type === 'decision.created')

  const load = useCallback((t: Tab) => {
    setError(null)
    const status: DecisionStatus | undefined =
      t === 'pending' ? 'pending' : undefined
    client
      .listDecisions(status)
      .then((d) => {
        const list =
          t === 'history'
            ? d
                .filter((x) => x.status !== 'pending')
                .sort((a, b) =>
                  (a.resolvedAt ?? a.createdAt) < (b.resolvedAt ?? b.createdAt)
                    ? 1
                    : -1,
                )
            : d
        setDecisions(list)
        setSelectedId((cur) =>
          cur && list.some((x) => x.id === cur) ? cur : (list[0]?.id ?? null),
        )
      })
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : 'Failed to load decisions',
        ),
      )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches when an agent raises a new decision
  useEffect(() => {
    load(tab)
  }, [load, tab, events.length])

  function onResolved(updated: Decision) {
    setDecisions((prev) => {
      const list = prev ?? []
      const next = list.some((d) => d.id === updated.id)
        ? list.map((d) => (d.id === updated.id ? updated : d))
        : [updated, ...list]
      const kept = next.filter(
        (d) => tab === 'history' || d.status === 'pending',
      )
      if (!kept.some((d) => d.id === selectedId))
        setSelectedId(kept[0]?.id ?? null)
      return kept
    })
  }

  const selected = decisions?.find((d) => d.id === selectedId) ?? null

  return (
    <section className="flex h-full flex-col">
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Decisions</h2>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`tab ${tab === 'pending' ? 'tab-active' : ''}`}
          >
            Waiting on you
            {decisions && tab === 'pending' && decisions.length > 0 && (
              <span className="ml-1.5 rounded-full bg-signal/15 px-1.5 font-mono text-[11px] text-signal">
                {decisions.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`tab ${tab === 'history' ? 'tab-active' : ''}`}
          >
            History
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => load(tab)} />}
      {!error && decisions === null && (
        <SkeletonRows rows={4} label="Loading decisions…" />
      )}
      {!error && decisions !== null && decisions.length === 0 && (
        <EmptyState
          title={
            tab === 'pending' ? 'Nothing waiting on you' : 'No history yet'
          }
          body={
            tab === 'pending'
              ? 'When an agent needs a human call, it shows up here with Approve and Reject.'
              : 'Every decision you resolve is kept here with when and how.'
          }
        />
      )}
      {!error && decisions !== null && decisions.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,1fr)_2fr] gap-4">
          <ol className="card min-h-0 overflow-auto" aria-label="Decision list">
            {decisions.map((d) => {
              const active = d.id === selectedId
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                      active
                        ? 'bg-raised border-l-2 border-l-signal'
                        : 'border-l-2 border-l-transparent hover:bg-raised/60'
                    }`}
                  >
                    <div className="truncate text-sm text-text">{d.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                      {tab === 'history' && <StatusBadge status={d.status} />}
                      <span className="font-mono">
                        {relativeTime(
                          tab === 'history'
                            ? (d.resolvedAt ?? d.createdAt)
                            : d.createdAt,
                        )}
                      </span>
                      {d.adapter && <span>{d.adapter}</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="card min-h-0 overflow-auto p-5">
            {selected ? (
              <DecisionCard
                key={selected.id}
                decision={selected}
                onResolved={onResolved}
              />
            ) : (
              <p className="text-sm text-muted">Pick a decision to read it.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
