import type { ApiClient } from '../client.js'

export async function logs(client: ApiClient, runId: string): Promise<void> {
  const events = await client.getRunEvents(runId)
  for (const event of events) {
    console.log(`[${event.ts}] ${event.type} ${JSON.stringify(event.payload)}`)
  }
}
