import type { ClaudeStreamMessage, Event } from '@agentos/shared'
import { useEffect, useMemo, useState } from 'react'
import { ApiClient } from '../api/client'
import { useEvents } from '../api/ws'
import { usd } from '../lib/time'
import { SkeletonRows } from './Skeleton'
import { useToast } from './Toast'

const client = new ApiClient()

type Denied = {
  type: 'system'
  subtype: 'permission_denied'
  tool_name?: string
  message?: string
}

/**
 * The kernel stores each claude stream line as the event payload itself;
 * older fixtures wrapped it under `message`. Accept both.
 */
export function streamMessage(e: Event): ClaudeStreamMessage | Denied | null {
  const p = e.payload as { message?: unknown; type?: unknown }
  if (typeof p.type === 'string') return p as ClaudeStreamMessage | Denied
  const wrapped = p.message as { type?: unknown } | undefined
  if (wrapped && typeof wrapped.type === 'string')
    return wrapped as ClaudeStreamMessage | Denied
  return null
}

function renderMessage(msg: ClaudeStreamMessage | Denied, key: number) {
  if (msg.type === 'system' && msg.subtype === 'permission_denied') {
    return (
      <div
        key={key}
        className="rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger"
      >
        Permission denied{msg.tool_name ? ` for ${msg.tool_name}` : ''}
        {msg.message ? `: ${msg.message}` : ''}
      </div>
    )
  }
  if (msg.type === 'assistant') {
    return (
      <div key={key} className="space-y-1.5">
        {msg.message.content.map((c, i) =>
          c.type === 'text' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: content parts have no stable id
            <p key={i} className="whitespace-pre-wrap text-sm text-text">
              {c.text}
            </p>
          ) : c.type === 'tool_use' ? (
            <pre
              // biome-ignore lint/suspicious/noArrayIndexKey: content parts have no stable id
              key={i}
              className="overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs text-accent"
            >
              {c.name}({JSON.stringify(c.input)})
            </pre>
          ) : null,
        )}
      </div>
    )
  }
  if (msg.type === 'user') {
    return (
      <pre
        key={key}
        className="max-h-48 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-xs text-muted"
      >
        tool result: {JSON.stringify(msg.message.content)}
      </pre>
    )
  }
  if (msg.type === 'result') {
    return (
      <div
        key={key}
        className={`rounded-md border p-2 font-mono text-xs ${
          msg.is_error
            ? 'border-danger/40 text-danger'
            : 'border-success/40 text-success'
        }`}
      >
        {msg.subtype}, cost {usd(msg.total_cost_usd ?? 0)}, tokens{' '}
        {msg.usage ? msg.usage.input_tokens + msg.usage.output_tokens : 0}
      </div>
    )
  }
  return null
}

export function RunStream({
  runId,
  onClose,
  showClose = true,
}: {
  runId: string
  onClose: () => void
  showClose?: boolean
}) {
  const [history, setHistory] = useState<Event[] | null>(null)
  const { events: live } = useEvents(
    (e) => e.type === 'run.stream' && e.runId === runId,
  )
  const { push } = useToast()

  useEffect(() => {
    client.getRunEvents(runId).then(setHistory)
  }, [runId])

  const rendered = useMemo(
    () =>
      [...(history ?? []), ...live]
        .map((e, i) => {
          const msg = streamMessage(e)
          return msg ? renderMessage(msg, i) : null
        })
        .filter((n) => n !== null),
    [history, live],
  )

  async function kill() {
    try {
      await client.killRun(runId)
      push(`Stop requested for ${runId}`)
    } catch {
      push(`Failed to stop ${runId}`, 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-xs text-muted">{runId}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={kill}
            className="btn btn-danger btn-sm"
          >
            Kill
          </button>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn btn-quiet btn-sm"
            >
              Close
            </button>
          )}
        </div>
      </div>
      {history === null ? (
        <SkeletonRows rows={4} label="Loading run history…" />
      ) : rendered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No output recorded for this run.
        </p>
      ) : (
        <div className="flex flex-col gap-2">{rendered}</div>
      )}
    </div>
  )
}
