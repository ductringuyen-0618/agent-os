import type { Run } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { RunStream } from '../components/RunStream'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/StatusBadge'

const client = new ApiClient()

export function RunsPanel() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    client
      .listRuns({ limit: 50 })
      .then(setRuns)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load runs'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section>
      <h2 className="mb-4 text-lg font-medium">Runs</h2>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && runs === null && <Spinner label="Loading runs…" />}
      {!error && runs !== null && runs.length === 0 && (
        <EmptyState
          title="No runs yet"
          body="Runs appear here once a routine fires."
        />
      )}
      {!error && runs !== null && runs.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2">ID</th>
              <th>Routine</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelected(r.id)
                }}
                tabIndex={0}
                className="cursor-pointer border-b border-border hover:bg-background"
              >
                <td className="py-2 font-mono text-accent">{r.id}</td>
                <td>{r.routine}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="text-muted">{r.startedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && (
        <div className="mt-4">
          <RunStream runId={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </section>
  )
}
