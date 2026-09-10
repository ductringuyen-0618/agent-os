import type { WikiPageMeta } from '@agentos/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'
import { WikiPage } from '../components/WikiPage'
import { relativeTime } from '../lib/time'

const client = new ApiClient()

/** `projects/techpulse/overview.md` → `projects/techpulse`; `concepts/x.md` → `concepts`. */
export function groupOf(path: string): string {
  const parts = path.split('/')
  if (parts.length < 2) return 'pages'
  if (parts[0] === 'projects' && parts.length > 2)
    return `${parts[0]}/${parts[1]}`
  return parts[0]
}

const GROUP_ORDER = ['projects', 'concepts', 'decisions', 'agents', 'requests']

function groupRank(g: string): number {
  const i = GROUP_ORDER.findIndex((p) => g === p || g.startsWith(`${p}/`))
  return i === -1 ? GROUP_ORDER.length : i
}

export function WikiPanel() {
  const [tab, setTab] = useState<'pages' | 'log'>('pages')
  const [pages, setPages] = useState<WikiPageMeta[] | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [log, setLog] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const loadPages = useCallback(() => {
    setError(null)
    client
      .wikiPages()
      .then((list) => {
        setPages(list)
        setPath((p) => p ?? list[0]?.path ?? null)
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load wiki'),
      )
  }, [])

  useEffect(() => {
    loadPages()
  }, [loadPages])

  useEffect(() => {
    if (!path) return
    setContent(null)
    client
      .wikiPage(path)
      .then((r) => setContent(r.content))
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? `${path}: ${e.message}`
            : 'Failed to load page',
        ),
      )
  }, [path])

  useEffect(() => {
    if (tab !== 'log') return
    setLog(null)
    client
      .wikiLog(50)
      .then((r) => setLog(r.content))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load log'),
      )
  }, [tab])

  const groups = useMemo(() => {
    if (!pages) return []
    const q = filter.trim().toLowerCase()
    const shown = q
      ? pages.filter(
          (p) =>
            p.path.toLowerCase().includes(q) ||
            p.title.toLowerCase().includes(q),
        )
      : pages
    const map = new Map<string, WikiPageMeta[]>()
    for (const p of shown) {
      const g = groupOf(p.path)
      map.set(g, [...(map.get(g) ?? []), p])
    }
    return [...map.entries()].sort(
      ([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b),
    )
  }, [pages, filter])

  const current = pages?.find((p) => p.path === path)
  const now = Date.now()
  const open = (p: string) => {
    setTab('pages')
    setPath(p)
  }

  return (
    <section>
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Wiki</h2>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setTab('pages')}
            className={`tab ${tab === 'pages' ? 'tab-active' : ''}`}
          >
            Pages{pages ? ` (${pages.length})` : ''}
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

      {error && (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null)
            loadPages()
          }}
        />
      )}

      {!error && tab === 'log' && (
        <div className="card max-w-3xl px-6 py-4">
          {log === null ? (
            <SkeletonRows rows={6} label="Loading log…" />
          ) : (
            <WikiPage content={log} onNavigate={open} />
          )}
        </div>
      )}

      {!error && tab === 'pages' && pages === null && (
        <SkeletonRows rows={6} label="Loading wiki…" />
      )}

      {!error && tab === 'pages' && pages !== null && pages.length === 0 && (
        <EmptyState
          title="The wiki is empty"
          body="Pages appear here as the ingest, lint and daily-digest routines run, and as feature requests write their proposals and summaries."
        />
      )}

      {!error && tab === 'pages' && pages !== null && pages.length > 0 && (
        <div className="flex gap-4">
          <nav
            aria-label="Wiki pages"
            className="card w-72 shrink-0 self-start overflow-hidden"
          >
            <div className="border-b border-border p-2">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter pages"
                aria-label="Filter pages"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
            <div className="max-h-[70vh] overflow-y-auto py-1">
              {groups.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted">
                  No page matches.
                </p>
              )}
              {groups.map(([group, list]) => (
                <div key={group} className="py-1">
                  <div className="px-3 py-1 font-mono text-xs text-muted">
                    {group}
                  </div>
                  <ul>
                    {list.map((p) => {
                      const active = p.path === path
                      return (
                        <li key={p.path}>
                          <button
                            type="button"
                            onClick={() => setPath(p.path)}
                            aria-current={active ? 'page' : undefined}
                            className={`flex w-full items-baseline justify-between gap-2 border-l-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-raised/60 ${
                              active
                                ? 'border-accent bg-raised/40 text-text'
                                : 'border-transparent text-muted'
                            }`}
                          >
                            <span className="min-w-0 truncate">{p.title}</span>
                            <span className="shrink-0 font-mono text-[10px] text-muted">
                              {relativeTime(p.updated, now)}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <article className="card min-w-0 flex-1 px-6 py-4">
            {current && (
              <header className="mb-3 border-b border-border/60 pb-3">
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
                  <span className="text-text">{current.path}</span>
                  <span className="chip">{current.type}</span>
                  <span>updated {relativeTime(current.updated, now)}</span>
                </div>
                {current.sources.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    From {current.sources.length}{' '}
                    {current.sources.length === 1 ? 'source' : 'sources'}:{' '}
                    <span className="font-mono">
                      {current.sources.join(', ')}
                    </span>
                  </p>
                )}
              </header>
            )}
            {content === null ? (
              <SkeletonRows rows={8} label="Loading page…" />
            ) : (
              <WikiPage
                content={content}
                currentPath={path ?? undefined}
                onNavigate={open}
              />
            )}
          </article>
        </div>
      )}
    </section>
  )
}
