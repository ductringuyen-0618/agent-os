import type { EventKind } from '../lib/events'

export interface PulseTick {
  ts: string
  kind: EventKind
}

const COLOR: Record<EventKind, string> = {
  run: 'var(--color-accent)',
  human: 'var(--color-signal)',
  memory: 'var(--color-muted)',
  git: 'var(--color-success)',
  alert: 'var(--color-danger)',
}

// Taller means "more worth a glance". A human decision is the tallest thing
// on the strip; a wiki write is a short blip.
const HEIGHT: Record<EventKind, number> = {
  human: 1,
  alert: 0.9,
  run: 0.7,
  git: 0.55,
  memory: 0.35,
}

const W = 1000
const H = 56
const BASE = 44

/**
 * The last hour of the OS as a heartbeat. Each tick is one event; colour is
 * its kind, height is how much it deserves attention. The "now" marker on the
 * right pulses while the socket is connected.
 */
export function PulseStrip({
  ticks,
  windowMs = 60 * 60 * 1000,
  now = Date.now(),
  live = true,
}: {
  ticks: PulseTick[]
  windowMs?: number
  now?: number
  live?: boolean
}) {
  const visible = ticks
    .map((t) => ({ ...t, age: now - Date.parse(t.ts) }))
    .filter((t) => !Number.isNaN(t.age) && t.age >= 0 && t.age <= windowMs)
  const minutes = Math.round(windowMs / 60_000)
  const grid = [0.25, 0.5, 0.75].map((f) => ({
    x: W * f,
    label: `${Math.round(minutes * (1 - f))} min ago`,
  }))

  return (
    <div className="card relative overflow-hidden px-4 pt-3 pb-2">
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
        <span>
          {visible.length === 0
            ? `Quiet for the last ${minutes} minutes`
            : `${visible.length} ${visible.length === 1 ? 'event' : 'events'} in the last ${minutes} minutes`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="relative inline-flex h-2 w-2">
            {live && (
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-accent" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-accent' : 'bg-muted'}`}
            />
          </span>
          {live ? 'Live' : 'Reconnecting'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-14 w-full"
        role="img"
        aria-label={`Timeline of ${visible.length} events in the last ${minutes} minutes`}
      >
        <title>Activity over the last {minutes} minutes</title>
        {grid.map((g) => (
          <line
            key={g.x}
            x1={g.x}
            x2={g.x}
            y1={4}
            y2={BASE}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={0}
          x2={W}
          y1={BASE}
          y2={BASE}
          stroke="var(--color-border)"
          vectorEffect="non-scaling-stroke"
        />
        {visible.map((t, i) => {
          const x = W * (1 - t.age / windowMs)
          const h = (BASE - 6) * HEIGHT[t.kind]
          return (
            <line
              key={`${t.ts}-${i}`}
              data-testid="pulse-tick"
              data-kind={t.kind}
              x1={x}
              x2={x}
              y1={BASE}
              y2={BASE - h}
              stroke={COLOR[t.kind]}
              strokeWidth={t.kind === 'human' ? 2.5 : 1.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted/70">
        <span>{minutes} min ago</span>
        {grid.map((g) => (
          <span key={g.x}>{g.label}</span>
        ))}
        <span>now</span>
      </div>
    </div>
  )
}
