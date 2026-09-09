import type { WorkflowStatus } from '@agentos/shared'
import type { Command } from 'commander'
import type { ApiClient } from '../client.js'

export function registerWorkflowsCommand(
  program: Command,
  client: ApiClient,
): void {
  const workflows = program
    .command('workflows')
    .description('Manage workflow instances')

  workflows
    .command('list')
    .description('List workflow instances')
    .option('--status <status>', 'filter by status')
    .option('--project <project>', 'filter by project')
    .option('--kind <kind>', 'filter by kind')
    .action(
      async (opts: {
        status?: WorkflowStatus
        project?: string
        kind?: string
      }) => {
        const list = await client.listWorkflows(opts)
        for (const w of list) {
          console.log(`${w.id}\t[${w.status}]\t${w.kind}\t${w.title}`)
        }
      },
    )

  workflows
    .command('show <id>')
    .description('Show a workflow instance and its steps')
    .action(async (id: string) => {
      const { workflow, steps } = await client.getWorkflow(id)
      console.log(
        `${workflow.id}  [${workflow.status}]  ${workflow.kind}  ${workflow.title}`,
      )
      for (const s of steps) {
        console.log(
          `  ${s.seq}. ${s.name}\t[${s.status}]\tattempt ${s.attempt}${s.runId ? `\trun=${s.runId}` : ''}`,
        )
      }
    })

  workflows
    .command('pause <id>')
    .description('Pause a workflow instance')
    .action(async (id: string) => {
      await client.pauseWorkflow(id)
      console.log(`paused ${id}`)
    })

  workflows
    .command('resume <id>')
    .description('Resume a paused or failed workflow instance')
    .action(async (id: string) => {
      await client.resumeWorkflow(id)
      console.log(`resumed ${id}`)
    })

  workflows
    .command('terminate <id>')
    .description('Terminate a workflow instance')
    .action(async (id: string) => {
      await client.terminateWorkflow(id)
      console.log(`terminated ${id}`)
    })
}
