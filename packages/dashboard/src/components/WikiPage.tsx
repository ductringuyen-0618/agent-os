import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from 'react-markdown'

const WIKILINK = /\[\[([^\]]+)\]\]/g
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

function toMarkdownLinks(content: string): string {
  return content.replace(WIKILINK, (_m, path) => `[${path}](wiki:${path})`)
}

/** Frontmatter is metadata for the index, not prose for the reader. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER, '')
}

/**
 * Resolves a page-relative link ("../state.md", "./sources/x.md") against
 * the page it appears on; anything else is taken as wiki-root-relative,
 * which is how index.md and agent-written pages link.
 */
export function resolveWikiHref(href: string, from?: string): string {
  const clean = href.replace(/^wiki:/, '').replace(/#.*$/, '')
  const base = from ? from.split('/').slice(0, -1) : []
  const parts = clean.startsWith('.') ? [...base] : []
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const joined = parts.join('/')
  return joined.endsWith('.md') || joined === '' ? joined : `${joined}.md`
}

// react-markdown's default urlTransform sanitizes any URL scheme it doesn't
// recognize (http/https/mailto/tel/etc.) down to an empty string, as an XSS
// guard against untrusted markdown -- the wiki: pseudo-scheme below would
// otherwise never reach the `a` component's href check at all. Pass wiki:
// URLs through unchanged (path.replace already strips the [[...]] brackets,
// so there's no user-controlled markup smuggled through here) while keeping
// the default sanitization for every other link, since wiki content is
// agent-authored and not fully trusted.
function wikiAwareUrlTransform(url: string): string {
  return url.startsWith('wiki:') ? url : defaultUrlTransform(url)
}

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i

export function WikiPage({
  content,
  onNavigate,
  currentPath,
}: {
  content: string
  onNavigate: (path: string) => void
  /** Wiki-relative path of the page being shown, for resolving `../` links. */
  currentPath?: string
}) {
  const components: Components = {
    a: ({ href, children }) => {
      const internal =
        href !== undefined && (href.startsWith('wiki:') || !EXTERNAL.test(href))
      if (internal && href) {
        const path = resolveWikiHref(href, currentPath)
        return (
          <a
            href={`#${path}`}
            onClick={(e) => {
              e.preventDefault()
              onNavigate(path)
            }}
            className="text-accent underline"
          >
            {children}
          </a>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          {children}
        </a>
      )
    },
  }
  return (
    <div className="prose-agentos">
      <ReactMarkdown
        components={components}
        urlTransform={wikiAwareUrlTransform}
      >
        {toMarkdownLinks(stripFrontmatter(content))}
      </ReactMarkdown>
    </div>
  )
}
