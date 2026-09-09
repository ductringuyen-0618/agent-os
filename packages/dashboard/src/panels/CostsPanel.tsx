import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type CostEntry } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

const client = new ApiClient()

export function CostsPanel() {
  const [entries, setEntries] = useState<CostEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    client
      .costs(14)
      .then(setEntries)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load costs'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Costs</h2>
        <ErrorState message={error} onRetry={load} />
      </section>
    )
  }
  if (entries === null) {
    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Costs</h2>
        <Spinner label="Loading costs…" />
      </section>
    )
  }
  if (entries.length === 0) {
    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Costs</h2>
        <EmptyState
          title="No spend yet"
          body="Costs appear after the first run completes."
        />
      </section>
    )
  }

  const byDay = new Map<string, number>()
  for (const e of entries) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.costUsd)
  const days = [...byDay.keys()].sort()
  const max = Math.max(...byDay.values(), 0.01)
  const width = 24
  const gap = 12
  const height = 140

  return (
    <section>
      <h2 className="mb-4 text-lg font-medium">Costs</h2>
      <svg
        width={days.length * (width + gap)}
        height={height + 24}
        role="img"
        aria-label="Daily cost in USD"
      >
        {days.map((day, i) => {
          const value = byDay.get(day) ?? 0
          const barHeight = Math.max(2, (value / max) * height)
          return (
            <g key={day} transform={`translate(${i * (width + gap)}, 0)`}>
              <rect
                data-testid={`cost-bar-${day}`}
                x={0}
                y={height - barHeight}
                width={width}
                height={barHeight}
                fill="var(--color-accent)"
                rx={2}
              />
              <text
                x={width / 2}
                y={height + 16}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-muted)"
              >
                {day.slice(5)}
              </text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}
