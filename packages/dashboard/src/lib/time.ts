const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "just now", "3 min ago", "2 h ago", "yesterday", "Sep 8". */
export function relativeTime(iso: string | undefined, now = Date.now()) {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = now - t
  // A few seconds of skew between the daemon clock and this page is normal.
  if (diff < -MIN) return 'in a moment'
  if (diff < 45_000) return 'just now'
  if (diff < HOUR) return `${Math.round(diff / MIN)} min ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`
  if (diff < 2 * DAY) return 'yesterday'
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** "42 s", "3 m 12 s", "1 h 04 m". Open-ended runs count up to `now`. */
export function duration(
  start: string | undefined,
  end: string | undefined,
  now = Date.now(),
) {
  if (!start) return '—'
  const s = Date.parse(start)
  const e = end ? Date.parse(end) : now
  if (Number.isNaN(s) || Number.isNaN(e)) return '—'
  const ms = Math.max(0, e - s)
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} m ${String(sec % 60).padStart(2, '0')} s`
  const hr = Math.floor(min / 60)
  return `${hr} h ${String(min % 60).padStart(2, '0')} m`
}

/** "$0.34", "<$0.01", "$12.40". */
export function usd(n: number | undefined) {
  if (n === undefined || Number.isNaN(n)) return '—'
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

export function clockTime(iso: string | undefined) {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function todayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}
