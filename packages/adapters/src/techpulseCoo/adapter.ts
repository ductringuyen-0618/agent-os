import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AdapterContext,
  ProjectAdapter,
  SyncResult,
} from '@agentos/kernel/adapters/types'
import type { Decision } from '@agentos/shared'
import simpleGit from 'simple-git'
import { readStatus, setStatus } from './frontmatter.js'

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

function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : 'Untitled proposal'
}

function extractDecisionBody(content: string): string {
  const why = content.match(
    /^##\s+Why this increases engagement\s*\n([\s\S]*?)(?=\n##\s|$)/m,
  )
  const effort = content.match(
    /^##\s+Effort estimate\s*\n([\s\S]*?)(?=\n##\s|$)/m,
  )
  if (why || effort) {
    return [
      why ? `## Why this increases engagement\n${why[1].trim()}` : null,
      effort ? `## Effort estimate\n${effort[1].trim()}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join('\n\n')
  }
  return content.slice(0, 1500)
}

async function ensureDecision(
  ctx: AdapterContext,
  file: string,
  content: string,
): Promise<void> {
  const existing = ctx.log
    .listDecisions()
    .find((d) => d.adapter === 'techpulse-coo' && d.ref === file)
  if (existing) return
  const decision = ctx.log.createDecision({
    title: extractTitle(content),
    body: extractDecisionBody(content),
    adapter: 'techpulse-coo',
    ref: file,
    createdByRun: ctx.runId,
  })
  ctx.log.append({
    type: 'decision.created',
    runId: ctx.runId,
    payload: { decisionId: decision.id, ref: file },
  })
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
      const destRel = path.join('proposals', file)
      const mirrored = await mirrorFile(
        ctx,
        path.join(proposalsDir, file),
        destRel,
        result,
      )
      if (!mirrored) continue
      const newStatus = readStatus(mirrored.newContent)
      const oldStatus = mirrored.oldContent
        ? readStatus(mirrored.oldContent)
        : undefined
      if (oldStatus && oldStatus !== newStatus) {
        result.events.push('proposal.changed')
        ctx.log.append({
          type: 'proposal.changed',
          runId: ctx.runId,
          payload: { file: destRel, oldStatus, newStatus },
        })
      }
      if (newStatus === 'proposed') {
        await ensureDecision(ctx, destRel, mirrored.newContent)
      }
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
  async applyDecision(decision: Decision, ctx: AdapterContext): Promise<void> {
    const opts = ctx.project.options as unknown as TechpulseCooOptions
    const git = simpleGit(ctx.project.clone)
    try {
      await git.checkout(ctx.project.base_branch)
      await git.pull('origin', ctx.project.base_branch, ['--ff-only'])

      const file = decision.ref
      if (!file) throw new Error(`decision ${decision.id} has no ref`)
      const filePath = path.join(
        ctx.project.clone,
        opts.proposals_path,
        path.basename(file),
      )
      const content = await readFile(filePath, 'utf8')
      const targetStatus =
        decision.status === 'rejected' ? 'rejected' : 'approved'
      await writeFile(filePath, setStatus(content, targetStatus), 'utf8')

      const slug = path.basename(file).replace(/\.md$/, '')
      const verb = targetStatus === 'approved' ? 'approve' : 'reject'
      await git.add([path.join(opts.proposals_path, path.basename(file))])
      const subject = `chore(coo): ${verb} ${slug}`
      const commitResult = await git.commit(
        `${subject}\n\nCo-Authored-By: Claude via agent-os <noreply@anthropic.com>`,
      )
      ctx.log.append({
        type: 'git.commit',
        runId: ctx.runId,
        payload: {
          decisionId: decision.id,
          sha: commitResult.commit,
          message: subject,
        },
      })

      await git.push('origin', ctx.project.base_branch)
      ctx.log.append({
        type: 'git.push',
        runId: ctx.runId,
        payload: { decisionId: decision.id, branch: ctx.project.base_branch },
      })

      const date = new Date().toISOString().slice(0, 10)
      const approvalPath = path.join(
        ctx.cfg.osRoot,
        'output',
        'approvals',
        `${date}-${slug}.md`,
      )
      await mkdir(path.dirname(approvalPath), { recursive: true })
      await writeFile(
        approvalPath,
        `# ${verb === 'approve' ? 'Approved' : 'Rejected'}: ${slug}\n\n- decision: ${targetStatus}\n- timestamp: ${new Date().toISOString()}\n- commit: ${commitResult.commit}\n`,
        'utf8',
      )

      await ctx.wiki.writePage({
        path: `projects/techpulse/proposals/${slug}.md`,
        content: `# ${slug}\n\nStatus: ${targetStatus}\n\nDecision ${decision.id} resolved as ${targetStatus} (commit ${commitResult.commit}).\n`,
        op: 'decision',
        runId: ctx.runId,
      })

      ctx.log.resolveDecision(decision.id, targetStatus)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.log.resolveDecision(decision.id, 'error', message)
      ctx.log.append({
        type: 'ops.alert',
        runId: ctx.runId,
        payload: { decisionId: decision.id, error: message },
      })
      throw err
    }
  },
}

export { readStatus }
