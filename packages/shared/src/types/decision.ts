export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'error'

export interface Decision {
  id: string
  title: string
  body: string
  adapter?: string
  ref?: string
  status: DecisionStatus
  createdByRun?: string
  createdAt: string
  resolvedAt?: string
  error?: string
}
