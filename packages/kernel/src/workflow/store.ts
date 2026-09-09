import type {
  WorkflowInstance,
  WorkflowStatus,
  WorkflowStep,
  WorkflowStepStatus,
} from '@agentos/shared'
import type { EventLog } from '../log/eventLog.js'

/**
 * Thin domain facade over EventLog's raw workflow CRUD: adds the
 * name-addressed step lookups and attempt-reset behaviour the engine needs
 * for replay, without teaching EventLog itself about replay semantics.
 */
export class WorkflowStore {
  constructor(private log: EventLog) {}

  create(i: {
    kind: string
    project?: string
    title: string
    input: Record<string, unknown>
  }): WorkflowInstance {
    return this.log.createWorkflow(i)
  }

  get(id: string): WorkflowInstance | undefined {
    return this.log.getWorkflow(id)
  }

  list(
    opts: { status?: WorkflowStatus; kind?: string; project?: string } = {},
  ): WorkflowInstance[] {
    return this.log.listWorkflows(opts)
  }

  update(id: string, patch: Partial<WorkflowInstance>): WorkflowInstance {
    return this.log.updateWorkflow(id, patch)
  }

  steps(workflowId: string): WorkflowStep[] {
    return this.log.listWorkflowSteps(workflowId)
  }

  getStep(workflowId: string, name: string): WorkflowStep | undefined {
    return this.steps(workflowId).find((s) => s.name === name)
  }

  createStep(
    workflowId: string,
    name: string,
    seq: number,
    status: WorkflowStepStatus = 'running',
  ): WorkflowStep {
    return this.log.createWorkflowStep({ workflowId, name, seq, status })
  }

  updateStep(id: string, patch: Partial<WorkflowStep>): WorkflowStep {
    return this.log.updateWorkflowStep(id, patch)
  }

  /** Deletes a failed step's row so a replay treats it as never-started (fresh attempt 1). */
  resetFailedStep(workflowId: string, name: string): void {
    const step = this.getStep(workflowId, name)
    if (step && step.status === 'failed') this.log.deleteWorkflowStep(step.id)
  }
}
