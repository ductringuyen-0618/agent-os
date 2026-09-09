import type { EventLog } from '../log/eventLog.js'

export interface WritePageInput {
  path: string
  content: string
  links?: string[]
  runId?: string
  op?: 'ingest' | 'query' | 'lint' | 'decision' | 'note'
}

/**
 * M1 stub: wired into the kernel so createKernel() satisfies the Kernel
 * interface, but none of the raw/wiki contract enforcement, secret
 * redaction, or index/log maintenance is implemented yet. All methods are
 * no-ops. M2 (docs/superpowers/plans/2026-09-08-agent-os-m2-wiki-syscalls.md)
 * replaces this file with the real implementation (contract §4).
 */
export class WikiService {
  constructor(
    private osRoot: string,
    private log: EventLog,
  ) {}

  async writePage(
    i: WritePageInput,
  ): Promise<{ result: 'created' | 'updated'; path: string }> {
    return { result: 'created', path: i.path }
  }

  async readPage(_path: string): Promise<string> {
    return ''
  }

  async readIndex(): Promise<string> {
    return ''
  }

  async readLog(_limit?: number): Promise<string> {
    return ''
  }

  async listUnindexedRaw(): Promise<string[]> {
    return []
  }

  async appendLog(_op: string, _title: string, _runId?: string): Promise<void> {
    return
  }
}
