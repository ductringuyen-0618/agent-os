import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nanoidMock = vi.fn()
vi.mock('nanoid', () => ({ nanoid: nanoidMock }))

describe('EventLog id generation', () => {
  let tmpDir: string
  let EventLog: typeof import('./eventLog.js').EventLog

  beforeEach(async () => {
    vi.resetModules()
    nanoidMock.mockReset()
    ;({ EventLog } = await import('./eventLog.js'))
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-eventlog-genid-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('regenerates an id that would start with "-" (unsafe as a positional CLI arg)', () => {
    nanoidMock.mockReturnValueOnce('-unsafe-leading-hyphen')
    nanoidMock.mockReturnValueOnce('safe-id-123')

    const log = new EventLog(path.join(tmpDir, 'agentos.db'))
    const run = log.createRun({ routine: 'heartbeat' })
    log.close()

    expect(run.id).toBe('safe-id-123')
    expect(nanoidMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the first id is already safe', () => {
    nanoidMock.mockReturnValueOnce('already-safe')

    const log = new EventLog(path.join(tmpDir, 'agentos.db'))
    const run = log.createRun({ routine: 'heartbeat' })
    log.close()

    expect(run.id).toBe('already-safe')
    expect(nanoidMock).toHaveBeenCalledTimes(1)
  })
})
