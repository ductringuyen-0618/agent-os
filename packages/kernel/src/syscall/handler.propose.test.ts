import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProjectConfig } from '@agentos/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from '../log/eventLog.js'
import { WikiService } from '../wiki/wikiService.js'
import { type SyscallContext, SyscallError, handleSyscall } from './handler.js'

let osRoot: string
let log: EventLog
let created: Array<{ kind: string; input: Record<string, unknown> }>
let open: Array<{
  id: string
  title: string
  status: string
  project?: string
  kind: string
}>

const techpulse: ProjectConfig = {
  name: 'techpulse',
  adapter: 'coo-missions',
  repo: 'https://github.com/o/r.git',
  clone: '/clones/techpulse',
  base_branch: 'main',
  options: {},
}
const pending: ProjectConfig = {
  name: 'widgets',
  repo: 'https://github.com/o/w.git',
  clone: '/clones/widgets',
  base_branch: 'main',
  options: {},
  setup: {
    adapter: 'coo-missions',
    branch: 'agentos/coo-setup',
    status: 'pending',
  },
}

function makeCtx(): SyscallContext {
  return {
    runId: 'run-1',
    agent: 'coo',
    osRoot,
    log,
    wiki: new WikiService(osRoot, log),
    // biome-ignore lint/suspicious/noExplicitAny: scheduler is not exercised here
    scheduler: {} as any,
    workflows: {
      create: async (kind, input, opts) => {
        created.push({ kind, input })
        open.push({
          id: `wf-${created.length}`,
          title: opts?.title ?? kind,
          status: 'queued',
          project: opts?.project,
          kind,
        })
        return { id: `wf-${created.length}` }
      },
      list: (opts) =>
        open.filter((w) => !opts?.project || w.project === opts.project),
    },
    loadProjects: async () => [techpulse, pending],
  }
}

const DESCRIPTION =
  'What you get: alerts for followed companies. Why now: the follow model exists. Scope: one route and one page.'

beforeEach(async () => {
  osRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-propose-'))
  await fs.mkdir(path.join(osRoot, 'wiki'), { recursive: true })
  log = new EventLog(path.join(osRoot, 'test.db'))
  created = []
  open = []
})

afterEach(async () => {
  log.close()
  await fs.rm(osRoot, { recursive: true, force: true })
})

describe('propose_feature', () => {
  it('starts a feature request that waits for a human and logs it', async () => {
    const res = (await handleSyscall(
      'propose_feature',
      {
        project: 'techpulse',
        title: 'Add saved-search alerts',
        description: DESCRIPTION,
      },
      makeCtx(),
    )) as { workflowId: string }
    expect(res.workflowId).toBe('wf-1')
    expect(created).toEqual([
      {
        kind: 'feature-request',
        input: {
          project: 'techpulse',
          title: 'Add saved-search alerts',
          description: DESCRIPTION,
          autoApprove: false,
        },
      },
    ])
    expect(log.listEvents({ types: ['custom.coo.proposed'] })).toHaveLength(1)
  })

  it('refuses a second idea while one is still open for the project', async () => {
    const ctx = makeCtx()
    await handleSyscall(
      'propose_feature',
      {
        project: 'techpulse',
        title: 'First idea today',
        description: DESCRIPTION,
      },
      ctx,
    )
    await expect(
      handleSyscall(
        'propose_feature',
        {
          project: 'techpulse',
          title: 'Second idea today',
          description: DESCRIPTION,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'idea_in_flight' })
    expect(created).toHaveLength(1)
  })

  it('refuses while a decision for the project is pending', async () => {
    log.createDecision({ title: 'Older idea', body: 'x', project: 'techpulse' })
    await expect(
      handleSyscall(
        'propose_feature',
        {
          project: 'techpulse',
          title: 'Another idea',
          description: DESCRIPTION,
        },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: 'idea_in_flight' })
  })

  it('refuses a project whose setup pull request is not merged', async () => {
    await expect(
      handleSyscall(
        'propose_feature',
        {
          project: 'widgets',
          title: 'Anything at all',
          description: DESCRIPTION,
        },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: 'project_not_ready' })
  })

  it('refuses an unknown project and a missing description', async () => {
    await expect(
      handleSyscall(
        'propose_feature',
        { project: 'nope', title: 'Anything at all', description: DESCRIPTION },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: 'unknown_project' })
    await expect(
      handleSyscall(
        'propose_feature',
        { project: 'techpulse', title: 'Short', description: 'too short' },
        makeCtx(),
      ),
    ).rejects.toThrow()
  })

  it('is unavailable without a workflow engine in the context', async () => {
    const ctx = makeCtx()
    ctx.workflows = undefined
    await expect(
      handleSyscall(
        'propose_feature',
        {
          project: 'techpulse',
          title: 'Anything at all',
          description: DESCRIPTION,
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(SyscallError)
  })
})
