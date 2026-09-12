import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ErrorResponse, SkillMeta } from '@agentos/shared'
import type { FastifyInstance } from 'fastify'
import type { EventLog } from '../log/eventLog.js'
import type { Scheduler } from '../scheduler/scheduler.js'

export interface SkillRouteDeps {
  osRoot: string
  log: EventLog
  scheduler?: Scheduler
}

/**
 * Skill files ship as SKILL.md / LEARNINGS.md in the template but older
 * instances used lowercase names. Case-insensitive filesystems hide the
 * difference; Linux does not, so try both.
 */
async function readSkillFile(dir: string, base: string): Promise<string> {
  const [stem, ext] = base.split(/\.(?=[^.]+$)/)
  for (const candidate of [
    `${stem.toUpperCase()}.${ext}`,
    base.toLowerCase(),
    base,
  ]) {
    try {
      return await fsp.readFile(path.join(dir, candidate), 'utf8')
    } catch {}
  }
  return ''
}

/**
 * The first prose paragraph after the title, on one line. Skill files
 * open with "# name" then a sentence or two saying what the skill does,
 * which is exactly what a list needs.
 */
export function skillDescription(skillMd: string, max = 220): string {
  // An explicit `description:` in SKILL.md frontmatter wins over guessing.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skillMd)
  if (fm) {
    const m = /^description:\s*(.+)$/m.exec(fm[1])
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  const body = fm ? skillMd.slice(fm[0].length) : skillMd
  const lines = body.split(/\r?\n/)
  let i = 0
  let text = ''
  // Walk paragraph by paragraph; a "Trigger: ..." line is wiring, not a
  // description, so keep going until real prose (or a heading) turns up.
  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i++
    if (i >= lines.length) break
    if (lines[i].startsWith('#')) {
      if (text) break
      i++
      continue
    }
    if (lines[i].startsWith('```')) break
    const para: string[] = []
    for (; i < lines.length; i++) {
      const l = lines[i]
      if (!l.trim() || l.startsWith('#') || l.startsWith('```')) break
      para.push(l.trim())
    }
    const candidate = para.join(' ').replace(/\s+/g, ' ')
    if (/^Trigger:/i.test(candidate)) continue
    text = candidate
    break
  }
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1).replace(/\s+\S*$/, '')
  return `${cut}…`
}

export interface SkillScoreEvent {
  ts: string
  runId?: string
  skill: string
  score: number
}

/**
 * A run's wrap-up turn self-reports its score as a `custom.skill_scored`
 * event; since that payload is agent-authored, treat anything malformed
 * or missing as absent rather than throwing.
 */
export function parseSkillScored(
  payload: Record<string, unknown>,
): { skill: string; score: number } | undefined {
  const { skill, score } = payload
  if (typeof skill !== 'string' || !skill) return undefined
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined
  return { skill, score }
}

/** All valid skill_scored events, oldest first, optionally scoped to one skill. */
function skillScoreEvents(log: EventLog, skill?: string): SkillScoreEvent[] {
  const out: SkillScoreEvent[] = []
  for (const e of log.listEvents({
    types: ['custom.skill_scored'],
    limit: 5000,
  })) {
    const parsed = parseSkillScored(e.payload)
    if (!parsed || (skill && parsed.skill !== skill)) continue
    out.push({ ts: e.ts, runId: e.runId, ...parsed })
  }
  return out
}

/**
 * Learnings minus the scaffolding: the "# Learnings: x" title and the
 * bootstrap "(Empty at bootstrap ...)" note. What remains are the dated
 * bullets the wrap-up turn appended, or nothing.
 */
export function learningEntries(learningsMd: string): string {
  const paragraphs = learningsMd.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const kept = paragraphs.filter((p) => {
    const t = p.trim()
    if (!t) return false
    if (t.startsWith('# ')) return false
    if (t.startsWith('(') && t.endsWith(')')) return false
    return true
  })
  return kept.join('\n\n').trim()
}

export function registerSkillRoutes(
  app: FastifyInstance,
  deps: SkillRouteDeps,
): void {
  // Resolved per request: test stubs build the server without an osRoot.
  const skillsDir = () => path.join(deps.osRoot, 'skills')

  app.get('/api/skills', async (): Promise<SkillMeta[]> => {
    let names: string[]
    try {
      const entries = await fsp.readdir(skillsDir(), { withFileTypes: true })
      names = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
    const routines = deps.scheduler?.list() ?? []
    const runs = deps.log.listRuns()
    const lastScoreBySkill = new Map<string, number>()
    for (const e of skillScoreEvents(deps.log))
      lastScoreBySkill.set(e.skill, e.score)
    return Promise.all(
      names.map(async (name): Promise<SkillMeta> => {
        const dir = path.join(skillsDir(), name)
        const [skillMd, learningsMd] = await Promise.all([
          readSkillFile(dir, 'skill.md'),
          readSkillFile(dir, 'learnings.md'),
        ])
        const mine = runs.filter(
          (r) => r.skill === name && r.status !== 'queued',
        )
        const finished = mine.filter((r) => r.status !== 'running')
        const last = mine.reduce<(typeof mine)[number] | undefined>(
          (best, r) =>
            !best || (r.startedAt ?? '') > (best.startedAt ?? '') ? r : best,
          undefined,
        )
        return {
          name,
          path: `skills/${name}`,
          hasLearnings: learningEntries(learningsMd).length > 0,
          description: skillDescription(skillMd),
          routines: routines
            .filter((r) => r.routine.skill === name)
            .map((r) => r.routine.name),
          runs: finished.length,
          succeeded: finished.filter((r) => r.status === 'success').length,
          lastRunAt: last?.startedAt,
          lastStatus: last?.status,
          costUsd: mine.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
          lastScore: lastScoreBySkill.get(name),
        }
      }),
    )
  })

  app.get('/api/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    if (!/^[\w.-]+$/.test(name))
      return reply
        .code(404)
        .send({ error: 'skill not found' } satisfies ErrorResponse)
    const dir = path.join(skillsDir(), name)
    try {
      await fsp.access(dir)
    } catch {
      return reply
        .code(404)
        .send({ error: 'skill not found' } satisfies ErrorResponse)
    }
    const [skillMd, learningsMd, evalRaw, lastOutputMd] = await Promise.all([
      readSkillFile(dir, 'skill.md'),
      readSkillFile(dir, 'learnings.md'),
      readSkillFile(dir, 'eval.json'),
      readSkillFile(dir, 'last-output.md'),
    ])
    return {
      skillMd,
      learningsMd: learningEntries(learningsMd),
      eval: evalRaw ? JSON.parse(evalRaw) : { criteria: [] },
      lastOutputMd,
      scoreHistory: skillScoreEvents(deps.log, name).map(
        ({ ts, runId, score }) => ({ ts, runId, score }),
      ),
    }
  })
}
