import type { DecisionStatus } from '@agentos/shared'
import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerDecisions(program: Command, client: ApiClient): void {
  program
    .command('decisions')
    .description('List decisions')
    .option('--status <status>', 'filter by status')
    .action(async (opts: { status?: DecisionStatus }) => {
      const decisions = await client.listDecisions(opts.status)
      for (const d of decisions) {
        console.log(
          `${d.id}  [${d.status}]  ${d.title}${d.ref ? ` (${d.ref})` : ''}`,
        )
      }
    })
}
