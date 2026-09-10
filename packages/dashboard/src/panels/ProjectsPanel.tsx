import type { Decision, ProjectListItem } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { AddProjectDialog } from '../components/AddProjectDialog'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { relativeTime } from '../lib/time'

const client = new ApiClient()

/** The one adapter exists under two names; show what it does, not its history. */
function adapterLabel(adapter: string): string {
  return adapter === 'coo-missions' || adapter === 'techpulse-coo'
    ? 'COO missions'
    : adapter
}

export function ProjectsPanel() {
  const [items, setItems] = useState<ProjectListItem[] | null>(null)
  const [pendingByProject, setPendingByProject] = useState<
    Record<string, number>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const { push } = useToast()

  const load = useCallback(() => {
    setError(null)
    Promise.all([client.listProjects(), client.listDecisions('pending')])
      .then(([projects, decisions]: [ProjectListItem[], Decision[]]) => {
        setItems(projects)
        const counts: Record<string, number> = {}
        for (const d of decisions) {
          if (d.project) counts[d.project] = (counts[d.project] ?? 0) + 1
        }
        setPendingByProject(counts)
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load projects'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function syncNow(name: string) {
    setSyncing(name)
    try {
      await client.syncProject(name)
    } catch (e) {
      push(
        e instanceof ApiError ? e.message : 'Failed to sync project',
        'error',
      )
    } finally {
      setSyncing(null)
      load()
    }
  }

  async function checkSetup(name: string) {
    setChecking(name)
    try {
      const { setup } = await client.setupProject(name)
      if (setup.status === 'ready') {
        push(`${name} is set up; syncing now`)
      } else if (setup.error) {
        push(`Setup for ${name} failed: ${setup.error}`, 'error')
      } else if (setup.prUrl) {
        push(`Setup PR #${setup.prNumber} is still open`)
      }
    } catch (e) {
      push(e instanceof ApiError ? e.message : 'Failed to check setup', 'error')
    } finally {
      setChecking(null)
      load()
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await client.removeProject(removeTarget)
      push(`Removed ${removeTarget}`)
      setItems((prev) =>
        (prev ?? []).filter((p) => p.config.name !== removeTarget),
      )
      setRemoveTarget(null)
    } catch (e) {
      push(
        e instanceof ApiError ? e.message : 'Failed to remove project',
        'error',
      )
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Projects</h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="btn btn-accent btn-sm"
        >
          <Icon name="projects" size={12} />
          Add from GitHub
        </button>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && items === null && (
        <SkeletonRows rows={3} label="Loading projects…" />
      )}
      {!error && items !== null && items.length === 0 && (
        <EmptyState
          title="No projects yet"
          body="Add a repository from GitHub to start syncing it."
        />
      )}
      {!error && items !== null && items.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-normal">Project</th>
              <th className="font-normal">Adapter</th>
              <th className="font-normal">Base branch</th>
              <th className="font-normal">Last sync</th>
              <th className="font-normal">Pending</th>
              <th className="font-normal">Build</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(({ config, lastSync, hasCooLayout }) => (
              <tr key={config.name} className="border-t border-border/60">
                <td className="py-2.5 font-mono text-text">{config.name}</td>
                <td className="text-muted">
                  {config.adapter ? (
                    adapterLabel(config.adapter)
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="chip text-signal">not set up</span>
                      {config.setup?.pr_url ? (
                        <a
                          href={config.setup.pr_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-accent underline"
                        >
                          Setup PR #{config.setup.pr_number}
                        </a>
                      ) : (
                        <span className="text-xs">no setup PR yet</span>
                      )}
                    </span>
                  )}
                  {config.setup?.note && !config.adapter && (
                    <div className="mt-1 max-w-xs text-[11px] text-danger">
                      {config.setup.note}
                    </div>
                  )}
                </td>
                <td className="text-muted">{config.base_branch}</td>
                <td>
                  {lastSync ? (
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge status={lastSync.status} />
                      <span className="text-xs text-muted">
                        {relativeTime(lastSync.startedAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted">never</span>
                  )}
                </td>
                <td className="text-muted">
                  {pendingByProject[config.name] ?? 0}
                </td>
                <td className="text-muted">
                  {config.build?.enabled ? 'on' : 'off'}
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    {config.adapter ? (
                      <button
                        type="button"
                        onClick={() => syncNow(config.name)}
                        disabled={syncing === config.name}
                        className="btn btn-quiet btn-sm"
                      >
                        {syncing === config.name ? 'Syncing…' : 'Sync now'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => checkSetup(config.name)}
                        disabled={checking === config.name}
                        className="btn btn-accent btn-sm"
                      >
                        {checking === config.name
                          ? 'Checking…'
                          : config.setup?.pr_url
                            ? 'Check setup'
                            : 'Open setup PR'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRemoveTarget(config.name)}
                      className="btn btn-quiet btn-sm"
                    >
                      Remove
                    </button>
                  </div>
                  {!hasCooLayout && config.adapter && (
                    <div className="mt-1 text-[11px] text-muted">
                      No proposals folder yet; the first feature request will
                      create it.
                    </div>
                  )}
                  {!config.adapter && (
                    <div className="mt-1 max-w-xs text-[11px] text-muted">
                      Merge the setup PR to activate the COO adapter; agent-os
                      checks it whenever this list loads.
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AddProjectDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => load()}
      />
      <ConfirmSheet
        open={removeTarget !== null}
        title={`Remove ${removeTarget}?`}
        confirmLabel="Confirm removal"
        tone="danger"
        busy={removing}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        The project's config and sync routine are removed. Its local clone and
        wiki mirror stay in place.
      </ConfirmSheet>
    </section>
  )
}
