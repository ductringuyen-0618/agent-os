export interface EvalCriteria {
  criteria: Array<{ key: string; weight: number; description: string }>
}

export interface SkillMeta {
  name: string
  path: string
  hasLearnings: boolean
  lastScore?: number
}
