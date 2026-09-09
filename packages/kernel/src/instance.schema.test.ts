import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const osRoot = fileURLToPath(
  new URL('../../../examples/os-template/os', import.meta.url),
)

async function read(p: string): Promise<string> {
  return fs.readFile(path.join(osRoot, p), 'utf8')
}

describe('os/CLAUDE.md', () => {
  it('has every required §10 section', async () => {
    const md = await read('CLAUDE.md')
    for (const heading of [
      '# agent-os instance schema',
      '## Layers',
      '## Page template',
      '## Log format',
      '## Workflows',
      '## Hard rules',
    ]) {
      expect(md).toContain(heading)
    }
    expect(md).toMatch(
      /title, type, sources, updated, tags|title.*type.*sources.*updated.*tags/s,
    )
  })
})

describe('skills', () => {
  for (const skill of ['ingest', 'query', 'lint']) {
    it(`${skill} has skill.md, learnings.md, eval.json, context/handoff.md`, async () => {
      const skillMd = await read(`skills/${skill}/skill.md`)
      expect(skillMd).toContain('mcp__agentos__')
      expect(skillMd.toLowerCase()).toContain('raw/')
      const evalJson = JSON.parse(await read(`skills/${skill}/eval.json`))
      expect(Array.isArray(evalJson.criteria)).toBe(true)
      expect(evalJson.criteria.length).toBeGreaterThan(0)
      await expect(read(`skills/${skill}/learnings.md`)).resolves.toBeTruthy()
      await expect(
        read(`skills/${skill}/context/handoff.md`),
      ).resolves.toBeTruthy()
    })
  }
})

describe('agents/librarian/AGENT.md', () => {
  it('documents permissions restricted to mcp__agentos__* for writes', async () => {
    const md = await read('agents/librarian/AGENT.md')
    expect(md).toContain('mcp__agentos__')
    expect(md.toLowerCase()).toContain('never')
  })
})

describe('feature-request skills', () => {
  for (const skill of [
    'feature-brief',
    'feature-build',
    'feature-validate',
    'feature-review',
  ]) {
    it(`${skill} has skill.md, learnings.md, eval.json, context/handoff.md`, async () => {
      const skillMd = await read(`skills/${skill}/skill.md`)
      expect(skillMd).toContain('feature-request')
      const evalJson = JSON.parse(await read(`skills/${skill}/eval.json`))
      expect(Array.isArray(evalJson.criteria)).toBe(true)
      expect(evalJson.criteria.length).toBeGreaterThan(0)
      await expect(read(`skills/${skill}/learnings.md`)).resolves.toBeTruthy()
      await expect(
        read(`skills/${skill}/context/handoff.md`),
      ).resolves.toBeTruthy()
    })
  }

  it('feature-brief documents the required proposal sections', async () => {
    const md = await read('skills/feature-brief/skill.md')
    for (const heading of [
      'What you get',
      'Why start this now',
      'Problem',
      'Proposed solution',
      'Effort estimate',
      'Validation contract',
      'Risks',
    ]) {
      expect(md).toContain(heading)
    }
  })

  it('feature-build documents branch discipline and the never-push rule', async () => {
    const md = await read('skills/feature-build/skill.md')
    expect(md).toContain('req/')
    expect(md.toLowerCase()).toContain('never push')
  })
})
