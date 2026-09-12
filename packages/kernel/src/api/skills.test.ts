import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLog } from '../log/eventLog.js'
import {
  learningEntries,
  parseSkillScored,
  registerSkillRoutes,
  skillDescription,
} from './skills.js'

describe('skillDescription', () => {
  it('takes the first paragraph after the title, on one line', () => {
    expect(
      skillDescription(
        '# heartbeat\n\nCheap, frequent pulse-check\nacross the OS.\n\n## Input\nstuff',
      ),
    ).toBe('Cheap, frequent pulse-check across the OS.')
  })
  it('skips a trigger line written as a heading and stops at code fences', () => {
    expect(skillDescription('# x\n## Trigger\n```json\n{}\n```\n')).toBe('')
  })
  it('truncates long paragraphs', () => {
    expect(skillDescription(`# x\n\n${'word '.repeat(80)}`, 40)).toMatch(
      /^(word )+word…$/,
    )
  })
})

describe('learningEntries', () => {
  it('drops the title and the bootstrap note', () => {
    expect(
      learningEntries(
        '# Learnings: ingest\n\n(Empty at bootstrap. The wrap-up turn appends\nbullets here.)\n',
      ),
    ).toBe('')
  })
  it('keeps dated bullets', () => {
    expect(
      learningEntries(
        '# Learnings: ingest\n\n(Empty at bootstrap.)\n\n- 2026-09-09: state.md lags\n  behind decisions.\n',
      ),
    ).toBe('- 2026-09-09: state.md lags\n  behind decisions.')
  })
})

describe('skillDescription trigger lines', () => {
  it('skips a leading "Trigger:" paragraph in favour of the prose after it', () => {
    expect(
      skillDescription(
        '# Skill: ingest\n\nTrigger: routine `ingest`, `on: [raw.added]`. Agent: `librarian`.\n\nYou fold a new or changed `raw/` file into the wiki.\n\n## Steps\n',
      ),
    ).toBe('You fold a new or changed `raw/` file into the wiki.')
  })
  it('falls back to empty when only a trigger line exists', () => {
    expect(skillDescription('# x\n\nTrigger: manual.\n')).toBe('')
  })
})

describe('skillDescription frontmatter', () => {
  it('prefers an explicit description in SKILL.md frontmatter', () => {
    expect(
      skillDescription(
        '---\ndescription: Folds raw files into the wiki.\n---\n# Skill: ingest\n\nTrigger: routine `ingest`.\n',
      ),
    ).toBe('Folds raw files into the wiki.')
  })
})

describe('parseSkillScored', () => {
  it('accepts a well-formed payload', () => {
    expect(parseSkillScored({ skill: 'lint', score: 0.75 })).toEqual({
      skill: 'lint',
      score: 0.75,
    })
  })

  it.each([
    {},
    { skill: 'lint' },
    { score: 0.5 },
    { skill: '', score: 0.5 },
    { skill: 'lint', score: 'high' },
    { skill: 'lint', score: Number.NaN },
    { skill: 42, score: 0.5 },
  ])('rejects a malformed payload %o', (payload) => {
    expect(parseSkillScored(payload)).toBeUndefined()
  })
})

describe('skill score trend routes', () => {
  let tmpDir: string
  let osRoot: string
  let log: EventLog

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-skills-api-'))
    osRoot = path.join(tmpDir, 'os')
    await fs.promises.mkdir(path.join(osRoot, 'skills', 'lint'), {
      recursive: true,
    })
    log = new EventLog(path.join(tmpDir, 'agentos.db'))
  })

  afterEach(() => {
    log.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('GET /api/skills reports the most recent score, and leaves it undefined with none', async () => {
    log.append({
      type: 'custom.skill_scored',
      payload: { skill: 'lint', score: 0.5 },
    })
    log.append({
      type: 'custom.skill_scored',
      payload: { skill: 'lint', score: 0.9 },
    })
    await fs.promises.mkdir(path.join(osRoot, 'skills', 'unscored'), {
      recursive: true,
    })
    const app = Fastify()
    registerSkillRoutes(app, { osRoot, log })
    const res = await app.inject({ method: 'GET', url: '/api/skills' })
    const body = JSON.parse(res.body) as Array<{
      name: string
      lastScore?: number
    }>
    expect(body.find((s) => s.name === 'lint')?.lastScore).toBe(0.9)
    expect(body.find((s) => s.name === 'unscored')?.lastScore).toBeUndefined()
  })

  it('GET /api/skills/:name skips malformed events and returns scoreHistory oldest-first', async () => {
    log.append({
      type: 'custom.skill_scored',
      payload: { skill: 'lint', score: 0.5 },
    })
    log.append({
      type: 'custom.skill_scored',
      payload: { skill: 'other', score: 1 },
    })
    log.append({
      type: 'custom.skill_scored',
      payload: { skill: 'lint', score: 'nope' },
    })
    log.append({
      type: 'custom.skill_scored',
      payload: { skill: 'lint', score: 0.9 },
    })
    const app = Fastify()
    registerSkillRoutes(app, { osRoot, log })
    const res = await app.inject({ method: 'GET', url: '/api/skills/lint' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as {
      scoreHistory: Array<{ score: number }>
    }
    expect(body.scoreHistory.map((h) => h.score)).toEqual([0.5, 0.9])
  })
})
