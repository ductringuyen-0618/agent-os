#!/usr/bin/env node
import { Command } from 'commander'
import { ApiClient } from './client.js'
import { registerApprove } from './commands/approve.js'
import { registerDecisions } from './commands/decisions.js'
import { runInit } from './commands/init.js'
import { logs } from './commands/logs.js'
import { ps } from './commands/ps.js'
import { registerReject } from './commands/reject.js'
import { registerRoutinesCommand } from './commands/routines.js'
import { run as runCommand } from './commands/run.js'
import { registerSync } from './commands/sync.js'
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
  .command('init <dir>')
  .description('create a new agent-os instance from the built-in template')
  .option(
    '--template',
    'reserved for future template variants (currently a no-op)',
  )
  .action(async (dir: string, opts: { template?: boolean }) => {
    await runInit(dir, opts)
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

registerRoutinesCommand(program, client())
registerDecisions(program, client())
registerApprove(program, client())
registerReject(program, client())
registerSync(program, client())

program.parseAsync(process.argv)
