import type { FeatureRequestInput, ProjectConfig } from '@agentos/shared'
import { type FormEvent, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useToast } from './Toast'

const client = new ApiClient()

export function NewRequestForm({
  projects,
  onCreated,
  onCancel,
}: {
  projects: ProjectConfig[]
  onCreated: (workflowId: string) => void
  onCancel?: () => void
}) {
  const [project, setProject] = useState(projects[0]?.name ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [autoApprove, setAutoApprove] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { push } = useToast()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!project) {
      setError('Pick a project.')
      return
    }
    if (!title.trim()) {
      setError('Give the request a short title.')
      return
    }
    if (!description.trim()) {
      setError('Describe what you want built.')
      return
    }
    setError(null)
    setBusy(true)
    const trimmedTitle = title.trim()
    const input: FeatureRequestInput = {
      project,
      title: trimmedTitle,
      description: description.trim(),
      autoApprove,
    }
    try {
      const { workflowId } = await client.createWorkflow({
        kind: 'feature-request',
        project,
        title: trimmedTitle,
        input: input as unknown as Record<string, unknown>,
      })
      push(`Request started: ${trimmedTitle}`)
      setTitle('')
      setDescription('')
      onCreated(workflowId)
    } catch (err) {
      push(
        err instanceof ApiError ? err.message : 'Failed to start the request',
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="request-project" className="text-xs text-muted">
          Project
        </label>
        <select
          id="request-project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text"
        >
          {projects.length === 0 && <option value="">No projects yet</option>}
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="request-title" className="text-xs text-muted">
          Title
        </label>
        <input
          id="request-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a personalized company digest"
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="request-description" className="text-xs text-muted">
          Description
        </label>
        <textarea
          id="request-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Describe the feature in your own words."
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-text"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
        />
        Auto-approve (skip the review step, build right away)
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-quiet btn-sm"
          >
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy} className="btn btn-accent btn-sm">
          {busy ? 'Starting…' : 'Start request'}
        </button>
      </div>
    </form>
  )
}
