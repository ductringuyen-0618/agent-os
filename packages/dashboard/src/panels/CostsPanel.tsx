import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type CostEntry } from '../api/client'
import { CostChart } from '../components/CostChart'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'
import { todayKey, usd } from '../lib/time'

const client = new ApiClient()
const DAYS = 14

export function CostsPanel() {
  const [entries, setEntries] = useState<CostEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    client
      .costs(DAYS)
      .then(setEntries)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load costs'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const total = entries?.reduce((s, e) => s + e.costUsd, 0) ?? 0
  const today = todayKey()
  const spentToday =
    entries
      ?.filter((e) => e.day === today)
      .reduce((s, e) => s + e.costUsd, 0) ?? 0
  const byAgent = new Map<string, number>()
  for (const e of entries ?? [])
    byAgent.set(e.agent, (byAgent.get(e.agent) ?? 0) + e.costUsd)
  const topAgent = [...byAgent.entries()].sort((a, b) => b[1] - a[1])[0]

  return (
    <section>
      <div className="mb-4 border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Costs</h2>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && entries === null && (
        <SkeletonRows rows={3} label="Loading costs…" />
      )}
      {!error && entries !== null && entries.length === 0 && (
        <EmptyState
          title="No spend yet"
          body="Every completed run reports what it cost. The first one will draw the first bar here."
        />
      )}
      {!error && entries !== null && entries.length > 0 && (
        <>
          <dl className="mb-5 grid grid-cols-3 gap-3">
            <div className="card px-4 py-3">
              <dt className="text-xs text-muted">Last {DAYS} days</dt>
              <dd className="mt-1 font-mono text-xl text-text">{usd(total)}</dd>
            </div>
            <div className="card px-4 py-3">
              <dt className="text-xs text-muted">Today</dt>
              <dd className="mt-1 font-mono text-xl text-text">
                {usd(spentToday)}
              </dd>
            </div>
            <div className="card px-4 py-3">
              <dt className="text-xs text-muted">Biggest spender</dt>
              <dd className="mt-1 truncate font-mono text-xl text-text">
                {topAgent ? topAgent[0] : '—'}
                {topAgent && (
                  <span className="ml-2 text-sm text-muted">
                    {usd(topAgent[1])}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <div className="card p-4">
            <CostChart entries={entries} window={DAYS} />
          </div>
        </>
      )}
    </section>
  )
}
