import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectConfigSchema } from '@agentos/shared'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('examples/os-template techpulse.yaml', () => {
  it('parses as a valid ProjectConfig', () => {
    const p = path.resolve(
      __dirname,
      '../../../../examples/os-template/os/projects/techpulse.yaml',
    )
    const parsed = parseYaml(readFileSync(p, 'utf8'))
    const config = ProjectConfigSchema.parse(parsed)
    expect(config.adapter).toBe('techpulse-coo')
    expect(config.repo).toBe(
      'https://github.com/ductringuyen-0618/ai-tech-news-assistant',
    )
    expect(config.options.proposals_path).toBe('docs/missions/coo/proposals')
  })
})
