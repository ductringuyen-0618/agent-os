export interface IndexEntry {
  path: string
  title: string
  type: string
  updated: string
  sources?: string[]
  tags?: string[]
}

export function formatIndexLine(e: IndexEntry): string {
  const sourcesPart = e.sources?.length
    ? ` — sources: ${e.sources.join(', ')}`
    : ''
  const tagsPart = e.tags?.length ? ` — tags: ${e.tags.join(', ')}` : ''
  return `- [${e.title}](${e.path}) — type: ${e.type} — updated: ${e.updated}${sourcesPart}${tagsPart}`
}

export function upsertIndexEntry(indexMd: string, entry: IndexEntry): string {
  const line = formatIndexLine(entry)
  const marker = `](${entry.path})`
  const lines =
    indexMd.length > 0
      ? indexMd.split('\n')
      : [
          '# Wiki Index',
          '',
          'One line per page. Maintained by WikiService.writePage.',
          '',
        ]
  const idx = lines.findIndex((l) => l.includes(marker))
  if (idx >= 0) {
    lines[idx] = line
  } else {
    lines.push(line)
  }
  return `${dropPlaceholder(lines).join('\n').trimEnd()}\n`
}

/**
 * The template index ships a "(none yet ...)" bullet, possibly wrapped over
 * indented continuation lines. Once a real entry exists it is only noise.
 */
function dropPlaceholder(lines: string[]): string[] {
  const out: string[] = []
  let skipping = false
  for (const l of lines) {
    if (/^- \(none yet/.test(l)) {
      skipping = true
      continue
    }
    if (skipping && /^\s+\S/.test(l)) continue
    skipping = false
    out.push(l)
  }
  return out
}

export function formatLogLine(op: string, title: string, date: string): string {
  return `## [${date}] ${op} | ${title}`
}

export function appendLogLine(logMd: string, line: string): string {
  const base = logMd.length > 0 ? logMd.trimEnd() : '# Wiki Log'
  return `${base}\n\n${line}\n`
}
