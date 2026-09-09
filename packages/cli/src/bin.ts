#!/usr/bin/env node
import { Command } from 'commander'
import { ApiClient } from './client.js'
import { logs } from './commands/logs.js'
import { ps } from './commands/ps.js'
import { run as runCommand } from './commands/run.js'
import { up } from './commands/up.js'

const program = new Command()
program.name('agentos').description('agent-os CLI').version('0.1.0')

function client(): ApiClient {
  const baseUrl =
    process.env.AGENTOS_URL ??
    `http://127.0.0.1:${process.env.AGENTOS_PORT ?? '4545'}`
  return new ApiClient({ baseUrl, token: process.env.AGENTOS_TOKEN })
}

program
  .command('up')
  .description('start the agent-os daemon')
  .requiredOption('--root <path>', 'path to the os/ directory')
  .option('--port <port>', 'HTTP port')
  .action(async (opts) => {
    await up({ root: opts.root, port: opts.port })
  })

program
  .command('ps')
  .description('list recent runs')
  .action(async () => {
    await ps(client())
  })

program
  .command('logs <runId>')
  .description('print events for a run')
  .action(async (runId: string) => {
    await logs(client(), runId)
  })

program
  .command('run <skill>')
  .description('start a run for a skill')
  .option('--agent <agent>', 'agent to run as')
  .option('--payload <json>', 'JSON payload')
  .action(async (skill: string, opts) => {
    await runCommand(client(), {
      skill,
      agent: opts.agent,
      payload: opts.payload,
    })
  })

program.parseAsync(process.argv)
