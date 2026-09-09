import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerRoutinesCommand(
  program: Command,
  client: ApiClient,
): void {
  const routines = program
    .command('routines')
    .description('Manage scheduled routines')

  routines
    .command('list')
    .description('List routines with their next/last run')
    .action(async () => {
      const list = await client.listRoutines()
      for (const { routine, nextRun, lastRun } of list) {
        console.log(
          `${routine.name}\tnext=${nextRun ?? '-'}\tlast=${lastRun ? lastRun.status : '-'}`,
        )
      }
    })

  routines
    .command('run <name>')
    .description('Run a routine now')
    .action(async (name: string) => {
      const res = await client.runRoutine(name)
      console.log(`queued run ${res.runId}`)
    })

  routines
    .command('enable <name>')
    .description('Enable a routine')
    .action(async (name: string) => {
      await client.setRoutineEnabled(name, true)
      console.log(`enabled ${name}`)
    })

  routines
    .command('disable <name>')
    .description('Disable a routine')
    .action(async (name: string) => {
      await client.setRoutineEnabled(name, false)
      console.log(`disabled ${name}`)
    })
}
