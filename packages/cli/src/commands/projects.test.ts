import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../client.js'
import { registerProjectsCommand } from './projects.js'

function makeClient() {
  return {
    listProjects: vi.fn(async () => [
      {
        config: {
          name: 'widgets',
          adapter: 'techpulse-coo',
          repo: 'octo/widgets',
          clone: '/c/widgets',
          base_branch: 'main',
          options: {},
        },
        routines: ['widgets-sync'],
        hasCooLayout: true,
      },
    ]),
    addProject: vi.fn(async (input) => ({
      project: {
        name: input.name ?? 'widgets',
        adapter: 'techpulse-coo',
        repo: input.repo,
        clone: '/c/widgets',
        base_branch: 'main',
        options: {},
      },
      sync: { added: [], changed: [], events: [] },
    })),
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural ApiClient stub
  } as any as ApiClient
}

describe('agentos projects', () => {
  it('list prints registered projects', async () => {
    const client = makeClient()
    const program = new Command()
    registerProjectsCommand(program, client)
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((s: string) => logs.push(s))

    await program.parseAsync(['node', 'agentos', 'projects', 'list'])

    expect(client.listProjects).toHaveBeenCalled()
    expect(logs.join('\n')).toContain('widgets')
  })

  it('add calls addProject with the parsed flags', async () => {
    const client = makeClient()
    const program = new Command()
    registerProjectsCommand(program, client)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync([
      'node',
      'agentos',
      'projects',
      'add',
      'octo/widgets',
      '--name',
      'w',
      '--base-branch',
      'dev',
      '--build',
    ])

    expect(client.addProject).toHaveBeenCalledWith({
      repo: 'octo/widgets',
      name: 'w',
      base_branch: 'dev',
      build: true,
    })
  })

  it('add without --build omits build from the request', async () => {
    const client = makeClient()
    const program = new Command()
    registerProjectsCommand(program, client)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync([
      'node',
      'agentos',
      'projects',
      'add',
      'octo/widgets',
    ])

    expect(client.addProject).toHaveBeenCalledWith({
      repo: 'octo/widgets',
      name: undefined,
      base_branch: undefined,
      build: false,
    })
  })
})
