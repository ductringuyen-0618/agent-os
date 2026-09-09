import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type RoutineListItem } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { relativeTime, usd } from '../lib/time'

const client = new ApiClient()

function describeTrigger(r: RoutineListItem['routine']) {
  if (r.every) return `every ${r.every}`
  if (r.cron) return r.cron
  if (r.on && r.on.length > 0) return `on ${r.on.join(', ')}`
  return 'manual'
}

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
      push(`Started ${name}`)
    } catch {
      push(`Failed to start ${name}`, 'error')
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
      push(`Failed to ${enabled ? 'pause' : 'resume'} ${name}`, 'error')
    }
  }

  const now = Date.now()

  return (
    <section>
      <div className="mb-4 border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Routines</h2>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && items === null && (
        <SkeletonRows rows={4} label="Loading routines…" />
      )}
      {!error && items !== null && items.length === 0 && (
        <EmptyState
          title="No routines configured"
          body="Routines are the schedule of the OS. Add one to os/routines.yaml and it appears here."
        />
      )}
      {!error && items !== null && items.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-normal">Routine</th>
              <th className="font-normal">Fires</th>
              <th className="font-normal">Next</th>
              <th className="font-normal">Last run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const {
                routine,
                nextRun,
                lastRun,
                dailyBudgetUsd,
                spentTodayUsd,
                budgetTripped,
              } = item
              const paused = routine.enabled === false
              return (
                <tr
                  key={routine.name}
                  className={`border-t border-border/60 ${paused ? 'opacity-60' : ''}`}
                >
                  <td className="py-2.5 font-mono text-text">
                    {routine.name}
                    {paused && <span className="chip ml-2">paused</span>}
                    {budgetTripped && (
                      <span className="chip ml-2">budget hit</span>
                    )}
                    {dailyBudgetUsd !== undefined && (
                      <span className="ml-2 text-xs text-muted">
                        {usd(spentTodayUsd)} / {usd(dailyBudgetUsd)}
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{describeTrigger(routine)}</td>
                  <td className="text-muted">
                    {paused ? '—' : relativeTime(nextRun, now)}
                  </td>
                  <td>
                    {lastRun ? (
                      <span className="inline-flex items-center gap-2">
                        <StatusBadge status={lastRun.status} />
                        <span className="text-xs text-muted">
                          {relativeTime(lastRun.startedAt, now)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">never</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => runNow(routine.name)}
                        className="btn btn-accent btn-sm"
                      >
                        <Icon name="play" size={12} />
                        Run now
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(routine.name, !paused)}
                        className="btn btn-quiet btn-sm"
                      >
                        {paused ? 'Resume' : 'Pause'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
