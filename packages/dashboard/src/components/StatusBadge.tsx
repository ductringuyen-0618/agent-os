const COLORS: Record<string, string> = {
  idle: 'text-muted',
  working: 'text-accent',
  blocked: 'text-danger',
  queued: 'text-muted',
  running: 'text-accent',
  wrapping_up: 'text-warn',
  success: 'text-success',
  failed: 'text-danger',
  killed: 'text-danger',
  pending: 'text-signal',
  approved: 'text-success',
  rejected: 'text-danger',
  expired: 'text-muted',
  error: 'text-danger',
  waiting: 'text-signal',
  sleeping: 'text-muted',
  paused: 'text-muted',
  succeeded: 'text-success',
  terminated: 'text-danger',
}

const LIVE = new Set(['working', 'running', 'wrapping_up'])

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? 'text-muted'
  const live = LIVE.has(status)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-xs ${color}`}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-current" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {status.replace('_', ' ')}
    </span>
  )
}
