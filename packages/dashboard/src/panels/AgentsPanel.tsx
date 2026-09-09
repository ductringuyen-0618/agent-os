import { useCallback, useEffect, useState } from 'react'
import { type AgentStatus, ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/StatusBadge'

const client = new ApiClient()

export function AgentsPanel() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { events } = useEvents((e) => e.type.startsWith('run.'))

  const load = useCallback(() => {
    setError(null)
    client
      .listAgents()
      .then(setAgents)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load agents'),
      )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length is a deliberate re-fetch trigger on any new run.* event, not a value read inside the effect
  useEffect(() => {
    load()
  }, [load, events.length])

  return (
    <section>
      <h2 className="mb-4 text-lg font-medium">Agents</h2>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && agents === null && <Spinner label="Loading agents…" />}
      {!error && agents !== null && agents.length === 0 && (
        <EmptyState
          title="No agents"
          body="Add an agent under os/agents/<name>/AGENT.md to see it here."
        />
      )}
      {!error && agents !== null && agents.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {agents.map((a) => (
            <div
              key={a.name}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="font-mono text-sm text-text">{a.name}</div>
              <div className="mt-2">
                <StatusBadge status={a.status} />
              </div>
              {a.currentRun && (
                <div className="mt-2 text-xs text-muted">
                  run:{' '}
                  <span className="font-mono text-accent">{a.currentRun}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
