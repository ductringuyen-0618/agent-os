import type { Event, PauseState } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { clockTime } from '../lib/time'
import { ConfirmSheet } from './ConfirmSheet'
import { Icon } from './Icon'
import { useToast } from './Toast'

const client = new ApiClient()

function isPauseEvent(e: Event): boolean {
  return (
    e.type === 'ops.alert' &&
    (e.payload.reason === 'daemon_paused' ||
      e.payload.reason === 'daemon_resumed')
  )
}

/**
 * Persistent header control, visible above every panel: a slim "Pause all"
 * button when the daemon is running, or a full-width red banner with a
 * Resume button when it is paused. Loads the current state on mount (so a
 * dashboard opened fresh while paused still shows the banner) and updates
 * live from the same `ops.alert` the activity feed already subscribes to.
 */
export function SystemPauseBar() {
  const [pause, setPause] = useState<PauseState | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [stopRunning, setStopRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const { push } = useToast()
  const { events } = useEvents(isPauseEvent)

  const refresh = useCallback(() => {
    client
      .getSystemPause()
      .then(setPause)
      .catch(() => {
        /* leave the last known state on a transient fetch failure */
      })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (events.length > 0) refresh()
  }, [events, refresh])

  async function confirmPause() {
    setBusy(true)
    try {
      const { pause: next, stopped } = await client.pauseSystem({
        reason: reason.trim() || undefined,
        by: 'dashboard',
        stopRunning,
      })
      setPause(next)
      setConfirmOpen(false)
      setReason('')
      setStopRunning(false)
      push(
        stopped !== undefined
          ? `Paused agent-os (stopped ${stopped} run${stopped === 1 ? '' : 's'})`
          : 'Paused agent-os',
      )
    } catch (e) {
      push(e instanceof ApiError ? e.message : 'Failed to pause', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resume() {
    setBusy(true)
    try {
      await client.resumeSystem()
      setPause(null)
      push('Resumed agent-os')
    } catch (e) {
      push(e instanceof ApiError ? e.message : 'Failed to resume', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (pause) {
    return (
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-danger bg-danger/10 px-4 py-2 text-sm">
        <span className="text-danger">
          <strong className="font-medium">Paused</strong> since{' '}
          {clockTime(pause.at)}
          {pause.by ? ` by ${pause.by}` : ''}:{' '}
          {pause.reason || 'no reason given'}
        </span>
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="btn btn-danger btn-sm"
        >
          {busy ? 'Resuming…' : 'Resume'}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex shrink-0 justify-end border-b border-border px-4 py-1.5">
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="btn btn-quiet btn-sm"
        >
          <Icon name="stop" size={12} />
          Pause all
        </button>
      </div>
      <ConfirmSheet
        open={confirmOpen}
        title="Pause agent-os"
        confirmLabel="Pause"
        tone="danger"
        busy={busy}
        onConfirm={confirmPause}
        onCancel={() => setConfirmOpen(false)}
      >
        <p className="mb-3">
          Stops every cron, interval, and event-triggered routine from starting
          new work until you resume. This survives a daemon restart.
        </p>
        <label className="mb-2 block text-xs text-muted" htmlFor="pause-reason">
          Reason (optional)
        </label>
        <input
          id="pause-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. investigating a bad deploy"
          className="mb-3 w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text"
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={stopRunning}
            onChange={(e) => setStopRunning(e.target.checked)}
          />
          Also stop runs already in progress
        </label>
      </ConfirmSheet>
    </>
  )
}
