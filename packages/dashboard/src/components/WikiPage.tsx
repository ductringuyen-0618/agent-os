import ReactMarkdown, {
  type Components,
  defaultUrlTransform,
} from 'react-markdown'

const WIKILINK = /\[\[([^\]]+)\]\]/g

function toMarkdownLinks(content: string): string {
  return content.replace(WIKILINK, (_m, path) => `[${path}](wiki:${path})`)
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

export function WikiPage({
  content,
  onNavigate,
}: {
  content: string
  onNavigate: (path: string) => void
}) {
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('wiki:')) {
        const path = href.slice('wiki:'.length)
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
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        components={components}
        urlTransform={wikiAwareUrlTransform}
      >
        {toMarkdownLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
