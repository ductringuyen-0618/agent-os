import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AdapterHost, EventLog, WikiService } from '@agentos/kernel'
import simpleGit from 'simple-git'
import { describe, expect, it } from 'vitest'
import { adapterRegistry } from '../index.js'
import { createTempTechpulseRepo } from './test-helpers.js'

describe('techpulse-coo end-to-end', () => {
  it('mirrors, raises a decision, and approve pushes the flip to the bare repo', async () => {
    const { bareDir, cloneDir } = await createTempTechpulseRepo()
    const osRoot = mkdtempSync(path.join(tmpdir(), 'agentos-os-'))
    mkdirSync(path.join(osRoot, 'projects'), { recursive: true })
    writeFileSync(
      path.join(osRoot, 'projects', 'techpulse.yaml'),
      `name: techpulse\nadapter: techpulse-coo\nrepo: ${bareDir.replace(/\\/g, '/')}\nclone: ${cloneDir.replace(/\\/g, '/')}\nbase_branch: main\noptions:\n  proposals_path: docs/missions/coo/proposals\n  state_path: docs/missions/coo/state.md\n  reports_path: docs/missions/coo/reports\n`,
    )
    const cfg = {
      osRoot,
      runtimeDir: path.join(osRoot, '..', '.agentos'),
      dbPath: ':memory:',
      claudeBin: 'true',
      host: '127.0.0.1' as const,
      port: 0,
      logLevel: 'info' as const,
    }
    const log = new EventLog(cfg.dbPath)
    const wiki = new WikiService(osRoot, log)
    const host = new AdapterHost(cfg, log, wiki, adapterRegistry)

    const syncResult = await host.sync('techpulse')
    expect(syncResult.added.length).toBeGreaterThan(0)

    const pending = log.listDecisions({ status: 'pending' })
    expect(pending).toHaveLength(1)

    await host.applyDecision({ ...pending[0], status: 'approved' })

    expect(log.getDecision(pending[0].id)?.status).toBe('approved')

    // A fixed path.join(osRoot, '..', 'verify') always resolves to the same
    // os.tmpdir()-relative location regardless of osRoot's unique mkdtemp
    // suffix, so a leftover dir from a prior run collides with `git clone`
    // ("destination path already exists") -- same bug already caught and
    // fixed in applyDecision.test.ts (Task 5); give verify its own unique
    // temp dir here too.
    const verifyDir = mkdtempSync(path.join(tmpdir(), 'agentos-verify-'))
    await simpleGit().clone(bareDir, verifyDir)
    const pushed = readFileSync(
      path.join(verifyDir, 'docs/missions/coo/proposals/001-dark-mode.md'),
      'utf8',
    )
    expect(pushed).toContain('status: approved')

    const rerun = await host.sync('techpulse')
    expect(rerun.events).toContain('proposal.changed')
    expect(log.listDecisions({ status: 'pending' })).toHaveLength(0)
  })
})
