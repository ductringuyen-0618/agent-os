export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'error'

export interface Decision {
  id: string
  title: string
  body: string
  adapter?: string
  /** Project the decision belongs to (os/projects/<name>.yaml), when adapter-raised. */
  project?: string
  ref?: string
  status: DecisionStatus
  createdByRun?: string
  createdAt: string
  resolvedAt?: string
  error?: string
}
