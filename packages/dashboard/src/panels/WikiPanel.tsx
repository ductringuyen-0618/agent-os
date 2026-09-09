import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'
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
      <h2 className="mb-4 text-lg font-medium">Wiki</h2>
      <div className="mb-4 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setTab('browse')
            setPath(null)
          }}
          className={tab === 'browse' ? 'text-accent' : 'text-muted'}
        >
          Index
        </button>
        <button
          type="button"
          onClick={() => setTab('log')}
          className={tab === 'log' ? 'text-accent' : 'text-muted'}
        >
          Log
        </button>
      </div>
      {error && <ErrorState message={error} onRetry={() => load(tab, path)} />}
      {!error && content === null && <Spinner label="Loading wiki…" />}
      {!error && content !== null && (
        <WikiPage
          content={content}
          onNavigate={(p) => {
            setTab('browse')
            setPath(p)
          }}
        />
      )}
    </section>
  )
}
