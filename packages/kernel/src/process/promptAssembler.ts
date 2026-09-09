import fs from 'node:fs/promises'
import path from 'node:path'

export interface AssembleInput {
  osRoot: string
  skill: string
  agent: string
  task?: string
  upstreamSkill?: string
}

export interface AssembledPrompt {
  prompt: string
  systemPromptAppend: string
}

async function readIfExists(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Skill folders ship SKILL.md / LEARNINGS.md; older instances wrote them
 * lowercase. Case-insensitive filesystems mask the difference, Linux does
 * not, so try the canonical upper-case stem first and fall back.
 */
async function readSkillFile(dir: string, base: string): Promise<string> {
  const [stem, ext] = base.split(/\.(?=[^.]+$)/)
  for (const candidate of [`${stem.toUpperCase()}.${ext}`, base]) {
    const text = await readIfExists(path.join(dir, candidate))
    if (text) return text
  }
  return ''
}

/** SKILL.md may open with a `description:` frontmatter block for the dashboard; the agent never needs it. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
}

export async function assemblePrompt(
  i: AssembleInput,
): Promise<AssembledPrompt> {
  const claudeMd = await readIfExists(path.join(i.osRoot, 'CLAUDE.md'))
  const agentMd = await readIfExists(
    path.join(i.osRoot, 'agents', i.agent, 'AGENT.md'),
  )
  const systemPromptAppend = [claudeMd, agentMd].filter(Boolean).join('\n\n')

  const skillDir = path.join(i.osRoot, 'skills', i.skill)
  const skillMd = stripFrontmatter(await readSkillFile(skillDir, 'skill.md'))
  const learningsMd = await readSkillFile(skillDir, 'learnings.md')
  const parts = [skillMd, learningsMd]
  if (i.upstreamSkill) {
    const handoff = await readIfExists(
      path.join(i.osRoot, 'skills', i.upstreamSkill, 'context', 'handoff.md'),
    )
    if (handoff) parts.push(handoff)
  }
  if (i.task) parts.push(i.task)
  const prompt = parts.filter(Boolean).join('\n\n')

  return { prompt, systemPromptAppend }
}

export function wrapUpPrompt(_osRoot: string, skill: string): string {
  return [
    `Update skills/${skill}/learnings.md with anything worth remembering from this run.`,
    `Write skills/${skill}/context/handoff.md summarizing output for any downstream routine.`,
    'Call the remember syscall for any durable facts.',
    `Score this run against skills/${skill}/eval.json and write skills/${skill}/last-output.md.`,
  ].join('\n')
}
