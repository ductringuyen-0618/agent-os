import type { CostEntry } from '../api/client'
import { usd } from '../lib/time'

const PALETTE = [
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-signal)',
  '#c39bff',
  '#ff9ec4',
  'var(--color-muted)',
]

const DAY_MS = 24 * 60 * 60 * 1000

/** Always draw the full window ending today, so one busy day still reads as a fortnight. */
function dayRange(days: string[], window: number, now: number): string[] {
  const today = new Date(now).toISOString().slice(0, 10)
  const earliest = [...days].sort()[0]
  let start = Date.parse(`${today}T00:00:00Z`) - (window - 1) * DAY_MS
  if (earliest) start = Math.min(start, Date.parse(`${earliest}T00:00:00Z`))
  const out: string[] = []
  for (let t = start; t <= Date.parse(`${today}T00:00:00Z`); t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Stacked bars, one per day, one colour per agent. Hover a bar for exact spend. */
export function CostChart({
  entries,
  window = 14,
  now = Date.now(),
}: { entries: CostEntry[]; window?: number; now?: number }) {
  const agents = [...new Set(entries.map((e) => e.agent))].sort()
  const days = dayRange(
    entries.map((e) => e.day),
    window,
    now,
  )
  const totals = new Map<string, number>()
  const byDayAgent = new Map<string, number>()
  for (const e of entries) {
    totals.set(e.day, (totals.get(e.day) ?? 0) + e.costUsd)
    const k = `${e.day}|${e.agent}`
    byDayAgent.set(k, (byDayAgent.get(k) ?? 0) + e.costUsd)
  }
  const max = Math.max(...totals.values(), 0.01)

  const W = 720
  const H = 200
  const padL = 44
  const padB = 24
  const plotW = W - padL - 8
  const plotH = H - padB - 8
  const slot = plotW / Math.max(days.length, 1)
  const bar = Math.min(28, slot * 0.6)
  const color = (agent: string) =>
    PALETTE[Math.max(0, agents.indexOf(agent)) % PALETTE.length]

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Daily spend across ${days.length} days, highest ${usd(max)}`}
      >
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={padL}
              x2={W - 8}
              y1={8 + plotH * (1 - f)}
              y2={8 + plotH * (1 - f)}
              stroke="var(--color-border)"
              strokeDasharray={f === 1 ? undefined : '2 4'}
            />
            <text
              x={padL - 6}
              y={8 + plotH * (1 - f) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-muted)"
              fontFamily="var(--font-mono)"
            >
              {usd(max * f)}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          x2={W - 8}
          y1={8 + plotH}
          y2={8 + plotH}
          stroke="var(--color-border)"
        />
        {days.map((day, i) => {
          const x = padL + slot * i + (slot - bar) / 2
          let y = 8 + plotH
          const total = totals.get(day) ?? 0
          return (
            <g key={day} data-testid={`cost-bar-${day}`}>
              <title>
                {day}: {usd(total)}
              </title>
              {agents.map((agent) => {
                const v = byDayAgent.get(`${day}|${agent}`) ?? 0
                if (v <= 0) return null
                const h = Math.max(1, (v / max) * plotH)
                y -= h
                return (
                  <rect
                    key={agent}
                    x={x}
                    y={y}
                    width={bar}
                    height={h}
                    fill={color(agent)}
                    rx={1.5}
                  >
                    <title>
                      {agent} on {day}: {usd(v)}
                    </title>
                  </rect>
                )
              })}
              {(i % Math.ceil(days.length / 10) === 0 ||
                i === days.length - 1) && (
                <text
                  x={x + bar / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-muted)"
                  fontFamily="var(--font-mono)"
                >
                  {day.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {agents.map((agent) => (
          <li key={agent} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: color(agent) }}
              aria-hidden="true"
            />
            <span className="font-mono">{agent}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
