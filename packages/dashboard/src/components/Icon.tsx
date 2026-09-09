export type IconName =
  | 'overview'
  | 'runs'
  | 'decisions'
  | 'wiki'
  | 'skills'
  | 'routines'
  | 'costs'
  | 'messages'
  | 'projects'
  | 'requests'
  | 'close'
  | 'check'
  | 'x'
  | 'play'
  | 'stop'
  | 'search'

const PATHS: Record<IconName, string> = {
  overview: 'M2 12h4l3-8 4 16 3-8h6',
  runs: 'M5 4l14 8-14 8z',
  decisions: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z M9 12l2 2 4-4',
  wiki: 'M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4z M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z',
  skills:
    'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z M5 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  routines: 'M12 3a9 9 0 110 18 9 9 0 010-18z M12 7v5l3 2',
  costs: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  messages: 'M4 4h16v13H8l-4 4z',
  projects: 'M4 4h6l2 2h8v12H4z',
  requests: 'M3 11l18-7-7 18-2-8-8-3z',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12 M18 6L6 18',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  search: 'M11 4a7 7 0 110 14 7 7 0 010-14z M20 20l-4-4',
}

export function Icon({
  name,
  size = 16,
  className = '',
}: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
