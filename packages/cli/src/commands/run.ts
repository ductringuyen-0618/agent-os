import type { ApiClient } from '../client.js'

export interface RunOptions {
  skill: string
  agent?: string
  payload?: string
}

export async function run(
  client: ApiClient,
  opts: RunOptions,
): Promise<string> {
  const payload = opts.payload
    ? (JSON.parse(opts.payload) as Record<string, unknown>)
    : undefined
  const { runId } = await client.createRun({
    skill: opts.skill,
    agent: opts.agent,
    payload,
  })
  console.log(`started run ${runId}`)
  return runId
}
