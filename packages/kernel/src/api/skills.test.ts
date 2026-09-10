import { describe, expect, it } from 'vitest'
import { learningEntries, skillDescription } from './skills.js'

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
