/** One wiki page as listed by `GET /api/wiki/pages`. */
export interface WikiPageMeta {
  /** Wiki-relative path, e.g. `projects/techpulse/overview.md`. */
  path: string
  title: string
  /** The `type` frontmatter (ingest, lint, note, ...) or `page` when absent. */
  type: string
  /** ISO timestamp from frontmatter, else the file's mtime. */
  updated: string
  /** Raw files this page was derived from, from frontmatter `sources`. */
  sources: string[]
  bytes: number
}
