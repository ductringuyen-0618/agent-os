import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from './init.js'

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'agentos-init-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('runInit', () => {
  it('copies the os-template into <dir>/os and writes guard files', async () => {
    const target = path.join(workDir, 'my-os')
    await runInit(target)

    const claudeMd = await readFile(
      path.join(target, 'os', 'CLAUDE.md'),
      'utf8',
    )
    expect(claudeMd).toContain('agent-os instance schema')

    const gitignore = await readFile(path.join(target, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.agentos/')
    expect(gitignore).toContain('.env')
    expect(gitignore).toContain('*.db')

    const gitleaks = await readFile(path.join(target, '.gitleaks.toml'), 'utf8')
    expect(gitleaks).toContain('gitleaks')

    const heartbeatSkill = await stat(
      path.join(target, 'os', 'skills', 'heartbeat', 'skill.md'),
    )
    expect(heartbeatSkill.isFile()).toBe(true)
  })

  it('refuses to overwrite an existing os/ directory', async () => {
    const target = path.join(workDir, 'existing')
    await runInit(target)
    await expect(runInit(target)).rejects.toThrow(/refusing to overwrite/)
  })
})
