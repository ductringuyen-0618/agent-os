import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import simpleGit from 'simple-git'

export const PROPOSAL_1 = `---
title: Add dark mode toggle
status: proposed
attempts: 0
branch: null
---

# Add dark mode toggle

## Why this increases engagement
Users have asked for this repeatedly.

## Effort estimate
Small, about 2 hours.
`

export async function createTempTechpulseRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'agentos-techpulse-'))
  const bareDir = path.join(root, 'bare.git')
  const seedDir = path.join(root, 'seed')
  const cloneDir = path.join(root, 'clone')

  await simpleGit().raw(['init', '--bare', '--initial-branch=main', bareDir])

  mkdirSync(seedDir, { recursive: true })
  const seedGit = simpleGit(seedDir)
  await seedGit.raw(['init', '--initial-branch=main'])
  await seedGit.addConfig('user.name', 'Test User')
  await seedGit.addConfig('user.email', 'test@example.com')

  const proposalsDir = path.join(seedDir, 'docs/missions/coo/proposals')
  mkdirSync(proposalsDir, { recursive: true })
  writeFileSync(path.join(proposalsDir, '001-dark-mode.md'), PROPOSAL_1)
  // .gitkeep in both dirs so the "layout already exists" fixture actually
  // survives a git round-trip: git doesn't track empty directories, so
  // without a tracked file inside it, docs/missions/coo/reports/ would
  // silently vanish from the clone and bootstrapCooLayout would (correctly)
  // report it as missing.
  writeFileSync(path.join(proposalsDir, '.gitkeep'), '')
  const reportsDir = path.join(seedDir, 'docs/missions/coo/reports')
  mkdirSync(reportsDir, { recursive: true })
  writeFileSync(path.join(reportsDir, '.gitkeep'), '')
  writeFileSync(
    path.join(seedDir, 'docs/missions/coo/state.md'),
    '# COO state\n\nAll quiet.\n',
  )

  await seedGit.add('.')
  await seedGit.commit('seed')
  await seedGit.addRemote('origin', bareDir)
  await seedGit.push('origin', 'main')

  await simpleGit().clone(bareDir, cloneDir)
  const cloneGit = simpleGit(cloneDir)
  await cloneGit.addConfig('user.name', 'Test User')
  await cloneGit.addConfig('user.email', 'test@example.com')
  await cloneGit.checkout('main')

  return { root, bareDir, seedDir, cloneDir }
}
