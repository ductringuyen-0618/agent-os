import type { Run, RunStatus } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { Drawer } from '../components/Drawer'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { RunStream } from '../components/RunStream'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { duration, relativeTime, usd } from '../lib/time'

const client = new ApiClient()

type Filter = 'all' | 'active' | 'success' | 'failed'
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'success', label: 'Succeeded' },
  { id: 'failed', label: 'Failed' },
]
const ACTIVE: RunStatus[] = ['queued', 'running', 'wrapping_up', 'blocked']
const FAILED: RunStatus[] = ['failed', 'killed']

function matches(run: Run, f: Filter) {
  if (f === 'all') return true
  if (f === 'active') return ACTIVE.includes(run.status)
  if (f === 'failed') return FAILED.includes(run.status)
  return run.status === 'success'
}

export function RunsPanel() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const { events } = useEvents(
    (e) => e.type.startsWith('run.') && e.type !== 'run.stream',
  )

  const load = useCallback(() => {
    setError(null)
    client
      .listRuns({ limit: 100 })
      .then(setRuns)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load runs'),
      )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches on any run lifecycle event
  useEffect(() => {
    load()
  }, [load, events.length])

  const shown = runs?.filter((r) => matches(r, filter)) ?? []
  const now = Date.now()

  return (
    <section>
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Runs</h2>
        <div className="flex gap-4">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`tab ${filter === f.id ? 'tab-active' : ''}`}
            >
              {f.label}
              {runs && (
                <span className="ml-1.5 font-mono text-[11px] text-muted/80">
                  {runs.filter((r) => matches(r, f.id)).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && runs === null && (
        <SkeletonRows rows={5} label="Loading runs…" />
      )}
      {!error && runs !== null && runs.length === 0 && (
        <EmptyState
          title="No runs yet"
          body="Runs appear here the moment a routine fires. Start one from Routines to see it stream live."
        />
      )}
      {!error && runs !== null && runs.length > 0 && shown.length === 0 && (
        <EmptyState
          title={`No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} runs`}
          body="Try another filter."
        />
      )}
      {!error && shown.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-normal">Status</th>
              <th className="font-normal">Routine</th>
              <th className="font-normal">Run</th>
              <th className="font-normal">Started</th>
              <th className="font-normal">Took</th>
              <th className="text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(r.id)
                  }
                }}
                tabIndex={0}
                className="cursor-pointer border-t border-border/60 transition-colors hover:bg-raised/60"
              >
                <td className="py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  <span className="text-text">{r.routine}</span>
                  {r.agent && (
                    <span className="ml-1.5 text-xs text-muted">{r.agent}</span>
                  )}
                  {r.attempt > 1 && (
                    <span className="ml-1.5 text-xs text-warn">
                      retry {r.attempt}
                    </span>
                  )}
                </td>
                <td className="font-mono text-xs text-accent">{r.id}</td>
                <td className="text-muted">
                  <time dateTime={r.startedAt}>
                    {relativeTime(r.startedAt, now)}
                  </time>
                </td>
                <td className="font-mono text-xs text-muted">
                  {duration(r.startedAt, r.endedAt, now)}
                </td>
                <td className="text-right font-mono text-xs text-muted">
                  {usd(r.costUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Drawer
        open={selected !== null}
        title={selected ? `Run ${selected}` : ''}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <RunStream runId={selected} onClose={() => setSelected(null)} />
        )}
      </Drawer>
    </section>
  )
}
