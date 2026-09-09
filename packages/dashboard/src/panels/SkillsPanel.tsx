import type { SkillMeta } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type SkillDetail } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'

const client = new ApiClient()

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)

  const load = useCallback(() => {
    setError(null)
    client
      .listSkills()
      .then(setSkills)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load skills'),
      )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(name: string) {
    if (expanded === name) {
      setExpanded(null)
      return
    }
    setExpanded(name)
    setDetail(null)
    const d = await client.getSkill(name)
    setDetail(d)
  }

  return (
    <section>
      <div className="mb-4 border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Skills</h2>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && skills === null && (
        <SkeletonRows rows={4} label="Loading skills…" />
      )}
      {!error && skills !== null && skills.length === 0 && (
        <EmptyState
          title="No skills yet"
          body="A skill is a folder under os/skills with a skill.md. Agents run them; the OS scores each run and keeps what it learned."
        />
      )}
      {!error && skills !== null && skills.length > 0 && (
        <ul className="card divide-y divide-border/60">
          {skills.map((s) => {
            const open = expanded === s.name
            const score = s.lastScore
            return (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => toggle(s.name)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-raised/60"
                >
                  <span className="w-40 shrink-0 font-mono text-sm text-text">
                    {s.name}
                  </span>
                  <span className="flex flex-1 items-center gap-3">
                    <span
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-background"
                      aria-hidden="true"
                    >
                      <span
                        className={`block h-full rounded-full ${
                          score === undefined
                            ? 'bg-border'
                            : score >= 0.8
                              ? 'bg-success'
                              : score >= 0.5
                                ? 'bg-signal'
                                : 'bg-danger'
                        }`}
                        style={{ width: `${Math.round((score ?? 0) * 100)}%` }}
                      />
                    </span>
                    <span className="w-14 text-right font-mono text-xs text-muted">
                      {score !== undefined
                        ? `${Math.round(score * 100)}%`
                        : 'unscored'}
                    </span>
                  </span>
                  <span className="w-20 text-right text-xs text-muted">
                    {s.hasLearnings ? 'has learnings' : ''}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border/60 bg-background/50 px-4 py-3">
                    {detail ? (
                      detail.learningsMd.trim() ? (
                        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                          {detail.learningsMd}
                        </pre>
                      ) : (
                        <p className="text-xs text-muted">
                          No learnings recorded yet. They accumulate after runs
                          are scored.
                        </p>
                      )
                    ) : (
                      <SkeletonRows rows={2} label="Loading learnings…" />
                    )}
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
