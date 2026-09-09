import type { ProjectConfig, WorkflowInstance } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { NewRequestForm } from '../components/NewRequestForm'
import { RequestView } from '../components/RequestView'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { duration, usd } from '../lib/time'
import { workflowCostUsd } from '../lib/workflow'

const client = new ApiClient()

export function RequestsPanel() {
  const [workflows, setWorkflows] = useState<WorkflowInstance[] | null>(null)
  const [projects, setProjects] = useState<ProjectConfig[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const { events } = useEvents((e) => e.type.startsWith('workflow.'))

  const load = useCallback(() => {
    setError(null)
    client
      .listWorkflows()
      .then((list) => {
        setWorkflows(list)
        setSelectedId((cur) =>
          cur && list.some((w) => w.id === cur) ? cur : (list[0]?.id ?? null),
        )
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load requests'),
      )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches the list on every workflow.* event
  useEffect(() => {
    load()
  }, [load, events.length])

  useEffect(() => {
    client
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  function created(workflowId: string) {
    setShowForm(false)
    setSelectedId(workflowId)
    load()
  }

  const now = Date.now()

  return (
    <section className="flex h-full flex-col">
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Requests</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn btn-accent btn-sm mb-1.5"
          >
            New request
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4">
          <NewRequestForm
            projects={projects}
            onCreated={created}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && workflows === null && (
        <SkeletonRows rows={4} label="Loading requests…" />
      )}
      {!error && workflows !== null && workflows.length === 0 && (
        <EmptyState
          title="No requests yet"
          body="Describe a feature in plain words and agent-os turns it into a proposal, a branch, and a pull request."
          action={
            !showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="btn btn-accent btn-sm"
              >
                New request
              </button>
            )
          }
        />
      )}
      {!error && workflows !== null && workflows.length > 0 && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,1fr)_2fr] gap-4">
          <ol className="card min-h-0 overflow-auto" aria-label="Request list">
            {workflows.map((w) => {
              const active = w.id === selectedId
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(w.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                      active
                        ? 'bg-raised border-l-2 border-l-accent'
                        : 'border-l-2 border-l-transparent hover:bg-raised/60'
                    }`}
                  >
                    <div className="truncate text-sm text-text">{w.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                      <StatusBadge status={w.status} />
                      {w.project && <span>{w.project}</span>}
                      <span className="font-mono">
                        {duration(w.startedAt, w.endedAt, now)}
                      </span>
                      <span className="font-mono">
                        {usd(workflowCostUsd(w))}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="card min-h-0 overflow-auto p-5">
            {selectedId ? (
              <RequestView key={selectedId} workflowId={selectedId} />
            ) : (
              <p className="text-sm text-muted">Pick a request to follow it.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
