export type WorkflowStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'sleeping'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'terminated'

export interface WorkflowInstance {
  id: string
  kind: string
  status: WorkflowStatus
  project?: string
  title: string
  input: Record<string, unknown>
  state: Record<string, unknown>
  currentStep?: string
  wakeAt?: string
  waitEvent?: string
  error?: string
  createdAt: string
  startedAt?: string
  endedAt?: string
  updatedAt: string
}

export type WorkflowStepStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'waiting'
  | 'sleeping'

export interface WorkflowStep {
  id: string
  workflowId: string
  name: string
  seq: number
  status: WorkflowStepStatus
  attempt: number
  runId?: string
  output?: unknown
  error?: string
  startedAt: string
  endedAt?: string
}
