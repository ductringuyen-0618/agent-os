import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')
// Scope is deliberately the *shipped* surface: the public template, every
// package's source and tests, and the user-facing docs a real contributor
// or instance operator reads. It excludes docs/superpowers/** on purpose --
// that tree is this project's own SDD build ledger, a factual record of the
// sandbox this was built in (worktree/container paths and all), not product
// documentation, so it's expected to contain machine-specific paths.
const SCAN_DIRS = [
  path.join(ROOT, 'examples'),
  ...['shared', 'kernel', 'cli', 'dashboard', 'adapters'].flatMap((p) => [
    path.join(ROOT, 'packages', p, 'src'),
    path.join(ROOT, 'packages', p, 'test'),
  ]),
]
const SCAN_FILES = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'docs', 'SECURITY.md'),
  path.join(ROOT, 'docs', 'DEMO.md'),
  path.join(ROOT, 'docs', 'PRIVATE_INSTANCE.md'),
]

const TEXT_EXT = new Set([
  '.md',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
  '.json',
  '.sql',
])
// Windows drive-letter paths (e.g. `C:\Users\...`) are a single letter at a
// path boundary, never preceded by another word character -- the negative
// lookbehind is what keeps this from false-positiving on ordinary source
// text that happens to contain "<word ending in a letter>:\<escape>", e.g.
// a `/^status:\s*/` regex literal or a `'...:\n...'` template string, both
// of which occur legitimately in this codebase.
const ABS_PATH_PATTERNS = [
  /(?<![A-Za-z0-9_])[A-Za-z]:\\/,
  /\/Users\//,
  /\/home\//,
]
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const ALLOWED_EMAIL_DOMAINS = ['example.com', 'anthropic.com']

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git')
        continue
      walk(full, out)
    } else if (TEXT_EXT.has(path.extname(entry))) {
      out.push(full)
    }
  }
  return out
}

describe('no secrets or machine paths committed', () => {
  const files = [...SCAN_DIRS.flatMap((d) => walk(d)), ...SCAN_FILES]

  it('scanned at least one file', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const rel = path.relative(ROOT, file)

    it(`${rel} has no absolute machine path`, () => {
      const content = readFileSync(file, 'utf8')
      for (const pattern of ABS_PATH_PATTERNS) {
        expect(pattern.test(content), `${rel} matched ${pattern}`).toBe(false)
      }
    })

    it(`${rel} has no non-example email address`, () => {
      const content = readFileSync(file, 'utf8')
      const matches = content.match(EMAIL_PATTERN) ?? []
      const bad = matches.filter(
        (m) =>
          !ALLOWED_EMAIL_DOMAINS.some((d) => m.toLowerCase().endsWith(`@${d}`)),
      )
      expect(bad, `${rel} contains emails: ${bad.join(', ')}`).toEqual([])
    })
  }
})
