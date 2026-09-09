import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerApprove(program: Command, client: ApiClient): void {
  program
    .command('approve <id>')
    .description('Approve a pending decision')
    .action(async (id: string) => {
      const decision = await client.approveDecision(id)
      console.log(`${decision.id}  ${decision.status}`)
    })
}
