import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type { EventLog } from '../log/eventLog.js'
import {
  type IndexEntry,
  appendLogLine,
  formatLogLine,
  upsertIndexEntry,
} from './index.js'
import { SecretDetectedError, findSecrets } from './redact.js'

export interface WritePageInput {
  path: string
  content: string
  links?: string[]
  runId?: string
  op?: 'ingest' | 'query' | 'lint' | 'decision' | 'note'
}

export class WikiService {
  constructor(
    private osRoot: string,
    private log: EventLog,
  ) {}

  private wikiDir(): string {
    return path.join(this.osRoot, 'wiki')
  }
  private indexPath(): string {
    return path.join(this.wikiDir(), 'index.md')
  }
  private logPath(): string {
    return path.join(this.wikiDir(), 'log.md')
  }

  async writePage(
    i: WritePageInput,
  ): Promise<{ result: 'created' | 'updated'; path: string }> {
    const normalized = i.path.replace(/\\/g, '/')
    if (normalized.startsWith('raw/')) {
      throw new Error(
        `WikiService.writePage refused: "${i.path}" is under raw/ (immutable)`,
      )
    }
    const secrets = findSecrets(i.content)
    if (secrets.length > 0) {
      this.log.append({
        type: 'security.redacted',
        runId: i.runId,
        payload: { path: normalized, patterns: secrets },
      })
      throw new SecretDetectedError(secrets)
    }

    const full = path.join(this.wikiDir(), normalized)
    await fs.mkdir(path.dirname(full), { recursive: true })
    const existed = await fs.access(full).then(
      () => true,
      () => false,
    )
    const updated = new Date().toISOString()
    const title = path.basename(normalized).replace(/\.md$/, '')
    const type = i.op ?? 'note'
    const frontmatter = {
      title,
      type,
      sources: i.links ?? [],
      updated,
      tags: [] as string[],
    }
    const body = matter.stringify(`${i.content.trimEnd()}\n`, frontmatter)
    await fs.writeFile(full, body, 'utf8')

    const indexMd = await fs.readFile(this.indexPath(), 'utf8').catch(() => '')
    const entry: IndexEntry = {
      path: normalized,
      title,
      type,
      updated,
      sources: i.links,
    }
    await fs.writeFile(
      this.indexPath(),
      upsertIndexEntry(indexMd, entry),
      'utf8',
    )

    await this.appendLog(type, title, i.runId)

    this.log.append({
      type: 'wiki.written',
      runId: i.runId,
      payload: { path: normalized, result: existed ? 'updated' : 'created' },
    })

    return { result: existed ? 'updated' : 'created', path: normalized }
  }

  async readPage(p: string): Promise<string> {
    return fs.readFile(path.join(this.wikiDir(), p), 'utf8')
  }

  async readIndex(): Promise<string> {
    return fs.readFile(this.indexPath(), 'utf8')
  }

  async readLog(limit?: number): Promise<string> {
    const full = await fs.readFile(this.logPath(), 'utf8')
    if (!limit) return full
    const entries = full.split(/\n(?=## \[)/)
    return entries.slice(-limit).join('\n')
  }

  async listUnindexedRaw(): Promise<string[]> {
    const rawDir = path.join(this.osRoot, 'raw')
    const indexMd = await this.readIndex().catch(() => '')
    const files = await listFilesRecursive(rawDir)
    return files.filter((f) => !indexMd.includes(f))
  }

  async appendLog(op: string, title: string, _runId?: string): Promise<void> {
    const date = new Date().toISOString().slice(0, 10)
    const line = formatLogLine(op, title, date)
    const existing = await fs.readFile(this.logPath(), 'utf8').catch(() => '')
    await fs.writeFile(this.logPath(), appendLogLine(existing, line), 'utf8')
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && e.name !== '.gitkeep')
    .map((e) =>
      path
        .relative(dir, path.join(e.parentPath ?? dir, e.name))
        .split(path.sep)
        .join('/'),
    )
}
