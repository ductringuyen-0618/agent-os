import type { ApiClient } from '../client.js'

export async function ps(client: ApiClient): Promise<void> {
  const runs = await client.listRuns({ limit: 50 })
  if (runs.length === 0) {
    console.log('no runs yet')
    return
  }
  for (const run of runs) {
    console.log(
      `${run.id}  ${run.status.padEnd(10)}  ${run.routine}  agent=${run.agent ?? '-'}  skill=${run.skill ?? '-'}`,
    )
  }
}
