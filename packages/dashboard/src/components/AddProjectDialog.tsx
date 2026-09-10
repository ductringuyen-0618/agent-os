import type { AddProjectResponse, GithubRepo } from '@agentos/shared'
import { useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useToast } from './Toast'

const client = new ApiClient()

export function AddProjectDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: (result: AddProjectResponse) => void
}) {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [selected, setSelected] = useState<GithubRepo | null>(null)
  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [build, setBuild] = useState(false)
  const [busy, setBusy] = useState(false)
  const { push } = useToast()

  useEffect(() => {
    if (!open) return
    setRepos(null)
    setHint(null)
    setSelected(null)
    client
      .listGithubRepos()
      .then(setRepos)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 503) {
          const body = e.body as { hint?: string } | undefined
          setHint(body?.hint ?? e.message)
        } else {
          setHint(
            e instanceof ApiError ? e.message : 'Failed to load repositories',
          )
        }
      })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!selected) return
    setName(selected.nameWithOwner.split('/').pop() ?? '')
    setBaseBranch(selected.defaultBranch)
  }, [selected])

  if (!open) return null

  async function submit() {
    if (!selected) return
    setBusy(true)
    try {
      const result = await client.addProject({
        repo: selected.nameWithOwner,
        name: name || undefined,
        base_branch: baseBranch || undefined,
        build,
      })
      if (result.setup?.status === 'pending' && result.setup.prNumber) {
        push(
          `Added ${result.project.name}. Setup PR #${result.setup.prNumber} opened; merge it to activate the adapter.`,
        )
      } else if (result.setup?.error) {
        push(
          `Added ${result.project.name}, but setup failed: ${result.setup.error}`,
          'error',
        )
      } else {
        push(`Added ${result.project.name}`)
      }
      onAdded(result)
      onClose()
    } catch (e) {
      push(e instanceof ApiError ? e.message : 'Failed to add project', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-[2px]"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Add project from GitHub"
        className="card relative w-full max-w-lg p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-base font-medium text-text">
          Add project from GitHub
        </h3>

        {hint && (
          <div className="rounded border border-border bg-raised p-3 text-sm text-muted">
            {hint}
          </div>
        )}
        {!hint && repos === null && (
          <div className="text-sm text-muted">Loading repositories…</div>
        )}
        {!hint && repos !== null && (
          <div className="max-h-48 overflow-auto rounded border border-border">
            {repos.map((r) => (
              <button
                key={r.nameWithOwner}
                type="button"
                onClick={() => setSelected(r)}
                aria-current={selected?.nameWithOwner === r.nameWithOwner}
                className={`block w-full border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 ${
                  selected?.nameWithOwner === r.nameWithOwner
                    ? 'bg-raised'
                    : 'hover:bg-raised/60'
                }`}
              >
                {r.nameWithOwner}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-text"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              Base branch
              <input
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-text"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={build}
                onChange={(e) => setBuild(e.target.checked)}
              />
              Let agent-os build features in this repo
            </label>
            {busy && (
              <div className="text-xs text-muted">Cloning and syncing…</div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-quiet"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !selected}
            className="btn btn-accent"
          >
            {busy ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  )
}
