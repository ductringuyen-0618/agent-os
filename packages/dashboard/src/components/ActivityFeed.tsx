import type { EventKind, FeedItem } from '../lib/events'
import { relativeTime } from '../lib/time'

const DOT: Record<EventKind, string> = {
  run: 'bg-accent',
  human: 'bg-signal',
  memory: 'bg-muted',
  git: 'bg-success',
  alert: 'bg-danger',
}

export function ActivityFeed({
  items,
  max = 40,
  now = Date.now(),
  onOpenRun,
}: {
  items: FeedItem[]
  max?: number
  now?: number
  onOpenRun?: (runId: string) => void
}) {
  const shown = items.slice(0, max)
  if (shown.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        Nothing yet. Events stream in here as routines fire.
      </p>
    )
  }
  return (
    <ol className="flex flex-col">
      {shown.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 border-b border-border/60 py-2 text-sm last:border-b-0"
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[item.kind]}`}
            aria-hidden="true"
          />
          <span
            className={`min-w-0 flex-1 ${item.kind === 'human' ? 'text-text' : 'text-muted'}`}
          >
            {item.runId && onOpenRun ? (
              <button
                type="button"
                onClick={() => onOpenRun(item.runId as string)}
                className="text-left hover:text-text hover:underline"
              >
                {item.text}
              </button>
            ) : (
              item.text
            )}
          </span>
          <time
            dateTime={item.ts}
            className="shrink-0 font-mono text-xs text-muted/80"
          >
            {relativeTime(item.ts, now)}
          </time>
        </li>
      ))}
    </ol>
  )
}
