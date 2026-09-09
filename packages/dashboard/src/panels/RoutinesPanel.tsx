import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type RoutineListItem } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'

const client = new ApiClient()

export function RoutinesPanel() {
  const [items, setItems] = useState<RoutineListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { push } = useToast()

  const load = useCallback(() => {
    setError(null)
    client
      .listRoutines()
      .then(setItems)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load routines'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function runNow(name: string) {
    try {
      await client.runRoutine(name)
      push(`Queued ${name}`)
    } catch {
      push(`Failed to run ${name}`, 'error')
    }
  }

  async function toggle(name: string, enabled: boolean) {
    try {
      if (enabled) {
        await client.disableRoutine(name)
      } else {
        await client.enableRoutine(name)
      }
      load()
    } catch {
      push(`Failed to toggle ${name}`, 'error')
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-medium">Routines</h2>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && items === null && <Spinner label="Loading routines…" />}
      {!error && items !== null && items.length === 0 && (
        <EmptyState
          title="No routines configured"
          body="Add entries to os/routines.yaml."
        />
      )}
      {!error && items !== null && items.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2">Name</th>
              <th>Trigger</th>
              <th>Next run</th>
              <th>Last run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(({ routine, nextRun, lastRun }) => (
              <tr key={routine.name} className="border-b border-border">
                <td className="py-2 font-mono">{routine.name}</td>
                <td className="text-muted">
                  {routine.every ??
                    routine.cron ??
                    (routine.on ? routine.on.join(',') : 'manual')}
                </td>
                <td className="text-muted">{nextRun ?? '—'}</td>
                <td>
                  {lastRun ? (
                    <StatusBadge status={lastRun.status} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="flex gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => runNow(routine.name)}
                    className="rounded border border-accent px-2 py-1 text-xs text-accent"
                  >
                    Run now
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      toggle(routine.name, routine.enabled !== false)
                    }
                    className="rounded border border-border px-2 py-1 text-xs text-muted"
                  >
                    {routine.enabled === false ? 'Enable' : 'Disable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
