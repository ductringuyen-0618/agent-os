/**
 * A proposal is markdown with `## ` sections. The brief pulls the two the
 * person deciding needs first ("what you get", "why start this now"), the
 * effort, and leaves the rest as supporting detail.
 */
export interface Section {
  title: string
  body: string
}

export interface Brief {
  what: string | null
  why: string | null
  effort: string | null
  effortNote: string | null
  details: Section[]
  /** How many `## ` sections the proposal had; 0 means it is plain prose. */
  sectionCount: number
}

export function stripFrontmatter(md: string): string {
  return md.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '')
}

export function parseSections(md: string): {
  intro: string
  sections: Section[]
} {
  const text = stripFrontmatter(md).replace(/^#\s+[^\n]*\n?/m, '')
  const parts = text.split(/^##\s+/m)
  const intro = parts[0].trim()
  const sections = parts.slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n')
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim()
    const body = nl === -1 ? '' : chunk.slice(nl + 1).trim()
    return { title, body }
  })
  return { intro, sections }
}

function find(sections: Section[], ...names: string[]): Section | undefined {
  const wanted = names.map((n) => n.toLowerCase())
  return sections.find((s) => wanted.includes(s.title.toLowerCase()))
}

const WHAT = ['What you get', 'Proposed solution']
const WHY = ['Why start this now']
const WHY_FALLBACK = [
  'Problem / opportunity',
  'Why this increases engagement',
  'What we learned from research',
]

/** "S", "M", "L" from the first line of the effort section, plus the rest as a note. */
export function parseEffort(body: string): {
  effort: string | null
  note: string | null
} {
  const firstLine = body.split('\n')[0]?.replace(/[*_`]/g, '').trim() ?? ''
  const m = firstLine.match(/^(S\s*\/\s*M|S|M|L|XL)\b/i)
  if (!m) return { effort: null, note: body.trim() || null }
  const note = body
    .replace(/[*_`]/g, '')
    .replace(m[0], '')
    .replace(/^[\s.,:—–-]+/, '')
    .trim()
  return { effort: m[1].toUpperCase().replace(/\s+/g, ''), note: note || null }
}

export function brief(md: string): Brief {
  const { intro, sections } = parseSections(md)
  const used = new Set<string>()
  const take = (s: Section | undefined) => {
    if (s) used.add(s.title.toLowerCase())
    return s?.body ?? null
  }

  const whatSection = find(sections, ...WHAT)
  const what = take(whatSection) ?? (intro || null)

  let why = take(find(sections, ...WHY))
  if (!why) {
    const parts = WHY_FALLBACK.map((n) => find(sections, n)).filter(
      (s): s is Section => s !== undefined,
    )
    if (parts.length > 0) {
      for (const p of parts) used.add(p.title.toLowerCase())
      why = parts.map((p) => `**${p.title}**\n\n${p.body}`).join('\n\n')
    }
  }

  const effortSection = find(sections, 'Effort estimate', 'Effort')
  const { effort, note } = effortSection
    ? parseEffort(effortSection.body)
    : { effort: null, note: null }
  if (effortSection) used.add(effortSection.title.toLowerCase())

  const details = sections.filter((s) => !used.has(s.title.toLowerCase()))
  return {
    what,
    why,
    effort,
    effortNote: note,
    details,
    sectionCount: sections.length,
  }
}

/** First sentence-ish line of a markdown block, markup stripped, for compact cards. */
export function firstLine(md: string | null, max = 180): string {
  if (!md) return ''
  const line = md
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'))
  if (!line) return ''
  const clean = line
    .replace(/^([-*+]|\d+\.)\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/(^|\s)_([^_]+)_(?=[\s.,;:!?)]|$)/g, '$1$2')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
