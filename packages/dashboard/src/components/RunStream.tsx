import type { ClaudeStreamMessage, Event } from '@agentos/shared'
import { useEffect, useMemo, useState } from 'react'
import { ApiClient } from '../api/client'
import { useEvents } from '../api/ws'
import { Spinner } from './Spinner'
import { useToast } from './Toast'

const client = new ApiClient()

function renderMessage(msg: ClaudeStreamMessage, key: number) {
  if (msg.type === 'assistant') {
    return (
      <div key={key} className="space-y-1">
        {msg.message.content.map((c, i) =>
          c.type === 'text' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: content parts have no stable id
            <p key={i} className="text-sm text-text">
              {c.text}
            </p>
          ) : c.type === 'tool_use' ? (
            <pre
              // biome-ignore lint/suspicious/noArrayIndexKey: content parts have no stable id
              key={i}
              className="rounded border border-border bg-background p-2 font-mono text-xs text-accent"
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
        className="rounded border border-border bg-background p-2 font-mono text-xs text-muted"
      >
        tool_result: {JSON.stringify(msg.message.content)}
      </pre>
    )
  }
  if (msg.type === 'result') {
    return (
      <div
        key={key}
        className="rounded border border-border bg-surface p-2 font-mono text-xs text-muted"
      >
        result: {msg.subtype} · cost $
        {msg.total_cost_usd?.toFixed(4) ?? '0.0000'} · tokens{' '}
        {msg.usage ? msg.usage.input_tokens + msg.usage.output_tokens : 0}
      </div>
    )
  }
  return null
}

export function RunStream({
  runId,
  onClose,
}: {
  runId: string
  onClose: () => void
}) {
  const [history, setHistory] = useState<Event[] | null>(null)
  const { events: live } = useEvents(
    (e) => e.type === 'run.stream' && e.runId === runId,
  )
  const { push } = useToast()

  useEffect(() => {
    client.getRunEvents(runId).then(setHistory)
  }, [runId])

  const all = useMemo(() => [...(history ?? []), ...live], [history, live])

  async function kill() {
    try {
      await client.killRun(runId)
      push(`Kill requested for ${runId}`)
    } catch {
      push(`Failed to kill ${runId}`, 'error')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-sm">{runId}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={kill}
            className="rounded border border-danger px-2 py-1 text-xs text-danger"
          >
            Kill
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-muted"
          >
            Close
          </button>
        </div>
      </div>
      {history === null ? (
        <Spinner label="Loading run history…" />
      ) : (
        <div className="flex flex-col gap-2">
          {all.map((e, i) => {
            const msg = (e.payload as { message?: ClaudeStreamMessage }).message
            return msg ? renderMessage(msg, i) : null
          })}
        </div>
      )}
    </div>
  )
}
