import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerSystemCommands(
  program: Command,
  client: ApiClient,
): void {
  program
    .command('pause')
    .description('Pause the daemon: no routine starts new work until resumed')
    .option('--reason <text>', 'why the daemon is being paused')
    .option('--stop-running', 'also kill runs already in progress')
    .action(async (opts: { reason?: string; stopRunning?: boolean }) => {
      const { stopped } = await client.pauseSystem({
        reason: opts.reason,
        by: 'cli',
        stopRunning: opts.stopRunning,
      })
      console.log(
        stopped === undefined
          ? 'paused'
          : `paused (stopped ${stopped} run${stopped === 1 ? '' : 's'})`,
      )
    })

  program
    .command('resume')
    .description('Resume the daemon after a pause')
    .action(async () => {
      await client.resumeSystem()
      console.log('resumed')
    })
}
