import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerSync(program: Command, client: ApiClient): void {
  program
    .command('sync <project>')
    .description('Sync a project now')
    .action(async (project: string) => {
      const result = await client.syncProject(project)
      console.log(
        `added: ${result.added.length}, changed: ${result.changed.length}`,
      )
    })
}
