#!/usr/bin/env node
import { EventLog } from '@agentos/kernel'

/**
 * Seeds one running feature-request instance so the e2e kernel has a live
 * request to show in the Requests panel.
 *
 * Uses EventLog's own createWorkflow/updateWorkflow/createWorkflowStep
 * methods (packages/kernel/src/log/eventLog.ts) rather than raw SQL against
 * the workflows/workflow_steps tables: those methods already exist on this
 * branch (mirroring how seed-decision.mjs seeds via EventLog.createDecision
 * rather than hand-rolled SQL), so there is no need for a second, redundant
 * better-sqlite3 devDependency just for this script.
 */
export function seedWorkflow(dbPath) {
  const log = new EventLog(dbPath)
  const now = new Date().toISOString()

  const workflow = log.createWorkflow({
    kind: 'feature-request',
    project: 'techpulse',
    title: 'Add a personalized company digest',
    input: {
      project: 'techpulse',
      title: 'Add a personalized company digest',
      description: 'Summarize the week per company the user follows.',
      autoApprove: true,
    },
  })

  log.updateWorkflow(workflow.id, {
    status: 'running',
    currentStep: 'build',
    state: { brief: { costUsd: 0.08 } },
    startedAt: now,
  })

  const brief = log.createWorkflowStep({
    workflowId: workflow.id,
    name: 'brief',
    seq: 1,
    status: 'succeeded',
    attempt: 1,
  })
  log.updateWorkflowStep(brief.id, {
    status: 'succeeded',
    output: { costUsd: 0.08 },
    endedAt: now,
  })

  const build = log.createWorkflowStep({
    workflowId: workflow.id,
    name: 'build',
    seq: 2,
    status: 'running',
    attempt: 1,
  })
  // A runId lets RequestView show the active step's RunStream inline, even
  // though no fake-claude run actually exists under it here: GET
  // /api/runs/:id/events just returns an empty event list for an unknown
  // run id, which renders as "No output recorded for this run."
  log.updateWorkflowStep(build.id, {
    status: 'running',
    runId: 'run_e2e_build',
  })

  log.close()
  return workflow.id
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.argv[2]
  if (!dbPath) {
    console.error('usage: seed-workflow.mjs <dbPath>')
    process.exit(1)
  }
  console.log(seedWorkflow(dbPath))
}
