import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerReject(program: Command, client: ApiClient): void {
  program
    .command('reject <id>')
    .description('Reject a pending decision')
    .action(async (id: string) => {
      const decision = await client.rejectDecision(id)
      console.log(`${decision.id}  ${decision.status}`)
    })
}
