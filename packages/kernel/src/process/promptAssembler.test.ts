import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assemblePrompt, wrapUpPrompt } from './promptAssembler.js'

describe('assemblePrompt', () => {
  let osRoot: string

  beforeEach(async () => {
    osRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'agentos-prompt-'))
    await fs.writeFile(
      path.join(osRoot, 'CLAUDE.md'),
      '# agent-os instance schema',
    )
    await fs.mkdir(path.join(osRoot, 'agents', 'ops'), { recursive: true })
    await fs.writeFile(
      path.join(osRoot, 'agents', 'ops', 'AGENT.md'),
      '# ops agent',
    )
    await fs.mkdir(path.join(osRoot, 'skills', 'heartbeat'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(osRoot, 'skills', 'heartbeat', 'skill.md'),
      '# heartbeat skill',
    )
    await fs.writeFile(
      path.join(osRoot, 'skills', 'heartbeat', 'learnings.md'),
      '- learned nothing yet',
    )
  })

  afterEach(() => {
    fsSync.rmSync(osRoot, { recursive: true, force: true })
  })

  it('concatenates schema + agent for the system prompt', async () => {
    const { systemPromptAppend } = await assemblePrompt({
      osRoot,
      skill: 'heartbeat',
      agent: 'ops',
    })
    expect(systemPromptAppend).toContain('# agent-os instance schema')
    expect(systemPromptAppend).toContain('# ops agent')
  })

  it('concatenates skill + learnings + task into the user prompt', async () => {
    const { prompt } = await assemblePrompt({
      osRoot,
      skill: 'heartbeat',
      agent: 'ops',
      task: 'run now',
    })
    expect(prompt).toContain('# heartbeat skill')
    expect(prompt).toContain('learned nothing yet')
    expect(prompt).toContain('run now')
  })

  it('includes an upstream handoff when upstreamSkill is set', async () => {
    await fs.mkdir(path.join(osRoot, 'skills', 'lint', 'context'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(osRoot, 'skills', 'lint', 'context', 'handoff.md'),
      'lint found 2 issues',
    )
    const { prompt } = await assemblePrompt({
      osRoot,
      skill: 'heartbeat',
      agent: 'ops',
      upstreamSkill: 'lint',
    })
    expect(prompt).toContain('lint found 2 issues')
  })

  it('tolerates missing files', async () => {
    const { prompt, systemPromptAppend } = await assemblePrompt({
      osRoot,
      skill: 'missing-skill',
      agent: 'missing-agent',
    })
    expect(typeof prompt).toBe('string')
    expect(typeof systemPromptAppend).toBe('string')
  })
})

describe('wrapUpPrompt', () => {
  it('mentions learnings, handoff, remember and eval scoring', () => {
    const text = wrapUpPrompt('/some/os', 'heartbeat')
    expect(text).toContain('learnings.md')
    expect(text).toContain('handoff.md')
    expect(text).toContain('remember')
    expect(text).toContain('eval.json')
  })

  it('instructs the run to emit a custom.skill_scored event for the trend', () => {
    const text = wrapUpPrompt('/some/os', 'heartbeat')
    expect(text).toContain('emit_event')
    expect(text).toContain('custom.skill_scored')
    expect(text).toContain('"skill": "heartbeat"')
  })
})

describe('assemblePrompt skill file handling', () => {
  it('finds upper-case SKILL.md and drops its description frontmatter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-pa-'))
    const dir = path.join(root, 'skills', 'lint')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '---\ndescription: Nightly wiki hygiene.\n---\n# Skill: lint\n\nSteps.',
    )
    await fs.writeFile(path.join(dir, 'LEARNINGS.md'), '- keep index tidy')
    const { prompt } = await assemblePrompt({
      osRoot: root,
      skill: 'lint',
      agent: 'ops',
    })
    expect(prompt.startsWith('# Skill: lint')).toBe(true)
    expect(prompt).not.toContain('description:')
    expect(prompt).toContain('- keep index tidy')
    fsSync.rmSync(root, { recursive: true, force: true })
  })
})
