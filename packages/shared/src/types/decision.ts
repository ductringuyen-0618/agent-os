export type DecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  /** Nobody decided within the expiry window; the idea is kept on file, never rebuilt. */
  | 'expired'
  | 'error'

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
