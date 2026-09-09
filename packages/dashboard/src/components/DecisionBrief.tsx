import ReactMarkdown from 'react-markdown'
import { brief } from '../lib/proposal'

/**
 * Renders a proposal as a decision brief: what you get and why now first,
 * effort as a chip, everything else folded away until asked for.
 */
export function DecisionBrief({ body }: { body: string }) {
  const b = brief(body)
  if (b.sectionCount === 0 || !(b.what || b.why)) {
    return (
      <div className="prose-agentos">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {b.what && (
        <section className="card border-l-2 border-l-accent px-4 py-3">
          <h4 className="mb-1 text-xs font-medium text-accent">What you get</h4>
          <div className="prose-agentos">
            <ReactMarkdown>{b.what}</ReactMarkdown>
          </div>
        </section>
      )}
      {b.why && (
        <section className="card border-l-2 border-l-signal px-4 py-3">
          <h4 className="mb-1 text-xs font-medium text-signal">
            Why start this now
          </h4>
          <div className="prose-agentos">
            <ReactMarkdown>{b.why}</ReactMarkdown>
          </div>
        </section>
      )}
      {b.effortNote && (
        <p className="text-xs text-muted">
          <span className="text-text">
            Effort{b.effort ? ` ${b.effort}` : ''}.
          </span>{' '}
          {b.effortNote}
        </p>
      )}
      {b.details.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {b.details.map((d) => (
            <details
              key={d.title}
              className="group rounded-md border border-border/60 open:bg-background/40"
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-sm text-muted hover:text-text group-open:text-text">
                {d.title}
              </summary>
              <div className="prose-agentos px-3 pb-3">
                <ReactMarkdown>{d.body}</ReactMarkdown>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

export function EffortChip({ effort }: { effort: string | null }) {
  if (!effort) return null
  const tone =
    effort === 'S'
      ? 'text-success border-success/40'
      : effort.startsWith('L') || effort === 'XL'
        ? 'text-danger border-danger/40'
        : 'text-signal border-signal/40'
  return (
    <span className={`chip font-mono ${tone}`} title="Effort estimate">
      {effort}
    </span>
  )
}
