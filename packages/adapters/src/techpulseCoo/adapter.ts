import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AdapterContext,
  ProjectAdapter,
  SyncResult,
} from '@agentos/kernel/adapters/types'
import simpleGit from 'simple-git'
import { readStatus } from './frontmatter.js'

interface TechpulseCooOptions {
  proposals_path: string
  state_path: string
  reports_path: string
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function pathExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false)
}

async function ensureClone(ctx: AdapterContext): Promise<void> {
  const { project } = ctx
  if (await pathExists(path.join(project.clone, '.git'))) {
    const repoGit = simpleGit(project.clone)
    await repoGit.fetch('origin')
    await repoGit.checkout(project.base_branch)
    await repoGit.pull('origin', project.base_branch, ['--ff-only'])
    return
  }
  await mkdir(path.dirname(project.clone), { recursive: true })
  await simpleGit().clone(project.repo, project.clone)
}

async function listMdFiles(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) return []
  const entries = await readdir(dir)
  return entries.filter((f) => f.endsWith('.md')).sort()
}

interface MirrorOutcome {
  oldContent?: string
  newContent: string
}

async function mirrorFile(
  ctx: AdapterContext,
  srcPath: string,
  destRelPath: string,
  result: SyncResult,
): Promise<MirrorOutcome | null> {
  const content = await readFile(srcPath, 'utf8')
  const destPath = path.join(
    ctx.cfg.osRoot,
    'raw',
    ctx.project.name,
    destRelPath,
  )
  const destExisted = await pathExists(destPath)
  let oldContent: string | undefined
  if (destExisted) {
    oldContent = await readFile(destPath, 'utf8')
    if (hash(oldContent) === hash(content)) return null
  }
  await mkdir(path.dirname(destPath), { recursive: true })
  await writeFile(destPath, content, 'utf8')
  if (destExisted) {
    result.changed.push(destRelPath)
  } else {
    result.added.push(destRelPath)
    result.events.push('raw.added')
    ctx.log.append({
      type: 'raw.added',
      runId: ctx.runId,
      payload: { project: ctx.project.name, file: destRelPath },
    })
  }
  return { oldContent, newContent: content }
}

export const techpulseCooAdapter: ProjectAdapter = {
  name: 'techpulse-coo',
  async sync(ctx: AdapterContext): Promise<SyncResult> {
    const opts = ctx.project.options as unknown as TechpulseCooOptions
    await ensureClone(ctx)
    const result: SyncResult = { added: [], changed: [], events: [] }

    const proposalsDir = path.join(ctx.project.clone, opts.proposals_path)
    for (const file of await listMdFiles(proposalsDir)) {
      await mirrorFile(
        ctx,
        path.join(proposalsDir, file),
        path.join('proposals', file),
        result,
      )
    }

    const reportsDir = path.join(ctx.project.clone, opts.reports_path)
    for (const file of await listMdFiles(reportsDir)) {
      await mirrorFile(
        ctx,
        path.join(reportsDir, file),
        path.join('reports', file),
        result,
      )
    }

    const statePath = path.join(ctx.project.clone, opts.state_path)
    if (await pathExists(statePath)) {
      await mirrorFile(ctx, statePath, 'state.md', result)
    }

    return result
  },
  async applyDecision() {
    throw new Error('techpulse-coo applyDecision not implemented')
  },
}

export { readStatus }
