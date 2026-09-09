import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'
import { WikiPage } from '../components/WikiPage'

const client = new ApiClient()

export function WikiPanel() {
  const [tab, setTab] = useState<'browse' | 'log'>('browse')
  const [path, setPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((t: 'browse' | 'log', p: string | null) => {
    setError(null)
    setContent(null)
    const req =
      t === 'log'
        ? client.wikiLog(50)
        : p
          ? client.wikiPage(p)
          : client.wikiIndex()
    req
      .then((r) => setContent(r.content))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load wiki'),
      )
  }, [])

  useEffect(() => {
    load(tab, path)
  }, [load, tab, path])

  return (
    <section>
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Wiki</h2>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => {
              setTab('browse')
              setPath(null)
            }}
            className={`tab ${tab === 'browse' ? 'tab-active' : ''}`}
          >
            Index
          </button>
          <button
            type="button"
            onClick={() => setTab('log')}
            className={`tab ${tab === 'log' ? 'tab-active' : ''}`}
          >
            Log
          </button>
        </div>
      </div>
      {tab === 'browse' && path && (
        <div className="mb-3 flex items-center gap-2 font-mono text-xs text-muted">
          <button
            type="button"
            onClick={() => setPath(null)}
            className="hover:text-text hover:underline"
          >
            index
          </button>
          <span>/</span>
          <span className="text-text">{path}</span>
        </div>
      )}
      {error && <ErrorState message={error} onRetry={() => load(tab, path)} />}
      {!error && content === null && (
        <SkeletonRows rows={6} label="Loading wiki…" />
      )}
      {!error && content !== null && (
        <div className="card max-w-3xl px-6 py-4">
          <WikiPage
            content={content}
            onNavigate={(p) => {
              setTab('browse')
              setPath(p)
            }}
          />
        </div>
      )}
    </section>
  )
}
