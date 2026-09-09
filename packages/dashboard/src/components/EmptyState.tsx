import type { ReactNode } from 'react'

/** An empty screen is an invitation to act, so it always says what to do. */
export function EmptyState({
  title,
  body,
  action,
}: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <div className="font-medium text-text">{title}</div>
      <div className="max-w-sm text-sm text-muted">{body}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
