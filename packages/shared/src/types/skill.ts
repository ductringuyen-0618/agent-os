export interface EvalCriteria {
  criteria: Array<{ key: string; weight: number; description: string }>
}

export interface SkillMeta {
  name: string
  path: string
  /** True when learnings.md has dated entries beyond the bootstrap note. */
  hasLearnings: boolean
  lastScore?: number
  /** First paragraph of the skill's instructions, as a one-line summary. */
  description?: string
  /** Routines whose `skill:` is this skill. */
  routines?: string[]
  /** Finished runs of this skill recorded in the event log. */
  runs?: number
  succeeded?: number
  lastRunAt?: string
  lastStatus?: string
  costUsd?: number
}
