import type { WorkflowStep } from '@agentos/shared'
import { duration, usd } from '../lib/time'
import { stepCostUsd } from '../lib/workflow'
import { StatusBadge } from './StatusBadge'

/**
 * One row per step, in seq order: status, name, retry count, how long it
 * took (or has been taking), and what it cost.
 */
export function WorkflowStepper({
  steps,
  now = Date.now(),
}: {
  steps: WorkflowStep[]
  now?: number
}) {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq)
  return (
    <ol className="flex flex-col">
      {ordered.map((s) => (
        <li
          key={s.id}
          className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0"
        >
          <StatusBadge status={s.status} />
          <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
          {s.attempt > 1 && (
            <span className="text-xs text-warn">retry {s.attempt}</span>
          )}
          <span className="font-mono text-xs text-muted">
            {duration(s.startedAt, s.endedAt, now)}
          </span>
          <span className="font-mono text-xs text-muted">
            {usd(stepCostUsd(s))}
          </span>
        </li>
      ))}
    </ol>
  )
}
