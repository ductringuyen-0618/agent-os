import type { GetWorkflowResponse, WorkflowStatus } from '@agentos/shared'
import { useCallback, useEffect, useState } from 'react'
import { ApiClient, ApiError } from '../api/client'
import { useEvents } from '../api/ws'
import { duration, usd } from '../lib/time'
import {
  currentStepIndex,
  isTerminal,
  workflowCostUsd,
  workflowIdOf,
} from '../lib/workflow'
import { ConfirmSheet } from './ConfirmSheet'
import { ErrorState } from './ErrorState'
import { RunStream } from './RunStream'
import { SkeletonRows } from './Skeleton'
import { StatusBadge } from './StatusBadge'
import { useToast } from './Toast'
import { WorkflowStepper } from './WorkflowStepper'

const client = new ApiClient()
const PAUSABLE: WorkflowStatus[] = ['running', 'waiting', 'sleeping']

export function RequestView({ workflowId }: { workflowId: string }) {
  const [detail, setDetail] = useState<GetWorkflowResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingTerminate, setConfirmingTerminate] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const { push } = useToast()
  const { events } = useEvents(
    (e) => e.type.startsWith('workflow.') && workflowIdOf(e) === workflowId,
  )

  const load = useCallback(() => {
    setError(null)
    client
      .getWorkflow(workflowId)
      .then(setDetail)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Failed to load request'),
      )
  }, [workflowId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length re-fetches on every workflow.* event for this id
  useEffect(() => {
    load()
  }, [load, events.length])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])

  async function pause() {
    setBusy(true)
    try {
      await client.pauseWorkflow(workflowId)
      push('Paused')
    } catch {
      push('Failed to pause', 'error')
    } finally {
      setBusy(false)
      load()
    }
  }

  async function resume() {
    setBusy(true)
    try {
      await client.resumeWorkflow(workflowId)
      push('Resumed')
    } catch {
      push('Failed to resume', 'error')
    } finally {
      setBusy(false)
      load()
    }
  }

  async function retry() {
    setBusy(true)
    try {
      await client.resumeWorkflow(workflowId)
      push('Retrying from the failed step')
    } catch {
      push('Failed to retry', 'error')
    } finally {
      setBusy(false)
      load()
    }
  }

  async function terminate() {
    setBusy(true)
    try {
      await client.terminateWorkflow(workflowId)
      push('Terminated')
    } catch {
      push('Failed to terminate', 'error')
    } finally {
      setBusy(false)
      setConfirmingTerminate(false)
      load()
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (detail === null) return <SkeletonRows rows={5} label="Loading request…" />

  const { workflow, steps } = detail
  const idx = currentStepIndex(workflow, steps)
  const activeStep = idx >= 0 ? steps[idx] : undefined

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-text">{workflow.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge status={workflow.status} />
            {workflow.project && (
              <span className="chip">{workflow.project}</span>
            )}
            <span className="font-mono">
              {duration(workflow.startedAt, workflow.endedAt, now)}
            </span>
            <span className="font-mono">{usd(workflowCostUsd(workflow))}</span>
          </div>
          {workflow.error && (
            <p className="mt-2 text-xs text-danger">{workflow.error}</p>
          )}
        </div>
        <div className="flex gap-2">
          {PAUSABLE.includes(workflow.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={pause}
              className="btn btn-quiet btn-sm"
            >
              Pause
            </button>
          )}
          {workflow.status === 'paused' && (
            <button
              type="button"
              disabled={busy}
              onClick={resume}
              className="btn btn-accent btn-sm"
            >
              Resume
            </button>
          )}
          {workflow.status === 'failed' && (
            <button
              type="button"
              disabled={busy}
              onClick={retry}
              className="btn btn-accent btn-sm"
            >
              Retry from this step
            </button>
          )}
          {!isTerminal(workflow.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingTerminate(true)}
              className="btn btn-danger btn-sm"
            >
              Terminate
            </button>
          )}
        </div>
      </header>

      <WorkflowStepper steps={steps} now={now} />

      {activeStep?.runId && (
        <div className="card p-3">
          <h4 className="mb-2 text-xs font-medium text-muted">
            {activeStep.name}
          </h4>
          <RunStream
            runId={activeStep.runId}
            onClose={() => {}}
            showClose={false}
          />
        </div>
      )}

      <ConfirmSheet
        open={confirmingTerminate}
        title="Terminate request?"
        confirmLabel="Terminate request"
        tone="danger"
        busy={busy}
        onConfirm={terminate}
        onCancel={() => setConfirmingTerminate(false)}
      >
        <p>
          Stops the current step's run and marks this request terminated. Any
          branch or commits it already made stay in place for you to pick up by
          hand.
        </p>
      </ConfirmSheet>
    </div>
  )
}
