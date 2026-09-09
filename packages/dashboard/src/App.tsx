import { useCallback, useEffect, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { ToastProvider } from './components/Toast'
import { CostsPanel } from './panels/CostsPanel'
import { DecisionsPanel } from './panels/DecisionsPanel'
import { OverviewPanel } from './panels/OverviewPanel'
import { RoutinesPanel } from './panels/RoutinesPanel'
import { RunsPanel } from './panels/RunsPanel'
import { SkillsPanel } from './panels/SkillsPanel'
import { WikiPanel } from './panels/WikiPanel'

export type PanelName =
  | 'overview'
  | 'runs'
  | 'decisions'
  | 'wiki'
  | 'skills'
  | 'routines'
  | 'costs'

const NAV: Array<{ id: PanelName; label: string; icon: IconName }> = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'runs', label: 'Runs', icon: 'runs' },
  { id: 'decisions', label: 'Decisions', icon: 'decisions' },
  { id: 'wiki', label: 'Wiki', icon: 'wiki' },
  { id: 'skills', label: 'Skills', icon: 'skills' },
  { id: 'routines', label: 'Routines', icon: 'routines' },
  { id: 'costs', label: 'Costs', icon: 'costs' },
]

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export default function App() {
  const [active, setActive] = useState<PanelName>('overview')
  const go = useCallback((p: PanelName) => setActive(p), [])

  // Keys 1–7 jump between panels, unless the person is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const idx = Number.parseInt(e.key, 10) - 1
      if (idx >= 0 && idx < NAV.length) go(NAV[idx].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  let panel: JSX.Element
  switch (active) {
    case 'runs':
      panel = <RunsPanel />
      break
    case 'decisions':
      panel = <DecisionsPanel />
      break
    case 'wiki':
      panel = <WikiPanel />
      break
    case 'skills':
      panel = <SkillsPanel />
      break
    case 'routines':
      panel = <RoutinesPanel />
      break
    case 'costs':
      panel = <CostsPanel />
      break
    default:
      panel = <OverviewPanel onNavigate={go} />
  }

  return (
    <ToastProvider>
      <div className="flex h-screen bg-background text-text">
        <nav
          aria-label="agent-os"
          className="flex w-52 shrink-0 flex-col border-r border-border bg-surface"
        >
          <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-accent" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="font-mono text-sm font-medium tracking-tight text-text">
              agent-os
            </span>
          </div>
          <ul className="flex flex-col gap-0.5 px-2">
            {NAV.map((n, i) => {
              const current = active === n.id
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => go(n.id)}
                    aria-label={n.label}
                    aria-current={current ? 'page' : undefined}
                    className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                      current
                        ? 'bg-raised text-text'
                        : 'text-muted hover:bg-raised/50 hover:text-text'
                    }`}
                  >
                    <Icon
                      name={n.icon}
                      className={current ? 'text-accent' : 'text-muted'}
                    />
                    <span className="flex-1">{n.label}</span>
                    <kbd className="font-mono text-[10px] text-muted/50 group-hover:text-muted">
                      {i + 1}
                    </kbd>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-auto px-4 py-3 text-[11px] text-muted/70">
            Press 1–7 to switch panels
          </div>
        </nav>
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-6xl">{panel}</div>
        </main>
      </div>
    </ToastProvider>
  )
}
