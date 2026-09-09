import { useState } from 'react'
import { ToastProvider } from './components/Toast'
import { AgentsPanel } from './panels/AgentsPanel'
import { CostsPanel } from './panels/CostsPanel'
import { DecisionsPanel } from './panels/DecisionsPanel'
import { RoutinesPanel } from './panels/RoutinesPanel'
import { RunsPanel } from './panels/RunsPanel'
import { SkillsPanel } from './panels/SkillsPanel'
import { WikiPanel } from './panels/WikiPanel'

type PanelName =
  | 'agents'
  | 'runs'
  | 'decisions'
  | 'wiki'
  | 'skills'
  | 'routines'
  | 'costs'

const NAV: Array<{ id: PanelName; label: string }> = [
  { id: 'agents', label: 'Agents' },
  { id: 'runs', label: 'Runs' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'wiki', label: 'Wiki' },
  { id: 'skills', label: 'Skills' },
  { id: 'routines', label: 'Routines' },
  { id: 'costs', label: 'Costs' },
]

const PANELS: Record<PanelName, () => JSX.Element> = {
  agents: AgentsPanel,
  runs: RunsPanel,
  decisions: DecisionsPanel,
  wiki: WikiPanel,
  skills: SkillsPanel,
  routines: RoutinesPanel,
  costs: CostsPanel,
}

export default function App() {
  const [active, setActive] = useState<PanelName>('agents')
  const Panel = PANELS[active]
  return (
    <ToastProvider>
      <div className="flex h-screen bg-background text-text">
        <nav
          aria-label="agent-os"
          className="w-56 shrink-0 border-r border-border bg-surface p-4"
        >
          <div className="mb-4 font-mono text-sm text-accent">agent-os</div>
          <ul className="flex flex-col gap-1">
            {NAV.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setActive(n.id)}
                  aria-current={active === n.id}
                  className={`w-full rounded px-3 py-1.5 text-left text-sm ${active === n.id ? 'bg-background text-accent' : 'text-muted hover:text-text'}`}
                >
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 overflow-auto p-6">
          <Panel />
        </main>
      </div>
    </ToastProvider>
  )
}
