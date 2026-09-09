import type { Message } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { SkeletonRows } from '../components/Skeleton'
import { relativeTime } from '../lib/time'

const client = new ApiClient()
const LIMIT = 100

export function MessagesPanel() {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { events } = useEvents((e) => e.type === 'message.sent')

  const load = useCallback(() => {
    setError(null)
    client
      .messages(LIMIT)
      .then(setMessages)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load messages'),
      )
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches on every new message.sent
  useEffect(() => {
    load()
  }, [load, events.length])

  const now = Date.now()

  return (
    <section>
      <div className="mb-4 border-b border-border">
        <h2 className="pb-1.5 text-lg font-medium">Messages</h2>
      </div>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && messages === null && (
        <SkeletonRows rows={4} label="Loading messages…" />
      )}
      {!error && messages !== null && messages.length === 0 && (
        <EmptyState
          title="No messages yet"
          body="Agents talk to each other via send_message. The first one will show up here."
        />
      )}
      {!error && messages !== null && messages.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-normal">From → To</th>
              <th className="font-normal">Message</th>
              <th className="text-right font-normal">Sent</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} className="border-t border-border/60 align-top">
                <td className="py-2 whitespace-nowrap">
                  <span
                    aria-label={m.readAt ? 'read' : 'unread'}
                    className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
                      m.readAt ? 'bg-muted/40' : 'bg-accent'
                    }`}
                  />
                  <span className="text-text">{m.from}</span>
                  <span className="mx-1 text-muted">→</span>
                  <span className="text-text">{m.to}</span>
                </td>
                <td className="max-w-md truncate text-muted" title={m.body}>
                  {m.body}
                </td>
                <td className="text-right font-mono text-xs text-muted">
                  <time dateTime={m.ts}>{relativeTime(m.ts, now)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
