import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerProjectsCommand(
  program: Command,
  client: ApiClient,
): void {
  const projects = program
    .command('projects')
    .description('Manage agent-os projects')

  projects
    .command('list')
    .description('List registered projects')
    .action(async () => {
      const items = await client.listProjects()
      for (const { config, routines, lastSync, hasCooLayout } of items) {
        console.log(
          `${config.name}  adapter=${config.adapter}  base=${config.base_branch}  routines=${routines.join(',') || 'none'}  lastSync=${lastSync?.status ?? 'never'}  hasCooLayout=${hasCooLayout}`,
        )
      }
    })

  projects
    .command('add <repo>')
    .description('Register a GitHub repo as a project')
    .option('--name <name>', 'project name (defaults to the repo name)')
    .option(
      '--base-branch <branch>',
      'base branch (defaults to the repo default branch)',
    )
    .option('--build', 'allow agent-os to build features in this repo', false)
    .action(
      async (
        repo: string,
        opts: { name?: string; baseBranch?: string; build?: boolean },
      ) => {
        const result = await client.addProject({
          repo,
          name: opts.name,
          base_branch: opts.baseBranch,
          build: opts.build ?? false,
        })
        console.log(
          `added ${result.project.name} (${result.project.repo}) -- sync: added ${result.sync.added.length}, changed ${result.sync.changed.length}${result.syncError ? `, error: ${result.syncError}` : ''}`,
        )
      },
    )
}
