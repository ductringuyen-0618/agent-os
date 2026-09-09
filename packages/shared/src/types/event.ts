export type EventType =
  | 'run.queued'
  | 'run.started'
  | 'run.stream'
  | 'run.wrapup'
  | 'run.finished'
  | 'run.failed'
  | 'run.killed'
  | 'raw.added'
  | 'raw.changed'
  | 'proposal.changed'
  | 'decision.created'
  | 'decision.updated'
  | 'decision.resolved'
  | 'message.sent'
  | 'wiki.written'
  | 'schedule.created'
  | 'git.commit'
  | 'git.push'
  | 'ops.alert'
  | 'security.redacted'
  | `custom.${string}`
  | `workflow.${string}`

export interface Event {
  id: number
  ts: string
  type: EventType
  runId?: string
  payload: Record<string, unknown>
}

export type ClaudeStreamMessage =
  | { type: 'system'; subtype: 'init'; session_id: string; model?: string }
  | {
      type: 'assistant'
      message: {
        content: Array<{
          type: string
          text?: string
          name?: string
          input?: unknown
        }>
      }
      session_id: string
    }
  | { type: 'user'; message: { content: unknown }; session_id: string }
  | {
      type: 'result'
      subtype: 'success' | 'error_max_turns' | 'error_during_execution'
      session_id: string
      total_cost_usd?: number
      usage?: { input_tokens: number; output_tokens: number }
      result?: string
      is_error?: boolean
    }
