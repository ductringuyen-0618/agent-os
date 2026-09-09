const COLORS: Record<string, string> = {
  idle: 'text-muted',
  working: 'text-accent',
  blocked: 'text-danger',
  queued: 'text-muted',
  running: 'text-accent',
  wrapping_up: 'text-warn',
  success: 'text-accent',
  failed: 'text-danger',
  killed: 'text-danger',
  pending: 'text-warn',
  approved: 'text-accent',
  rejected: 'text-danger',
  error: 'text-danger',
}

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? 'text-muted'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-xs ${color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}
