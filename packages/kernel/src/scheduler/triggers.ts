import type { Run } from '@agentos/shared'

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export function parseEvery(spec: string): number {
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(spec.trim())
  if (!m) throw new Error(`invalid every duration: ${spec}`)
  return Number(m[1]) * UNIT_MS[m[2]]
}

export function matchesOn(
  on: string[] | undefined,
  eventType: string,
): boolean {
  if (!on || on.length === 0) return false
  return on.some(
    (pattern) =>
      pattern === eventType ||
      (pattern === 'custom.*' && eventType.startsWith('custom.')),
  )
}

function isToday(iso?: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  )
}

export function afterSatisfied(
  after: string[] | undefined,
  lastRunsToday: Map<string, Run | undefined>,
): boolean {
  if (!after || after.length === 0) return true
  return after.every((name) => {
    const run = lastRunsToday.get(name)
    return !!run && run.status === 'success' && isToday(run.endedAt)
  })
}
