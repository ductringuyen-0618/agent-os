import type { SkillMeta } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError, type SkillDetail } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Spinner } from '../components/Spinner'

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
      <h2 className="mb-4 text-lg font-medium">Skills</h2>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && skills === null && <Spinner label="Loading skills…" />}
      {!error && skills !== null && skills.length === 0 && (
        <EmptyState
          title="No skills yet"
          body="Skills live under os/skills/<name>/skill.md."
        />
      )}
      {!error && skills !== null && skills.length > 0 && (
        <div className="flex flex-col gap-2">
          {skills.map((s) => (
            <div
              key={s.name}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <button
                type="button"
                onClick={() => toggle(s.name)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="font-mono text-sm">{s.name}</span>
                <span className="text-xs text-muted">
                  {s.lastScore !== undefined ? s.lastScore.toFixed(2) : '—'}
                </span>
              </button>
              {expanded === s.name && (
                <div className="mt-2 rounded border border-border bg-background p-2 text-xs text-muted">
                  {detail ? (
                    <pre className="whitespace-pre-wrap">
                      {detail.learningsMd}
                    </pre>
                  ) : (
                    <Spinner label="Loading learnings…" />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
