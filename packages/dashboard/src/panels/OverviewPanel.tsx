import type { Decision, Run, WorkflowInstance } from '@agentos/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type AgentStatus,
  ApiClient,
  ApiError,
  type CostEntry,
} from '../api/client'
import { useEvents } from '../api/ws'
import { ActivityFeed } from '../components/ActivityFeed'
import { DecisionCard } from '../components/DecisionCard'
import { Drawer } from '../components/Drawer'
import { ErrorState } from '../components/ErrorState'
import { PulseStrip, type PulseTick } from '../components/PulseStrip'
import { RunStream } from '../components/RunStream'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import {
  classifyEvent,
  feedItemFromEvent,
  feedItemsFromHistory,
  mergeFeed,
} from '../lib/events'
import { todayKey, usd } from '../lib/time'
import { isInFlight } from '../lib/workflow'

const client = new ApiClient()

interface Snapshot {
  agents: AgentStatus[]
  decisions: Decision[]
  runs: Run[]
  costs: CostEntry[]
  workflows: WorkflowInstance[]
}

export function OverviewPanel({
  onNavigate,
}: {
  onNavigate?: (panel: 'decisions' | 'runs' | 'costs' | 'requests') => void
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { events, connected } = useEvents((e) => e.type !== 'run.stream')

  const load = useCallback(() => {
    setError(null)
    Promise.all([
      client.listAgents(),
      client.listDecisions('pending'),
      client.listRuns({ limit: 100 }),
      client.costs(14),
      client.listWorkflows(),
    ])
      .then(([agents, decisions, runs, costs, workflows]) =>
        setSnap({ agents, decisions, runs, costs, workflows }),
      )
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load overview'),
      )
  }, [])

  const lifecycleCount = events.filter(
    (e) =>
      e.type.startsWith('run.') ||
      e.type.startsWith('decision.') ||
      e.type.startsWith('workflow.'),
  ).length
  // biome-ignore lint/correctness/useExhaustiveDependencies: lifecycleCount re-fetches when a run or decision changes state
  useEffect(() => {
    load()
  }, [load, lifecycleCount])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  function onResolved(updated: Decision) {
    setSnap((prev) => {
      if (!prev) return prev
      const has = prev.decisions.some((d) => d.id === updated.id)
      const list = has
        ? prev.decisions.map((d) => (d.id === updated.id ? updated : d))
        : [updated, ...prev.decisions]
      return {
        ...prev,
        decisions: list.filter((d) => d.status === 'pending'),
      }
    })
  }

  const feed = useMemo(
    () =>
      mergeFeed(
        snap ? feedItemsFromHistory(snap.runs, snap.decisions) : [],
        events.map(feedItemFromEvent),
      ),
    [snap, events],
  )

  const ticks = useMemo<PulseTick[]>(() => {
    const out: PulseTick[] = []
    for (const r of snap?.runs ?? []) {
      if (r.startedAt) out.push({ ts: r.startedAt, kind: 'run' })
      if (r.endedAt)
        out.push({
          ts: r.endedAt,
          kind:
            r.status === 'failed' || r.status === 'killed' ? 'alert' : 'run',
        })
    }
    for (const d of snap?.decisions ?? [])
      out.push({ ts: d.createdAt, kind: 'human' })
    for (const e of events) out.push({ ts: e.ts, kind: classifyEvent(e.type) })
    return out
  }, [snap, events])

  const today = todayKey(now)
  const runsToday = snap?.runs.filter((r) => r.startedAt?.startsWith(today))
  const failedToday = runsToday?.filter(
    (r) => r.status === 'failed' || r.status === 'killed',
  ).length
  const working = snap?.agents.filter((a) => a.status !== 'idle').length ?? 0
  const spendToday =
    snap?.costs
      .filter((c) => c.day === today)
      .reduce((s, c) => s + c.costUsd, 0) ?? 0
  const spend14 = snap?.costs.reduce((s, c) => s + c.costUsd, 0) ?? 0
  const waiting = snap?.decisions.length ?? 0
  const requestsInFlight =
    snap?.workflows.filter((w) => isInFlight(w.status)).length ?? 0

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Overview</h2>
        <span className="pb-1.5 text-xs text-muted">
          {new Date(now).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </span>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && <PulseStrip ticks={ticks} now={now} live={connected} />}

      {!error && (
        <dl className="grid grid-cols-5 gap-3">
          <Stat
            label="Agents"
            value={snap ? String(snap.agents.length) : null}
            note={
              snap
                ? working > 0
                  ? `${working} working now`
                  : 'all idle'
                : undefined
            }
            tone={working > 0 ? 'accent' : undefined}
          />
          <Stat
            label="Waiting on you"
            value={snap ? String(waiting) : null}
            note={waiting > 0 ? 'needs a decision' : 'nothing pending'}
            tone={waiting > 0 ? 'signal' : undefined}
            onClick={onNavigate ? () => onNavigate('decisions') : undefined}
          />
          <Stat
            label="Requests in flight"
            value={snap ? String(requestsInFlight) : null}
            note={requestsInFlight > 0 ? 'building now' : 'nothing in flight'}
            tone={requestsInFlight > 0 ? 'accent' : undefined}
            onClick={onNavigate ? () => onNavigate('requests') : undefined}
          />
          <Stat
            label="Runs today"
            value={runsToday ? String(runsToday.length) : null}
            note={
              failedToday
                ? `${failedToday} failed`
                : runsToday && runsToday.length > 0
                  ? 'all succeeded'
                  : 'none yet'
            }
            tone={failedToday ? 'danger' : undefined}
            onClick={onNavigate ? () => onNavigate('runs') : undefined}
          />
          <Stat
            label="Spend today"
            value={snap ? usd(spendToday) : null}
            note={`${usd(spend14)} over 14 days`}
            onClick={onNavigate ? () => onNavigate('costs') : undefined}
          />
        </dl>
      )}

      {!error && (
        <div className="grid grid-cols-[5fr_7fr] gap-4">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-sm font-medium text-text">
                Waiting on you
              </h3>
              {snap === null ? (
                <SkeletonRows rows={2} label="Loading decisions…" />
              ) : snap.decisions.length === 0 ? (
                <p className="card px-4 py-5 text-center text-sm text-muted">
                  Nothing needs you right now.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {snap.decisions.slice(0, 3).map((d) => (
                    <DecisionCard
                      key={d.id}
                      decision={d}
                      onResolved={onResolved}
                      variant="compact"
                    />
                  ))}
                  {snap.decisions.length > 3 && onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate('decisions')}
                      className="btn btn-quiet btn-sm self-start"
                    >
                      See all {snap.decisions.length}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-text">Agents</h3>
              {snap === null ? (
                <SkeletonRows rows={3} label="Loading agents…" />
              ) : snap.agents.length === 0 ? (
                <p className="card px-4 py-5 text-center text-sm text-muted">
                  No agents yet. Add one under os/agents/&lt;name&gt;/AGENT.md.
                </p>
              ) : (
                <ul className="card divide-y divide-border/60">
                  {snap.agents.map((a) => (
                    <li
                      key={a.name}
                      className="flex items-center justify-between px-4 py-2.5"
                    >
                      <span className="font-mono text-sm text-text">
                        {a.name}
                      </span>
                      <span className="flex items-center gap-3">
                        {a.currentRun && (
                          <button
                            type="button"
                            onClick={() => setOpenRun(a.currentRun as string)}
                            className="font-mono text-xs text-accent hover:underline"
                          >
                            {a.currentRun}
                          </button>
                        )}
                        <StatusBadge status={a.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card min-h-0 px-4 py-3">
            <h3 className="mb-1 text-sm font-medium text-text">Activity</h3>
            {snap === null ? (
              <SkeletonRows rows={6} label="Loading activity…" />
            ) : (
              <ActivityFeed items={feed} now={now} onOpenRun={setOpenRun} />
            )}
          </div>
        </div>
      )}

      <Drawer
        open={openRun !== null}
        title={openRun ? `Run ${openRun}` : ''}
        onClose={() => setOpenRun(null)}
      >
        {openRun && (
          <RunStream runId={openRun} onClose={() => setOpenRun(null)} />
        )}
      </Drawer>
    </section>
  )
}

function Stat({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string
  value: string | null
  note?: string
  tone?: 'accent' | 'signal' | 'danger'
  onClick?: () => void
}) {
  const color =
    tone === 'signal'
      ? 'text-signal'
      : tone === 'accent'
        ? 'text-accent'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-text'
  const inner = (
    <>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-2">
        {value === null ? (
          <span className="skeleton mt-1 inline-block h-6 w-10" />
        ) : (
          <span className={`font-mono text-2xl ${color}`}>{value}</span>
        )}
        {note && <span className="text-xs text-muted">{note}</span>}
      </dd>
    </>
  )
  if (onClick)
    return (
      <div className="card">
        <button
          type="button"
          onClick={onClick}
          className="w-full px-4 py-3 text-left transition-colors hover:bg-raised/60"
        >
          {inner}
        </button>
      </div>
    )
  return <div className="card px-4 py-3">{inner}</div>
}
