import type { SkillMeta } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type SkillDetail } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { WikiPage } from '../components/WikiPage'
import { relativeTime, usd } from '../lib/time'

const client = new ApiClient()

type DetailTab = 'learnings' | 'instructions'

function successRate(s: SkillMeta): number | undefined {
  if (!s.runs) return undefined
  return (s.succeeded ?? 0) / s.runs
}

/** Skills that have actually run come first, most recent on top. */
function order(a: SkillMeta, b: SkillMeta): number {
  const ar = a.lastRunAt ?? ''
  const br = b.lastRunAt ?? ''
  if (ar !== br) return br.localeCompare(ar)
  return a.name.localeCompare(b.name)
}

function rateColor(rate: number | undefined): string {
  if (rate === undefined) return 'bg-border'
  if (rate >= 0.8) return 'bg-success'
  if (rate >= 0.5) return 'bg-signal'
  return 'bg-danger'
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('learnings')

  const load = useCallback(() => {
    setError(null)
    client
      .listSkills()
      .then((list) => setSkills([...list].sort(order)))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load skills'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(s: SkillMeta) {
    if (expanded === s.name) {
      setExpanded(null)
      return
    }
    setExpanded(s.name)
    setDetail(null)
    setDetailTab(s.hasLearnings ? 'learnings' : 'instructions')
    const d = await client.getSkill(s.name)
    setDetail(d)
  }

  const now = Date.now()
  const noop = () => {}

  return (
    <section>
      <div className="mb-4 flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Skills</h2>
        <p className="pb-1.5 text-xs text-muted">
          What each agent knows how to do, and how it has gone so far.
        </p>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && skills === null && (
        <SkeletonRows rows={4} label="Loading skills…" />
      )}
      {!error && skills !== null && skills.length === 0 && (
        <EmptyState
          title="No skills yet"
          body="A skill is a folder under os/skills with a SKILL.md. Routines run them; each run's outcome and learnings show up here."
        />
      )}
      {!error && skills !== null && skills.length > 0 && (
        <ul className="card divide-y divide-border/60">
          {skills.map((s) => {
            const open = expanded === s.name
            const rate = successRate(s)
            return (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  aria-expanded={open}
                  className="grid w-full grid-cols-[11rem_minmax(0,1fr)_9rem_10rem_4.5rem] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-raised/60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm text-text">
                      {s.name}
                    </span>
                    {s.routines && s.routines.length > 0 && (
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        via {s.routines.join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-sm text-muted">
                    {s.description || 'No description in SKILL.md yet.'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-background"
                      aria-hidden="true"
                    >
                      <span
                        className={`block h-full rounded-full ${rateColor(rate)}`}
                        style={{ width: `${Math.round((rate ?? 0) * 100)}%` }}
                      />
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {s.runs
                        ? `${s.succeeded ?? 0}/${s.runs} ok`
                        : 'never run'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {s.lastStatus ? (
                      <>
                        <StatusBadge status={s.lastStatus} />
                        <span>{relativeTime(s.lastRunAt, now)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                  <span className="text-right font-mono text-xs text-muted">
                    {s.runs ? usd(s.costUsd) : ''}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border/60 bg-background/50 px-4 py-3">
                    <div className="mb-3 flex gap-4 border-b border-border/60">
                      <button
                        type="button"
                        onClick={() => setDetailTab('learnings')}
                        className={`tab ${detailTab === 'learnings' ? 'tab-active' : ''}`}
                      >
                        Learnings
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailTab('instructions')}
                        className={`tab ${detailTab === 'instructions' ? 'tab-active' : ''}`}
                      >
                        Instructions
                      </button>
                    </div>
                    {!detail && (
                      <SkeletonRows rows={2} label="Loading skill…" />
                    )}
                    {detail &&
                      detailTab === 'learnings' &&
                      (detail.learningsMd.trim() ? (
                        <WikiPage
                          content={detail.learningsMd}
                          onNavigate={noop}
                        />
                      ) : (
                        <p className="text-xs text-muted">
                          Nothing learned yet. After each run the agent's
                          wrap-up turn appends what it would do differently next
                          time.
                        </p>
                      ))}
                    {detail &&
                      detailTab === 'instructions' &&
                      (detail.skillMd.trim() ? (
                        <WikiPage content={detail.skillMd} onNavigate={noop} />
                      ) : (
                        <p className="text-xs text-muted">
                          This skill has no SKILL.md.
                        </p>
                      ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
