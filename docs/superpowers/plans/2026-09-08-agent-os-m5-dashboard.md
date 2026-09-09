# agent-os M5 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/dashboard`, a React/Vite "command centre" that renders every kernel panel (Agents, Runs, Decisions, Wiki, Skills, Routines, Costs) live over the M1–M4 HTTP/WS API, served by the kernel itself, and prove it with unit/component tests plus a Playwright smoke that approves a seeded Decision end-to-end.

**Architecture:** A typed `ApiClient` (fetch) and a `useEvents` WebSocket hook are the only two ways the UI touches the network; seven panel components under `panels/` each own one GET-heavy slice of state and re-render on matching `Event`s, with `RunStream`/`DecisionCard`/`WikiPage` as the interactive sub-views. The kernel gains a static file handler so `agentos up` alone serves the built dashboard — no second process in the demo.

**Tech Stack:** react@^18, react-dom@^18, vite@^6, tailwindcss@^4 (contract §0) + pinned additions: react-markdown@^9.0.1, @tailwindcss/vite@^4.0.0, @vitejs/plugin-react@^4.3.4, vitest@^2.1.8, @testing-library/react@^16.1.0, @testing-library/jest-dom@^6.6.3, @testing-library/user-event@^14.5.2, jsdom@^25.0.1, @playwright/test@^1.49.1.

**Spec:** docs/superpowers/specs/2026-09-08-agent-os-design.md
**Contract:** docs/superpowers/plans/2026-09-08-agent-os-00-contract.md

## Global Constraints
- Node `>=22`, pnpm `>=9`, TypeScript `^5.6` with `"strict": true`, ESM only (`"type": "module"`), `moduleResolution: "Bundler"`.
- Test runner: Vitest. Build: `tsup`. Lint/format: Biome (single tool).
- Runtime deps (pinned major): `zod@^3`, `better-sqlite3@^11`, `croner@^9`, `fastify@^5` + `@fastify/websocket@^11` + `@fastify/static@^8`, `commander@^12`, `yaml@^2`, `@modelcontextprotocol/sdk@^1`, `execa@^9`, `simple-git@^3`, `gray-matter@^4`, `nanoid@^5`, `pino@^9`.
- Dashboard: `react@^18`, `react-dom@^18`, `vite@^6`, `tailwindcss@^4`.
- Conventional commits (`feat|fix|chore|docs|test|refactor(scope): …`).
- Every commit message ends with: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Public repo: `github.com/ductringuyen-0618/agent-os`. Default branch `main`.
- Nothing machine-specific in committed files (no absolute paths, hostnames, tokens). Runtime state under `<osRoot>/../.agentos/` (gitignored).
- The `claude` binary path comes from `AGENTOS_CLAUDE_BIN` (default `claude`); tests point it at the fake binary.
---

## File structure

```
packages/dashboard/
  package.json                      # @agentos/dashboard: dev/build/test/e2e scripts, pinned deps
  vite.config.ts                    # React + Tailwind v4 plugins, /api and /ws proxy to 127.0.0.1:4545
  vitest.config.ts                  # jsdom env, tests/setup.ts
  tsconfig.json                     # extends tsconfig.base.json
  playwright.config.ts              # e2e project, webServer = kernel with fake claude
  index.html                        # #root mount, <title>agent-os</title>
  src/main.tsx                      # createRoot(App)
  src/index.css                     # Tailwind v4 import + @theme design tokens
  src/App.tsx                       # left nav, panel switch (useState, no router)
  src/api/client.ts                 # ApiClient: typed fetch for every §7 route + GET /api/skills/:name
  src/api/ws.ts                     # useEvents(filter?, opts?) reconnecting WS hook, 500-event ring buffer
  src/components/StatusBadge.tsx    # idle/working/blocked + run/decision status colors
  src/components/Toast.tsx          # ToastProvider + useToast()
  src/components/EmptyState.tsx     # icon + title + copy
  src/components/ErrorState.tsx     # message + Retry button
  src/components/Spinner.tsx        # inline loading spinner
  src/components/RunStream.tsx      # replay + live-append run.stream, Kill button
  src/components/DecisionCard.tsx   # markdown body, Approve/Reject, optimistic + toast
  src/components/WikiPage.tsx       # markdown + [[Wikilink]] -> in-app nav
  src/panels/AgentsPanel.tsx
  src/panels/RunsPanel.tsx
  src/panels/DecisionsPanel.tsx
  src/panels/WikiPanel.tsx
  src/panels/SkillsPanel.tsx
  src/panels/RoutinesPanel.tsx
  src/panels/CostsPanel.tsx
tests/
  setup.ts                          # jest-dom matchers, WebSocket/fetch cleanup
  mockServer.ts                     # installMockFetch(), MockWebSocket, fixtures for every §7 route
e2e/
  dashboard.spec.ts                 # starts kernel w/ fake claude, checks 7 panels, approves seeded decision
tools/
  seed-decision.ts                  # inserts a pending Decision via EventLog for e2e/demo seeding
packages/kernel/src/api/server.ts   # MODIFIED: registers @fastify/static for packages/dashboard/dist at "/"
```

### Task 1: Scaffold `packages/dashboard` + test tooling

**Files:** `packages/dashboard/package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/index.css`, `src/App.tsx` (shell only), `tests/setup.ts`

**Interfaces:** Consumes: none yet. Produces: `App` component exported default from `src/App.tsx`; dev proxy `/api`, `/ws` → `http://127.0.0.1:4545`.

- [ ] **Step 1: Write failing smoke test**
  `packages/dashboard/src/App.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import App from './App'

  describe('App', () => {
    it('renders the command centre nav', () => {
      render(<App />)
      expect(screen.getByRole('navigation', { name: /agent-os/i })).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — expect failure: package/dashboard does not exist yet (`ENOENT`/module resolution error).

- [ ] **Step 2: Scaffold package + config (minimal implementation)**
  `packages/dashboard/package.json`:
  ```json
  {
    "name": "@agentos/dashboard",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc -b && vite build",
      "test": "vitest run",
      "test:watch": "vitest",
      "e2e": "playwright test"
    },
    "dependencies": {
      "@agentos/shared": "workspace:*",
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "react-markdown": "^9.0.1"
    },
    "devDependencies": {
      "@vitejs/plugin-react": "^4.3.4",
      "@tailwindcss/vite": "^4.0.0",
      "tailwindcss": "^4.0.0",
      "typescript": "^5.6.3",
      "vite": "^6.0.7",
      "vitest": "^2.1.8",
      "@testing-library/react": "^16.1.0",
      "@testing-library/jest-dom": "^6.6.3",
      "@testing-library/user-event": "^14.5.2",
      "jsdom": "^25.0.1",
      "@playwright/test": "^1.49.1",
      "@types/react": "^18.3.18",
      "@types/react-dom": "^18.3.5"
    }
  }
  ```
  `packages/dashboard/vite.config.ts`:
  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'
  import tailwindcss from '@tailwindcss/vite'

  export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:4545',
        '/ws': { target: 'ws://127.0.0.1:4545', ws: true }
      }
    },
    build: { outDir: 'dist' }
  })
  ```
  `packages/dashboard/vitest.config.ts`:
  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['../../tests/setup.ts'],
      globals: false
    }
  })
  ```
  `packages/dashboard/tsconfig.json`:
  ```json
  { "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"] }, "include": ["src"] }
  ```
  `packages/dashboard/index.html`:
  ```html
  <!doctype html>
  <html lang="en">
    <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>agent-os</title></head>
    <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
  </html>
  ```
  `packages/dashboard/src/main.tsx`:
  ```tsx
  import { StrictMode } from 'react'
  import { createRoot } from 'react-dom/client'
  import App from './App'
  import './index.css'

  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
  ```
  `packages/dashboard/src/index.css`:
  ```css
  @import "tailwindcss";

  @theme {
    --color-background: #0b0f14;
    --color-surface: #111823;
    --color-border: #1f2a37;
    --color-text: #e6edf3;
    --color-muted: #8b98a5;
    --color-accent: #5eead4;
    --color-danger: #f87171;
    --color-warn: #fbbf24;
    --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, "Cascadia Code", monospace;
  }

  body { background: var(--color-background); color: var(--color-text); font-family: var(--font-sans); }
  ```
  `packages/dashboard/src/App.tsx`:
  ```tsx
  export default function App() {
    return (
      <div className="flex h-screen bg-background text-text">
        <nav aria-label="agent-os" className="w-56 shrink-0 border-r border-border bg-surface p-4">
          <div className="font-mono text-sm text-accent">agent-os</div>
        </nav>
        <main className="flex-1 overflow-auto p-6" />
      </div>
    )
  }
  ```
  `tests/setup.ts`:
  ```ts
  import '@testing-library/jest-dom/vitest'
  import { afterEach } from 'vitest'
  import { cleanup } from '@testing-library/react'

  afterEach(() => cleanup())
  ```
  Run: `pnpm install && pnpm --filter @agentos/dashboard test` — PASS (1 test).

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard tests/setup.ts pnpm-workspace.yaml
  git commit -m "feat(dashboard): scaffold vite/react/tailwind package with smoke test

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 2: Shared components — StatusBadge, Spinner, EmptyState, ErrorState, Toast

**Files:** `src/components/StatusBadge.tsx`, `src/components/Spinner.tsx`, `src/components/EmptyState.tsx`, `src/components/ErrorState.tsx`, `src/components/Toast.tsx`, tests alongside each (`*.test.tsx`)

**Interfaces:** Produces:
```ts
export function StatusBadge(props: { status: 'idle'|'working'|'blocked'|'queued'|'running'|'wrapping_up'|'success'|'failed'|'killed'|'pending'|'approved'|'rejected'|'error' }): JSX.Element
export function Spinner(props: { label?: string }): JSX.Element
export function EmptyState(props: { title: string; body: string }): JSX.Element
export function ErrorState(props: { message: string; onRetry?: () => void }): JSX.Element
export function ToastProvider(props: { children: React.ReactNode }): JSX.Element
export function useToast(): { push: (msg: string, kind?: 'info'|'error') => void }
```

- [ ] **Step 1: Failing tests**
  `src/components/StatusBadge.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { StatusBadge } from './StatusBadge'

  describe('StatusBadge', () => {
    it('renders blocked with danger styling', () => {
      render(<StatusBadge status="blocked" />)
      const badge = screen.getByText('blocked')
      expect(badge).toHaveClass('text-danger')
    })
  })
  ```
  `src/components/ErrorState.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { ErrorState } from './ErrorState'

  describe('ErrorState', () => {
    it('calls onRetry when clicked', async () => {
      const onRetry = vi.fn()
      render(<ErrorState message="failed to load" onRetry={onRetry} />)
      await userEvent.click(screen.getByRole('button', { name: /retry/i }))
      expect(onRetry).toHaveBeenCalledOnce()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (modules don't exist).

- [ ] **Step 2: Implement**
  `src/components/StatusBadge.tsx`:
  ```tsx
  const COLORS: Record<string, string> = {
    idle: 'text-muted', working: 'text-accent', blocked: 'text-danger',
    queued: 'text-muted', running: 'text-accent', wrapping_up: 'text-warn',
    success: 'text-accent', failed: 'text-danger', killed: 'text-danger',
    pending: 'text-warn', approved: 'text-accent', rejected: 'text-danger', error: 'text-danger'
  }

  export function StatusBadge({ status }: { status: string }) {
    const color = COLORS[status] ?? 'text-muted'
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-xs ${color}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {status}
      </span>
    )
  }
  ```
  `src/components/Spinner.tsx`:
  ```tsx
  export function Spinner({ label = 'Loading…' }: { label?: string }) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
        {label}
      </div>
    )
  }
  ```
  `src/components/EmptyState.tsx`:
  ```tsx
  export function EmptyState({ title, body }: { title: string; body: string }) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-10 text-center">
        <div className="font-medium text-text">{title}</div>
        <div className="text-sm text-muted">{body}</div>
      </div>
    )
  }
  ```
  `src/components/ErrorState.tsx`:
  ```tsx
  export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 p-6 text-center">
        <div className="text-sm text-danger">{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="rounded border border-border px-3 py-1 text-xs text-text hover:border-accent">
            Retry
          </button>
        )}
      </div>
    )
  }
  ```
  `src/components/Toast.tsx`:
  ```tsx
  import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

  interface ToastMsg { id: number; text: string; kind: 'info' | 'error' }
  interface ToastCtx { push: (text: string, kind?: 'info' | 'error') => void }

  const Ctx = createContext<ToastCtx | null>(null)

  export function ToastProvider({ children }: { children: ReactNode }) {
    const [msgs, setMsgs] = useState<ToastMsg[]>([])
    const push = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
      const id = Date.now() + Math.random()
      setMsgs((m) => [...m, { id, text, kind }])
      setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 4000)
    }, [])
    return (
      <Ctx.Provider value={{ push }}>
        {children}
        <div className="fixed bottom-4 right-4 flex flex-col gap-2">
          {msgs.map((m) => (
            <div key={m.id} className={`rounded border px-3 py-2 text-sm shadow-lg ${m.kind === 'error' ? 'border-danger text-danger bg-surface' : 'border-border text-text bg-surface'}`}>
              {m.text}
            </div>
          ))}
        </div>
      </Ctx.Provider>
    )
  }

  export function useToast(): ToastCtx {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error('useToast must be used within ToastProvider')
    return ctx
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/components
  git commit -m "feat(dashboard): add shared StatusBadge/Spinner/EmptyState/ErrorState/Toast

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 3: `api/client.ts` — typed fetch for every §7 route

**Files:** `src/api/client.ts`, `src/api/client.test.ts`, `tests/mockServer.ts`

**Interfaces:** Consumes: contract §7 routes + `GET /api/skills/:name` (Contract addition #1). Produces:
```ts
export class ApiError extends Error { status: number; body?: unknown }
export interface AgentStatus { name: string; status: 'idle'|'working'|'blocked'; currentRun?: string }
export interface RoutineListItem { routine: RoutineConfig; nextRun?: string; lastRun?: Run }
export interface CostEntry { day: string; agent: string; costUsd: number }
export interface SkillDetail { skillMd: string; learningsMd: string; eval: EvalCriteria; lastOutputMd: string }
export class ApiClient {
  constructor(baseUrl?: string)
  health(): Promise<{ ok: true; version: string }>
  listRuns(opts?: { status?: RunStatus; routine?: string; limit?: number }): Promise<Run[]>
  getRun(id: string): Promise<Run>
  getRunEvents(id: string, sinceId?: number): Promise<Event[]>
  killRun(id: string): Promise<{ ok: true }>
  listDecisions(status?: DecisionStatus): Promise<Decision[]>
  approveDecision(id: string): Promise<Decision>
  rejectDecision(id: string): Promise<Decision>
  listRoutines(): Promise<RoutineListItem[]>
  runRoutine(name: string, payload?: Record<string, unknown>): Promise<{ runId: string }>
  enableRoutine(name: string): Promise<{ ok: true }>
  disableRoutine(name: string): Promise<{ ok: true }>
  wikiIndex(): Promise<{ content: string }>
  wikiLog(limit?: number): Promise<{ content: string }>
  wikiPage(path: string): Promise<{ content: string }>
  listSkills(): Promise<SkillMeta[]>
  getSkill(name: string): Promise<SkillDetail>
  listAgents(): Promise<AgentStatus[]>
  costs(days?: number): Promise<CostEntry[]>
}
```

- [ ] **Step 1: Write `tests/mockServer.ts` fixtures + failing test**
  `tests/mockServer.ts`:
  ```ts
  import { vi } from 'vitest'
  import type { Run, Event, Decision, SkillMeta, RoutineConfig } from '@agentos/shared'

  export const fixtures = {
    run: { id: 'run_1', routine: 'heartbeat', status: 'success', attempt: 1 } satisfies Run,
    events: [{ id: 1, ts: '2026-09-08T00:00:00Z', type: 'run.started', runId: 'run_1', payload: {} }] satisfies Event[],
    decision: { id: 'dec_1', title: 'Approve proposal', body: '# Proposal\nDo the thing.', status: 'pending', createdAt: '2026-09-08T00:00:00Z' } satisfies Decision,
    routine: { name: 'heartbeat', every: '30m' } satisfies RoutineConfig,
    skill: { name: 'heartbeat', path: 'skills/heartbeat', hasLearnings: true, lastScore: 0.9 } satisfies SkillMeta
  }

  type Handler = (url: URL, init?: RequestInit) => unknown

  export function installMockFetch(overrides: Record<string, Handler> = {}) {
    const routes: Record<string, Handler> = {
      'GET /api/health': () => ({ ok: true, version: '0.1.0' }),
      'GET /api/runs': () => [fixtures.run],
      'GET /api/runs/run_1': () => fixtures.run,
      'GET /api/runs/run_1/events': () => fixtures.events,
      'POST /api/runs/run_1/kill': () => ({ ok: true }),
      'GET /api/decisions': () => [fixtures.decision],
      'POST /api/decisions/dec_1/approve': () => ({ ...fixtures.decision, status: 'approved' }),
      'POST /api/decisions/dec_1/reject': () => ({ ...fixtures.decision, status: 'rejected' }),
      'GET /api/routines': () => [{ routine: fixtures.routine, nextRun: '2026-09-08T01:00:00Z' }],
      'POST /api/routines/heartbeat/run': () => ({ runId: 'run_2' }),
      'POST /api/routines/heartbeat/enable': () => ({ ok: true }),
      'POST /api/routines/heartbeat/disable': () => ({ ok: true }),
      'GET /api/wiki/index': () => ({ content: '# Index' }),
      'GET /api/wiki/log': () => ({ content: '## [2026-09-08] note | Hello' }),
      'GET /api/wiki/page': () => ({ content: '# Page\nSee [[projects/techpulse]].' }),
      'GET /api/skills': () => [fixtures.skill],
      'GET /api/skills/heartbeat': () => ({ skillMd: '# skill', learningsMd: '# learnings', eval: { criteria: [] }, lastOutputMd: '# output' }),
      'GET /api/agents': () => [{ name: 'ops', status: 'idle' }],
      'GET /api/costs': () => [{ day: '2026-09-08', agent: 'ops', costUsd: 0.42 }],
      ...overrides
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      const key = `${init?.method ?? 'GET'} ${url.pathname}`
      const handler = routes[key]
      if (!handler) return new Response(JSON.stringify({ error: `no mock for ${key}` }), { status: 404 })
      const body = handler(url, init)
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
  }
  ```
  `src/api/client.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest'
  import { installMockFetch, fixtures } from '../../tests/mockServer'
  import { ApiClient } from './client'

  describe('ApiClient', () => {
    beforeEach(() => installMockFetch())

    it('lists runs', async () => {
      const client = new ApiClient()
      const runs = await client.listRuns()
      expect(runs).toEqual([fixtures.run])
    })

    it('approves a decision', async () => {
      const client = new ApiClient()
      const decision = await client.approveDecision('dec_1')
      expect(decision.status).toBe('approved')
    })

    it('fetches skill detail (contract addition)', async () => {
      const client = new ApiClient()
      const detail = await client.getSkill('heartbeat')
      expect(detail.skillMd).toContain('# skill')
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`client.ts` missing).

- [ ] **Step 2: Implement `src/api/client.ts`**
  ```ts
  import type { Run, Event, Decision, RunStatus, DecisionStatus, SkillMeta, RoutineConfig, EvalCriteria } from '@agentos/shared'

  export class ApiError extends Error {
    status: number
    body?: unknown
    constructor(status: number, message: string, body?: unknown) {
      super(message)
      this.status = status
      this.body = body
    }
  }

  export interface AgentStatus { name: string; status: 'idle' | 'working' | 'blocked'; currentRun?: string }
  export interface RoutineListItem { routine: RoutineConfig; nextRun?: string; lastRun?: Run }
  export interface CostEntry { day: string; agent: string; costUsd: number }
  export interface SkillDetail { skillMd: string; learningsMd: string; eval: EvalCriteria; lastOutputMd: string }

  function authHeaders(): Record<string, string> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('agentosToken') : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  export class ApiClient {
    constructor(private baseUrl = '') {}

    private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : undefined
      if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText, data)
      return data as T
    }

    health() { return this.req<{ ok: true; version: string }>('GET', '/api/health') }

    listRuns(opts: { status?: RunStatus; routine?: string; limit?: number } = {}) {
      const qs = new URLSearchParams(opts as Record<string, string>).toString()
      return this.req<Run[]>('GET', `/api/runs${qs ? `?${qs}` : ''}`)
    }
    getRun(id: string) { return this.req<Run>('GET', `/api/runs/${id}`) }
    getRunEvents(id: string, sinceId?: number) {
      return this.req<Event[]>('GET', `/api/runs/${id}/events${sinceId ? `?sinceId=${sinceId}` : ''}`)
    }
    killRun(id: string) { return this.req<{ ok: true }>('POST', `/api/runs/${id}/kill`) }

    listDecisions(status?: DecisionStatus) {
      return this.req<Decision[]>('GET', `/api/decisions${status ? `?status=${status}` : ''}`)
    }
    approveDecision(id: string) { return this.req<Decision>('POST', `/api/decisions/${id}/approve`) }
    rejectDecision(id: string) { return this.req<Decision>('POST', `/api/decisions/${id}/reject`) }

    listRoutines() { return this.req<RoutineListItem[]>('GET', '/api/routines') }
    runRoutine(name: string, payload?: Record<string, unknown>) {
      return this.req<{ runId: string }>('POST', `/api/routines/${name}/run`, { payload })
    }
    enableRoutine(name: string) { return this.req<{ ok: true }>('POST', `/api/routines/${name}/enable`) }
    disableRoutine(name: string) { return this.req<{ ok: true }>('POST', `/api/routines/${name}/disable`) }

    wikiIndex() { return this.req<{ content: string }>('GET', '/api/wiki/index') }
    wikiLog(limit?: number) { return this.req<{ content: string }>('GET', `/api/wiki/log${limit ? `?limit=${limit}` : ''}`) }
    wikiPage(path: string) { return this.req<{ content: string }>('GET', `/api/wiki/page?path=${encodeURIComponent(path)}`) }

    listSkills() { return this.req<SkillMeta[]>('GET', '/api/skills') }
    getSkill(name: string) { return this.req<SkillDetail>('GET', `/api/skills/${name}`) }

    listAgents() { return this.req<AgentStatus[]>('GET', '/api/agents') }
    costs(days?: number) { return this.req<CostEntry[]>('GET', `/api/costs${days ? `?days=${days}` : ''}`) }
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS (3 new tests).

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/api/client.ts packages/dashboard/src/api/client.test.ts tests/mockServer.ts
  git commit -m "feat(dashboard): add typed ApiClient for all contract routes + mock fetch fixtures

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 4: `api/ws.ts` — `useEvents` reconnecting hook

**Files:** `src/api/ws.ts`, `src/api/ws.test.ts`, `tests/mockServer.ts` (add `MockWebSocket`)

**Interfaces:** Consumes: `WS /ws` (server pushes `Event` JSON). Produces:
```ts
export interface UseEventsOptions { maxBuffer?: number }
export interface UseEventsResult { events: Event[]; connected: boolean; clear: () => void }
export function useEvents(filter?: (e: Event) => boolean, opts?: UseEventsOptions): UseEventsResult
export function wsUrl(): string
```

- [ ] **Step 1: Add `MockWebSocket` + failing test**
  Append to `tests/mockServer.ts`:
  ```ts
  export class MockWebSocket {
    static instances: MockWebSocket[] = []
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    readyState = 0
    url: string
    constructor(url: string) {
      this.url = url
      MockWebSocket.instances.push(this)
      setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
    }
    close() { this.readyState = 3; this.onclose?.() }
    send() {}
    emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
  }
  ```
  `src/api/ws.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { renderHook, waitFor, act } from '@testing-library/react'
  import { MockWebSocket } from '../../tests/mockServer'
  import { useEvents } from './ws'

  describe('useEvents', () => {
    beforeEach(() => {
      MockWebSocket.instances = []
      vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
    })

    it('connects and appends incoming events', async () => {
      const { result } = renderHook(() => useEvents())
      await waitFor(() => expect(result.current.connected).toBe(true))
      const socket = MockWebSocket.instances[0]
      act(() => socket.emit({ id: 1, ts: 'now', type: 'run.started', payload: {} }))
      await waitFor(() => expect(result.current.events).toHaveLength(1))
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (`ws.ts` missing).

- [ ] **Step 2: Implement `src/api/ws.ts`**
  ```tsx
  import { useCallback, useEffect, useRef, useState } from 'react'
  import type { Event } from '@agentos/shared'

  export interface UseEventsOptions { maxBuffer?: number }
  export interface UseEventsResult { events: Event[]; connected: boolean; clear: () => void }

  export function wsUrl(): string {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('agentosToken') : null
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const base = `${proto}://${window.location.host}/ws`
    return token ? `${base}?token=${encodeURIComponent(token)}` : base
  }

  export function useEvents(filter?: (e: Event) => boolean, opts: UseEventsOptions = {}): UseEventsResult {
    const maxBuffer = opts.maxBuffer ?? 500
    const [events, setEvents] = useState<Event[]>([])
    const [connected, setConnected] = useState(false)
    const wsRef = useRef<WebSocket | null>(null)
    const filterRef = useRef(filter)
    filterRef.current = filter

    useEffect(() => {
      let cancelled = false
      let retryMs = 1000
      let socket: WebSocket

      function connect() {
        socket = new WebSocket(wsUrl())
        wsRef.current = socket
        socket.onopen = () => { if (!cancelled) { setConnected(true); retryMs = 1000 } }
        socket.onclose = () => {
          if (cancelled) return
          setConnected(false)
          setTimeout(connect, retryMs)
          retryMs = Math.min(retryMs * 2, 15000)
        }
        socket.onerror = () => socket.close()
        socket.onmessage = (msg: { data: string }) => {
          try {
            const e = JSON.parse(msg.data) as Event
            if (filterRef.current && !filterRef.current(e)) return
            setEvents((prev) => {
              const next = [...prev, e]
              return next.length > maxBuffer ? next.slice(next.length - maxBuffer) : next
            })
          } catch { /* ignore unparseable frame */ }
        }
      }
      connect()
      return () => { cancelled = true; wsRef.current?.close() }
    }, [maxBuffer])

    const clear = useCallback(() => setEvents([]), [])
    return { events, connected, clear }
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/api/ws.ts packages/dashboard/src/api/ws.test.ts tests/mockServer.ts
  git commit -m "feat(dashboard): add reconnecting useEvents WebSocket hook with 500-event buffer

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 5: `App.tsx` — left nav + panel routing

**Files:** `src/App.tsx`, `src/App.test.tsx` (extend)

**Interfaces:** Produces: `type PanelName = 'agents'|'runs'|'decisions'|'wiki'|'skills'|'routines'|'costs'`; `App` renders `<nav>` with 7 buttons and swaps the active panel by `useState<PanelName>`.

- [ ] **Step 1: Failing test**
  Replace `src/App.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch } from '../tests/mockServer'
  import App from './App'

  describe('App', () => {
    it('switches panels via left nav', async () => {
      installMockFetch()
      render(<App />)
      expect(screen.getByRole('navigation', { name: /agent-os/i })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Decisions' }))
      expect(await screen.findByRole('heading', { name: 'Decisions' })).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (no nav buttons / no Decisions heading yet).

- [ ] **Step 2: Implement** (placeholder panels wired in later tasks; each panel already exists as an exported function once its own task lands — for this step, stub the five not-yet-built as inline components so the test for the one built type-checks against the final shape used in later tasks)
  `src/App.tsx`:
  ```tsx
  import { useState } from 'react'
  import { ToastProvider } from './components/Toast'
  import { AgentsPanel } from './panels/AgentsPanel'
  import { RunsPanel } from './panels/RunsPanel'
  import { DecisionsPanel } from './panels/DecisionsPanel'
  import { WikiPanel } from './panels/WikiPanel'
  import { SkillsPanel } from './panels/SkillsPanel'
  import { RoutinesPanel } from './panels/RoutinesPanel'
  import { CostsPanel } from './panels/CostsPanel'

  type PanelName = 'agents' | 'runs' | 'decisions' | 'wiki' | 'skills' | 'routines' | 'costs'

  const NAV: Array<{ id: PanelName; label: string }> = [
    { id: 'agents', label: 'Agents' },
    { id: 'runs', label: 'Runs' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'wiki', label: 'Wiki' },
    { id: 'skills', label: 'Skills' },
    { id: 'routines', label: 'Routines' },
    { id: 'costs', label: 'Costs' }
  ]

  const PANELS: Record<PanelName, () => JSX.Element> = {
    agents: AgentsPanel, runs: RunsPanel, decisions: DecisionsPanel,
    wiki: WikiPanel, skills: SkillsPanel, routines: RoutinesPanel, costs: CostsPanel
  }

  export default function App() {
    const [active, setActive] = useState<PanelName>('agents')
    const Panel = PANELS[active]
    return (
      <ToastProvider>
        <div className="flex h-screen bg-background text-text">
          <nav aria-label="agent-os" className="w-56 shrink-0 border-r border-border bg-surface p-4">
            <div className="mb-4 font-mono text-sm text-accent">agent-os</div>
            <ul className="flex flex-col gap-1">
              {NAV.map((n) => (
                <li key={n.id}>
                  <button
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
          <main className="flex-1 overflow-auto p-6"><Panel /></main>
        </div>
      </ToastProvider>
    )
  }
  ```
  This step forward-declares the seven panel imports; Tasks 6–12 create each file with at minimum a loading/empty/error-capable component exporting `export function XPanel(): JSX.Element` with an `<h2>{Name}</h2>` heading — built out fully in their own tasks. To keep this task's test green in isolation, Task 6 (Agents) and the DecisionsPanel skeleton (used by this test) are implemented now as part of this step:
  `src/panels/AgentsPanel.tsx`, `src/panels/RunsPanel.tsx`, `src/panels/WikiPanel.tsx`, `src/panels/SkillsPanel.tsx`, `src/panels/RoutinesPanel.tsx`, `src/panels/CostsPanel.tsx` each start as:
  ```tsx
  export function AgentsPanel() { return <h2 className="text-lg font-medium">Agents</h2> }
  ```
  (same pattern, name substituted per file — `RunsPanel`/`Runs`, `WikiPanel`/`Wiki`, `SkillsPanel`/`Skills`, `RoutinesPanel`/`Routines`, `CostsPanel`/`Costs`) and
  `src/panels/DecisionsPanel.tsx`:
  ```tsx
  export function DecisionsPanel() { return <h2 className="text-lg font-medium">Decisions</h2> }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS. (Tasks 6–12 replace each stub with its full implementation and matching tests; the App-level test continues to assert only the heading text, which every full implementation preserves.)

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/App.tsx packages/dashboard/src/App.test.tsx packages/dashboard/src/panels
  git commit -m "feat(dashboard): wire left-nav panel routing with seven panel stubs

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 6: AgentsPanel

**Files:** `src/panels/AgentsPanel.tsx`, `src/panels/AgentsPanel.test.tsx`

**Interfaces:** Consumes: `GET /api/agents` → `AgentStatus[]`; re-fetches on any `run.*` event via `useEvents(e => e.type.startsWith('run.'))`. Produces: `export function AgentsPanel(): JSX.Element`.

- [ ] **Step 1: Failing test**
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { installMockFetch } from '../../tests/mockServer'
  import { MockWebSocket } from '../../tests/mockServer'
  import { vi } from 'vitest'
  import { AgentsPanel } from './AgentsPanel'

  describe('AgentsPanel', () => {
    it('renders agent cards with status badges', async () => {
      installMockFetch()
      vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
      render(<AgentsPanel />)
      expect(await screen.findByText('ops')).toBeInTheDocument()
      expect(screen.getByText('idle')).toBeInTheDocument()
    })

    it('shows empty state when no agents configured', async () => {
      installMockFetch({ 'GET /api/agents': () => [] })
      vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
      render(<AgentsPanel />)
      expect(await screen.findByText(/no agents/i)).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL (stub has no cards/empty state).

- [ ] **Step 2: Implement**
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import { ApiClient, ApiError, type AgentStatus } from '../api/client'
  import { useEvents } from '../api/ws'
  import { StatusBadge } from '../components/StatusBadge'
  import { Spinner } from '../components/Spinner'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'

  const client = new ApiClient()

  export function AgentsPanel() {
    const [agents, setAgents] = useState<AgentStatus[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const { events } = useEvents((e) => e.type.startsWith('run.'))

    const load = useCallback(() => {
      setError(null)
      client.listAgents().then(setAgents).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load agents'))
    }, [])

    useEffect(() => { load() }, [load, events.length])

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Agents</h2>
        {error && <ErrorState message={error} onRetry={load} />}
        {!error && agents === null && <Spinner label="Loading agents…" />}
        {!error && agents !== null && agents.length === 0 && (
          <EmptyState title="No agents" body="Add an agent under os/agents/<name>/AGENT.md to see it here." />
        )}
        {!error && agents !== null && agents.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {agents.map((a) => (
              <div key={a.name} className="rounded-lg border border-border bg-surface p-4">
                <div className="font-mono text-sm text-text">{a.name}</div>
                <div className="mt-2"><StatusBadge status={a.status} /></div>
                {a.currentRun && (
                  <div className="mt-2 text-xs text-muted">run: <span className="font-mono text-accent">{a.currentRun}</span></div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/AgentsPanel.tsx packages/dashboard/src/panels/AgentsPanel.test.tsx
  git commit -m "feat(dashboard): implement AgentsPanel with live status refresh on run events

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 7: RunsPanel + RunStream

**Files:** `src/panels/RunsPanel.tsx`, `src/components/RunStream.tsx`, tests for both

**Interfaces:** Consumes: `GET /api/runs`, `GET /api/runs/:id/events`, `POST /api/runs/:id/kill`; live-appends via `useEvents(e => e.type === 'run.stream' && e.runId === id)`. Assumption (documented, matches ProcessManager per contract §4): a `run.stream` event's `payload` is `{ message: ClaudeStreamMessage }`. Produces: `export function RunsPanel(): JSX.Element`, `export function RunStream(props: { runId: string; onClose: () => void }): JSX.Element`.

- [ ] **Step 1: Failing tests**
  `src/components/RunStream.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen, waitFor } from '@testing-library/react'
  import { installMockFetch, MockWebSocket } from '../../tests/mockServer'
  import { RunStream } from './RunStream'

  describe('RunStream', () => {
    it('replays events then appends live assistant text', async () => {
      installMockFetch({
        'GET /api/runs/run_1/events': () => [
          { id: 1, ts: 't', type: 'run.stream', runId: 'run_1', payload: { message: { type: 'assistant', session_id: 's', message: { content: [{ type: 'text', text: 'hello from replay' }] } } } }
        ]
      })
      vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
      render(<RunStream runId="run_1" onClose={() => {}} />)
      expect(await screen.findByText('hello from replay')).toBeInTheDocument()
    })

    it('kills the run', async () => {
      const kill = vi.fn(() => ({ ok: true }))
      installMockFetch({ 'GET /api/runs/run_1/events': () => [], 'POST /api/runs/run_1/kill': kill })
      vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
      const { default: userEvent } = await import('@testing-library/user-event')
      render(<RunStream runId="run_1" onClose={() => {}} />)
      await userEvent.click(await screen.findByRole('button', { name: /kill/i }))
      await waitFor(() => expect(kill).toHaveBeenCalled())
    })
  })
  ```
  `src/panels/RunsPanel.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch, MockWebSocket, fixtures } from '../../tests/mockServer'
  import { vi } from 'vitest'
  import { RunsPanel } from './RunsPanel'

  describe('RunsPanel', () => {
    it('lists runs and opens the stream on click', async () => {
      installMockFetch({ 'GET /api/runs/run_1/events': () => [] })
      vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
      render(<RunsPanel />)
      const row = await screen.findByText(fixtures.run.id)
      await userEvent.click(row)
      expect(await screen.findByRole('button', { name: /kill/i })).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL.

- [ ] **Step 2: Implement**
  `src/components/RunStream.tsx`:
  ```tsx
  import { useEffect, useMemo, useState } from 'react'
  import type { Event, ClaudeStreamMessage } from '@agentos/shared'
  import { ApiClient } from '../api/client'
  import { useEvents } from '../api/ws'
  import { Spinner } from './Spinner'
  import { useToast } from './Toast'

  const client = new ApiClient()

  function renderMessage(msg: ClaudeStreamMessage, key: number) {
    if (msg.type === 'assistant') {
      return (
        <div key={key} className="space-y-1">
          {msg.message.content.map((c, i) =>
            c.type === 'text' ? (
              <p key={i} className="text-sm text-text">{c.text}</p>
            ) : c.type === 'tool_use' ? (
              <pre key={i} className="rounded border border-border bg-background p-2 font-mono text-xs text-accent">
                {c.name}({JSON.stringify(c.input)})
              </pre>
            ) : null
          )}
        </div>
      )
    }
    if (msg.type === 'user') {
      return <pre key={key} className="rounded border border-border bg-background p-2 font-mono text-xs text-muted">tool_result: {JSON.stringify(msg.message.content)}</pre>
    }
    if (msg.type === 'result') {
      return (
        <div key={key} className="rounded border border-border bg-surface p-2 font-mono text-xs text-muted">
          result: {msg.subtype} · cost ${msg.total_cost_usd?.toFixed(4) ?? '0.0000'} · tokens {msg.usage ? msg.usage.input_tokens + msg.usage.output_tokens : 0}
        </div>
      )
    }
    return null
  }

  export function RunStream({ runId, onClose }: { runId: string; onClose: () => void }) {
    const [history, setHistory] = useState<Event[] | null>(null)
    const { events: live } = useEvents((e) => e.type === 'run.stream' && e.runId === runId)
    const { push } = useToast()

    useEffect(() => { client.getRunEvents(runId).then(setHistory) }, [runId])

    const all = useMemo(() => [...(history ?? []), ...live], [history, live])

    async function kill() {
      try {
        await client.killRun(runId)
        push(`Kill requested for ${runId}`)
      } catch {
        push(`Failed to kill ${runId}`, 'error')
      }
    }

    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-sm">{runId}</div>
          <div className="flex gap-2">
            <button onClick={kill} className="rounded border border-danger px-2 py-1 text-xs text-danger">Kill</button>
            <button onClick={onClose} className="rounded border border-border px-2 py-1 text-xs text-muted">Close</button>
          </div>
        </div>
        {history === null ? (
          <Spinner label="Loading run history…" />
        ) : (
          <div className="flex flex-col gap-2">
            {all.map((e, i) => {
              const msg = (e.payload as { message?: ClaudeStreamMessage }).message
              return msg ? renderMessage(msg, i) : null
            })}
          </div>
        )}
      </div>
    )
  }
  ```
  `src/panels/RunsPanel.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import type { Run } from '@agentos/shared'
  import { ApiClient, ApiError } from '../api/client'
  import { StatusBadge } from '../components/StatusBadge'
  import { RunStream } from '../components/RunStream'
  import { Spinner } from '../components/Spinner'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'

  const client = new ApiClient()

  export function RunsPanel() {
    const [runs, setRuns] = useState<Run[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [selected, setSelected] = useState<string | null>(null)

    const load = useCallback(() => {
      setError(null)
      client.listRuns({ limit: 50 }).then(setRuns).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load runs'))
    }, [])

    useEffect(() => { load() }, [load])

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Runs</h2>
        {error && <ErrorState message={error} onRetry={load} />}
        {!error && runs === null && <Spinner label="Loading runs…" />}
        {!error && runs !== null && runs.length === 0 && <EmptyState title="No runs yet" body="Runs appear here once a routine fires." />}
        {!error && runs !== null && runs.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2">ID</th><th>Routine</th><th>Status</th><th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r.id)} className="cursor-pointer border-b border-border hover:bg-background">
                  <td className="py-2 font-mono text-accent">{r.id}</td>
                  <td>{r.routine}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="text-muted">{r.startedAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selected && <div className="mt-4"><RunStream runId={selected} onClose={() => setSelected(null)} /></div>}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/RunsPanel.tsx packages/dashboard/src/panels/RunsPanel.test.tsx packages/dashboard/src/components/RunStream.tsx packages/dashboard/src/components/RunStream.test.tsx
  git commit -m "feat(dashboard): implement RunsPanel and RunStream with replay + live tail + kill

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 8: DecisionsPanel + DecisionCard

**Files:** `src/panels/DecisionsPanel.tsx`, `src/components/DecisionCard.tsx`, tests for both

**Interfaces:** Consumes: `GET /api/decisions?status=`, `POST /api/decisions/:id/approve`, `POST /api/decisions/:id/reject`. Produces: `export function DecisionCard(props: { decision: Decision; onResolved: (d: Decision) => void }): JSX.Element`, `export function DecisionsPanel(): JSX.Element` with pending/history tabs.

- [ ] **Step 1: Failing tests**
  `src/components/DecisionCard.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch, fixtures } from '../../tests/mockServer'
  import { DecisionCard } from './DecisionCard'

  describe('DecisionCard', () => {
    it('approves optimistically and calls onResolved', async () => {
      installMockFetch()
      const onResolved = vi.fn()
      render(<DecisionCard decision={fixtures.decision} onResolved={onResolved} />)
      expect(screen.getByText('Approve proposal')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /approve/i }))
      expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }))
    })

    it('shows a toast on failed reject', async () => {
      installMockFetch({ 'POST /api/decisions/dec_1/reject': () => { throw new Error('boom') } })
      const { ToastProvider } = await import('./Toast')
      render(<ToastProvider><DecisionCard decision={fixtures.decision} onResolved={() => {}} /></ToastProvider>)
      await userEvent.click(screen.getByRole('button', { name: /reject/i }))
      expect(await screen.findByText(/failed to reject/i)).toBeInTheDocument()
    })
  })
  ```
  `src/panels/DecisionsPanel.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { installMockFetch } from '../../tests/mockServer'
  import { DecisionsPanel } from './DecisionsPanel'

  describe('DecisionsPanel', () => {
    it('lists pending decisions', async () => {
      installMockFetch()
      render(<DecisionsPanel />)
      expect(await screen.findByRole('heading', { name: 'Decisions' })).toBeInTheDocument()
      expect(await screen.findByText('Approve proposal')).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL.

- [ ] **Step 2: Implement**
  `src/components/DecisionCard.tsx`:
  ```tsx
  import { useState } from 'react'
  import ReactMarkdown from 'react-markdown'
  import type { Decision } from '@agentos/shared'
  import { ApiClient } from '../api/client'
  import { useToast } from './Toast'

  const client = new ApiClient()

  export function DecisionCard({ decision, onResolved }: { decision: Decision; onResolved: (d: Decision) => void }) {
    const [busy, setBusy] = useState(false)
    const { push } = useToast()

    async function resolve(kind: 'approve' | 'reject') {
      setBusy(true)
      const optimistic: Decision = { ...decision, status: kind === 'approve' ? 'approved' : 'rejected' }
      onResolved(optimistic)
      try {
        const result = kind === 'approve' ? await client.approveDecision(decision.id) : await client.rejectDecision(decision.id)
        onResolved(result)
      } catch {
        onResolved(decision)
        push(`Failed to ${kind} "${decision.title}"`, 'error')
      } finally {
        setBusy(false)
      }
    }

    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 font-medium text-text">{decision.title}</div>
        <div className="prose prose-invert prose-sm max-w-none text-muted"><ReactMarkdown>{decision.body}</ReactMarkdown></div>
        {decision.status === 'pending' && (
          <div className="mt-3 flex gap-2">
            <button disabled={busy} onClick={() => resolve('approve')} className="rounded border border-accent px-3 py-1 text-xs text-accent disabled:opacity-50">Approve</button>
            <button disabled={busy} onClick={() => resolve('reject')} className="rounded border border-danger px-3 py-1 text-xs text-danger disabled:opacity-50">Reject</button>
          </div>
        )}
      </div>
    )
  }
  ```
  `src/panels/DecisionsPanel.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import type { Decision } from '@agentos/shared'
  import { ApiClient, ApiError } from '../api/client'
  import { DecisionCard } from '../components/DecisionCard'
  import { Spinner } from '../components/Spinner'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'

  const client = new ApiClient()

  export function DecisionsPanel() {
    const [tab, setTab] = useState<'pending' | 'history'>('pending')
    const [decisions, setDecisions] = useState<Decision[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback((t: 'pending' | 'history') => {
      setError(null)
      const status = t === 'pending' ? 'pending' : undefined
      client.listDecisions(status).then((d) => setDecisions(t === 'history' ? d.filter((x) => x.status !== 'pending') : d))
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load decisions'))
    }, [])

    useEffect(() => { load(tab) }, [load, tab])

    function onResolved(updated: Decision) {
      setDecisions((prev) => (prev ?? []).map((d) => (d.id === updated.id ? updated : d)).filter((d) => tab === 'history' || d.status === 'pending'))
    }

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Decisions</h2>
        <div className="mb-4 flex gap-2 text-sm">
          <button onClick={() => setTab('pending')} className={tab === 'pending' ? 'text-accent' : 'text-muted'}>Pending</button>
          <button onClick={() => setTab('history')} className={tab === 'history' ? 'text-accent' : 'text-muted'}>History</button>
        </div>
        {error && <ErrorState message={error} onRetry={() => load(tab)} />}
        {!error && decisions === null && <Spinner label="Loading decisions…" />}
        {!error && decisions !== null && decisions.length === 0 && (
          <EmptyState title={tab === 'pending' ? 'Nothing pending' : 'No history yet'} body={tab === 'pending' ? 'Approvals requested by agents will show up here.' : 'Resolved decisions will show up here.'} />
        )}
        {!error && decisions !== null && decisions.length > 0 && (
          <div className="flex flex-col gap-3">
            {decisions.map((d) => <DecisionCard key={d.id} decision={d} onResolved={onResolved} />)}
          </div>
        )}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/DecisionsPanel.tsx packages/dashboard/src/panels/DecisionsPanel.test.tsx packages/dashboard/src/components/DecisionCard.tsx packages/dashboard/src/components/DecisionCard.test.tsx
  git commit -m "feat(dashboard): implement DecisionsPanel with optimistic approve/reject and history tab

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 9: WikiPanel + WikiPage

**Files:** `src/panels/WikiPanel.tsx`, `src/components/WikiPage.tsx`, tests for both

**Interfaces:** Consumes: `GET /api/wiki/index`, `GET /api/wiki/page?path=`, `GET /api/wiki/log?limit=`. Produces: `export function WikiPage(props: { content: string; onNavigate: (path: string) => void }): JSX.Element` (rewrites `[[path]]` to in-app links before markdown render), `export function WikiPanel(): JSX.Element` with Index/Log tabs.

- [ ] **Step 1: Failing tests**
  `src/components/WikiPage.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { WikiPage } from './WikiPage'

  describe('WikiPage', () => {
    it('turns [[Wikilinks]] into clickable in-app links', async () => {
      const onNavigate = vi.fn()
      render(<WikiPage content="See [[projects/techpulse]] for details." onNavigate={onNavigate} />)
      await userEvent.click(screen.getByRole('link', { name: 'projects/techpulse' }))
      expect(onNavigate).toHaveBeenCalledWith('projects/techpulse')
    })
  })
  ```
  `src/panels/WikiPanel.test.tsx`:
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { installMockFetch } from '../../tests/mockServer'
  import { WikiPanel } from './WikiPanel'

  describe('WikiPanel', () => {
    it('renders the index by default', async () => {
      installMockFetch()
      render(<WikiPanel />)
      expect(await screen.findByRole('heading', { name: 'Index' })).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL.

- [ ] **Step 2: Implement**
  `src/components/WikiPage.tsx`:
  ```tsx
  import ReactMarkdown from 'react-markdown'
  import type { Components } from 'react-markdown'

  const WIKILINK = /\[\[([^\]]+)\]\]/g

  function toMarkdownLinks(content: string): string {
    return content.replace(WIKILINK, (_m, path) => `[${path}](wiki:${path})`)
  }

  export function WikiPage({ content, onNavigate }: { content: string; onNavigate: (path: string) => void }) {
    const components: Components = {
      a: ({ href, children }) => {
        if (href?.startsWith('wiki:')) {
          const path = href.slice('wiki:'.length)
          return (
            <a href={`#${path}`} onClick={(e) => { e.preventDefault(); onNavigate(path) }} className="text-accent underline">
              {children}
            </a>
          )
        }
        return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">{children}</a>
      }
    }
    return <div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown components={components}>{toMarkdownLinks(content)}</ReactMarkdown></div>
  }
  ```
  `src/panels/WikiPanel.tsx`:
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import { ApiClient, ApiError } from '../api/client'
  import { WikiPage } from '../components/WikiPage'
  import { Spinner } from '../components/Spinner'
  import { ErrorState } from '../components/ErrorState'

  const client = new ApiClient()

  export function WikiPanel() {
    const [tab, setTab] = useState<'browse' | 'log'>('browse')
    const [path, setPath] = useState<string | null>(null)
    const [content, setContent] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback((t: 'browse' | 'log', p: string | null) => {
      setError(null)
      setContent(null)
      const req = t === 'log' ? client.wikiLog(50) : p ? client.wikiPage(p) : client.wikiIndex()
      req.then((r) => setContent(r.content)).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load wiki'))
    }, [])

    useEffect(() => { load(tab, path) }, [load, tab, path])

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Wiki</h2>
        <div className="mb-4 flex gap-2 text-sm">
          <button onClick={() => { setTab('browse'); setPath(null) }} className={tab === 'browse' ? 'text-accent' : 'text-muted'}>Index</button>
          <button onClick={() => setTab('log')} className={tab === 'log' ? 'text-accent' : 'text-muted'}>Log</button>
        </div>
        {error && <ErrorState message={error} onRetry={() => load(tab, path)} />}
        {!error && content === null && <Spinner label="Loading wiki…" />}
        {!error && content !== null && <WikiPage content={content} onNavigate={(p) => { setTab('browse'); setPath(p) }} />}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/WikiPanel.tsx packages/dashboard/src/panels/WikiPanel.test.tsx packages/dashboard/src/components/WikiPage.tsx packages/dashboard/src/components/WikiPage.test.tsx
  git commit -m "feat(dashboard): implement WikiPanel with wikilink navigation and log tab

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 10: SkillsPanel (+ Contract addition: `GET /api/skills/:name`)

**Files:** `src/panels/SkillsPanel.tsx`, `src/panels/SkillsPanel.test.tsx`

**Interfaces:** Consumes: `GET /api/skills` → `SkillMeta[]`, `GET /api/skills/:name` → `SkillDetail` (Contract addition #1, see below). Produces: `export function SkillsPanel(): JSX.Element` — list with lastScore, click to expand a learnings excerpt.

- [ ] **Step 1: Failing test**
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch, fixtures } from '../../tests/mockServer'
  import { SkillsPanel } from './SkillsPanel'

  describe('SkillsPanel', () => {
    it('lists skills and expands learnings excerpt on click', async () => {
      installMockFetch()
      render(<SkillsPanel />)
      const row = await screen.findByText(fixtures.skill.name)
      expect(screen.getByText('0.90')).toBeInTheDocument()
      await userEvent.click(row)
      expect(await screen.findByText(/# learnings/)).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL.

- [ ] **Step 2: Implement**
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import type { SkillMeta } from '@agentos/shared'
  import { ApiClient, ApiError, type SkillDetail } from '../api/client'
  import { Spinner } from '../components/Spinner'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'

  const client = new ApiClient()

  export function SkillsPanel() {
    const [skills, setSkills] = useState<SkillMeta[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [expanded, setExpanded] = useState<string | null>(null)
    const [detail, setDetail] = useState<SkillDetail | null>(null)

    const load = useCallback(() => {
      setError(null)
      client.listSkills().then(setSkills).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load skills'))
    }, [])

    useEffect(() => { load() }, [load])

    async function toggle(name: string) {
      if (expanded === name) { setExpanded(null); return }
      setExpanded(name)
      setDetail(null)
      const d = await client.getSkill(name)
      setDetail(d)
    }

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Skills</h2>
        {error && <ErrorState message={error} onRetry={load} />}
        {!error && skills === null && <Spinner label="Loading skills…" />}
        {!error && skills !== null && skills.length === 0 && <EmptyState title="No skills yet" body="Skills live under os/skills/<name>/skill.md." />}
        {!error && skills !== null && skills.length > 0 && (
          <div className="flex flex-col gap-2">
            {skills.map((s) => (
              <div key={s.name} className="rounded-lg border border-border bg-surface p-3">
                <button onClick={() => toggle(s.name)} className="flex w-full items-center justify-between text-left">
                  <span className="font-mono text-sm">{s.name}</span>
                  <span className="text-xs text-muted">{s.lastScore !== undefined ? s.lastScore.toFixed(2) : '—'}</span>
                </button>
                {expanded === s.name && (
                  <div className="mt-2 rounded border border-border bg-background p-2 text-xs text-muted">
                    {detail ? <pre className="whitespace-pre-wrap">{detail.learningsMd}</pre> : <Spinner label="Loading learnings…" />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/SkillsPanel.tsx packages/dashboard/src/panels/SkillsPanel.test.tsx
  git commit -m "feat(dashboard): implement SkillsPanel with expandable learnings via GET /api/skills/:name

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 11: RoutinesPanel

**Files:** `src/panels/RoutinesPanel.tsx`, `src/panels/RoutinesPanel.test.tsx`

**Interfaces:** Consumes: `GET /api/routines` → `RoutineListItem[]`, `POST /api/routines/:name/run`, `POST /api/routines/:name/enable|disable`. Produces: `export function RoutinesPanel(): JSX.Element`.

- [ ] **Step 1: Failing test**
  ```tsx
  import { describe, it, expect, vi } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import userEvent from '@testing-library/user-event'
  import { installMockFetch } from '../../tests/mockServer'
  import { RoutinesPanel } from './RoutinesPanel'

  describe('RoutinesPanel', () => {
    it('runs a routine now', async () => {
      const run = vi.fn(() => ({ runId: 'run_9' }))
      installMockFetch({ 'POST /api/routines/heartbeat/run': run })
      render(<RoutinesPanel />)
      await userEvent.click(await screen.findByRole('button', { name: /run now/i }))
      expect(run).toHaveBeenCalled()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL.

- [ ] **Step 2: Implement**
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import { ApiClient, ApiError, type RoutineListItem } from '../api/client'
  import { StatusBadge } from '../components/StatusBadge'
  import { Spinner } from '../components/Spinner'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'
  import { useToast } from '../components/Toast'

  const client = new ApiClient()

  export function RoutinesPanel() {
    const [items, setItems] = useState<RoutineListItem[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const { push } = useToast()

    const load = useCallback(() => {
      setError(null)
      client.listRoutines().then(setItems).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load routines'))
    }, [])

    useEffect(() => { load() }, [load])

    async function runNow(name: string) {
      try { await client.runRoutine(name); push(`Queued ${name}`) } catch { push(`Failed to run ${name}`, 'error') }
    }
    async function toggle(name: string, enabled: boolean) {
      try { enabled ? await client.disableRoutine(name) : await client.enableRoutine(name); load() }
      catch { push(`Failed to toggle ${name}`, 'error') }
    }

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Routines</h2>
        {error && <ErrorState message={error} onRetry={load} />}
        {!error && items === null && <Spinner label="Loading routines…" />}
        {!error && items !== null && items.length === 0 && <EmptyState title="No routines configured" body="Add entries to os/routines.yaml." />}
        {!error && items !== null && items.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b border-border text-left text-muted"><th className="py-2">Name</th><th>Trigger</th><th>Next run</th><th>Last run</th><th /></tr></thead>
            <tbody>
              {items.map(({ routine, nextRun, lastRun }) => (
                <tr key={routine.name} className="border-b border-border">
                  <td className="py-2 font-mono">{routine.name}</td>
                  <td className="text-muted">{routine.every ?? routine.cron ?? (routine.on ? routine.on.join(',') : 'manual')}</td>
                  <td className="text-muted">{nextRun ?? '—'}</td>
                  <td>{lastRun ? <StatusBadge status={lastRun.status} /> : <span className="text-muted">—</span>}</td>
                  <td className="flex gap-2 py-2">
                    <button onClick={() => runNow(routine.name)} className="rounded border border-accent px-2 py-1 text-xs text-accent">Run now</button>
                    <button onClick={() => toggle(routine.name, routine.enabled !== false)} className="rounded border border-border px-2 py-1 text-xs text-muted">
                      {routine.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/RoutinesPanel.tsx packages/dashboard/src/panels/RoutinesPanel.test.tsx
  git commit -m "feat(dashboard): implement RoutinesPanel with run-now/enable/disable controls

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 12: CostsPanel — hand-rolled SVG bar chart

**Files:** `src/panels/CostsPanel.tsx`, `src/panels/CostsPanel.test.tsx`

**Interfaces:** Consumes: `GET /api/costs?days=14` → `CostEntry[]`. Produces: `export function CostsPanel(): JSX.Element` grouping by day, one SVG `<rect>` per agent-day.

- [ ] **Step 1: Failing test**
  ```tsx
  import { describe, it, expect } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { installMockFetch } from '../../tests/mockServer'
  import { CostsPanel } from './CostsPanel'

  describe('CostsPanel', () => {
    it('renders an svg bar per day', async () => {
      installMockFetch({ 'GET /api/costs': () => [{ day: '2026-09-07', agent: 'ops', costUsd: 0.1 }, { day: '2026-09-08', agent: 'ops', costUsd: 0.4 }] })
      render(<CostsPanel />)
      expect(await screen.findByTestId('cost-bar-2026-09-08')).toBeInTheDocument()
    })
  })
  ```
  Run: `pnpm --filter @agentos/dashboard test` — FAIL.

- [ ] **Step 2: Implement**
  ```tsx
  import { useEffect, useState, useCallback } from 'react'
  import { ApiClient, ApiError, type CostEntry } from '../api/client'
  import { Spinner } from '../components/Spinner'
  import { EmptyState } from '../components/EmptyState'
  import { ErrorState } from '../components/ErrorState'

  const client = new ApiClient()

  export function CostsPanel() {
    const [entries, setEntries] = useState<CostEntry[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(() => {
      setError(null)
      client.costs(14).then(setEntries).catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load costs'))
    }, [])

    useEffect(() => { load() }, [load])

    if (error) return <section><h2 className="mb-4 text-lg font-medium">Costs</h2><ErrorState message={error} onRetry={load} /></section>
    if (entries === null) return <section><h2 className="mb-4 text-lg font-medium">Costs</h2><Spinner label="Loading costs…" /></section>
    if (entries.length === 0) return <section><h2 className="mb-4 text-lg font-medium">Costs</h2><EmptyState title="No spend yet" body="Costs appear after the first run completes." /></section>

    const byDay = new Map<string, number>()
    for (const e of entries) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.costUsd)
    const days = [...byDay.keys()].sort()
    const max = Math.max(...byDay.values(), 0.01)
    const width = 24, gap = 12, height = 140

    return (
      <section>
        <h2 className="mb-4 text-lg font-medium">Costs</h2>
        <svg width={days.length * (width + gap)} height={height + 24} role="img" aria-label="Daily cost in USD">
          {days.map((day, i) => {
            const value = byDay.get(day) ?? 0
            const barHeight = Math.max(2, (value / max) * height)
            return (
              <g key={day} transform={`translate(${i * (width + gap)}, 0)`}>
                <rect data-testid={`cost-bar-${day}`} x={0} y={height - barHeight} width={width} height={barHeight} fill="var(--color-accent)" rx={2} />
                <text x={width / 2} y={height + 16} textAnchor="middle" fontSize={10} fill="var(--color-muted)">{day.slice(5)}</text>
              </g>
            )
          })}
        </svg>
      </section>
    )
  }
  ```
  Run: `pnpm --filter @agentos/dashboard test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/dashboard/src/panels/CostsPanel.tsx packages/dashboard/src/panels/CostsPanel.test.tsx
  git commit -m "feat(dashboard): implement CostsPanel with hand-rolled SVG bar chart

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 13: Kernel static serving (Contract addition #2) + build wiring

**Files:** `packages/kernel/src/api/server.ts` (modified)

**Interfaces:** Produces: kernel registers `@fastify/static` at prefix `/` serving `packages/dashboard/dist`, so `GET /` and any non-`/api`/`/ws` path returns `index.html` (SPA fallback) once built.

- [ ] **Step 1: Failing test** (added to kernel's existing `api/server.test.ts`; file assumed to exist from M1 — this appends one case)
  ```ts
  it('serves the built dashboard at /', async () => {
    // uses the describe-level tmpDir/osRoot/log/fakeClaudeBin from M1's api/server.test.ts
    const cfg = loadKernelConfig(osRoot, { claudeBin: fakeClaudeBin, runtimeDir: path.join(tmpDir, '.agentos'), dbPath: path.join(tmpDir, '.agentos', 'agentos.db') })
    const pm = new ProcessManager(cfg, log)
    const app = buildServer({ cfg, log, pm } as unknown as Kernel)
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
  })
  ```
  Run: `pnpm --filter @agentos/kernel test` — FAIL (no static plugin registered, `/` 404s).

- [ ] **Step 2: Implement** — add near the top-level Fastify app setup in `packages/kernel/src/api/server.ts`:
  ```ts
  import fastifyStatic from '@fastify/static'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'

  const dashboardDist = path.resolve(fileURLToPath(import.meta.url), '../../../../dashboard/dist')

  app.register(fastifyStatic, {
    root: dashboardDist,
    prefix: '/',
    wildcard: false
  })

  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/ws')) {
      reply.code(404).send({ error: 'not found' })
      return
    }
    reply.sendFile('index.html', dashboardDist)
  })
  ```
  Run: `pnpm --filter @agentos/dashboard build && pnpm --filter @agentos/kernel test` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add packages/kernel/src/api/server.ts
  git commit -m "feat(kernel): serve built dashboard via @fastify/static with SPA fallback

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

### Task 14: `tools/seed-decision.ts` + Playwright smoke

**Files:** `tools/seed-decision.ts`, `packages/dashboard/playwright.config.ts`, `packages/dashboard/e2e/dashboard.spec.ts`

**Interfaces:** Consumes: `EventLog.createDecision` (contract §4). Produces: `seedDecision(dbPath: string): Decision` CLI-invokable script; Playwright spec asserting all 7 panels render and a seeded decision can be approved end-to-end.

- [ ] **Step 1: Write the seed script and e2e spec (spec runs against a real kernel + fake claude, so this step is both "test" and "fixture" — write both, then run)**
  `tools/seed-decision.ts`:
  ```ts
  #!/usr/bin/env node
  import { EventLog } from '@agentos/kernel/log/eventLog'

  export function seedDecision(dbPath: string) {
    const log = new EventLog(dbPath)
    const decision = log.createDecision({
      title: 'Approve techpulse proposal 001-add-digest',
      body: '# Proposal\nAdd a personalized company digest.\n\nApprove to merge to `main`.',
      adapter: 'techpulse-coo',
      ref: '001-add-digest.md'
    })
    log.close()
    return decision
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
    const dbPath = process.argv[2]
    if (!dbPath) { console.error('usage: seed-decision.ts <dbPath>'); process.exit(1) }
    const decision = seedDecision(dbPath)
    console.log(JSON.stringify(decision))
  }
  ```
  `packages/dashboard/playwright.config.ts`:
  ```ts
  import { defineConfig } from '@playwright/test'

  export default defineConfig({
    testDir: 'e2e',
    timeout: 30_000,
    use: { baseURL: 'http://127.0.0.1:4545' },
    webServer: {
      command: 'node ../../tools/e2e-kernel.mjs',
      url: 'http://127.0.0.1:4545/api/health',
      timeout: 20_000,
      reuseExistingServer: false
    }
  })
  ```
  `packages/dashboard/e2e/dashboard.spec.ts`:
  ```ts
  import { test, expect } from '@playwright/test'

  const PANELS = ['Agents', 'Runs', 'Decisions', 'Wiki', 'Skills', 'Routines', 'Costs']

  test('dashboard renders every panel and approves a seeded decision', async ({ page }) => {
    await page.goto('/')
    for (const panel of PANELS) {
      await page.getByRole('button', { name: panel, exact: true }).click()
      await expect(page.getByRole('heading', { name: panel })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Decisions', exact: true }).click()
    await expect(page.getByText('Approve techpulse proposal 001-add-digest')).toBeVisible()
    await page.getByRole('button', { name: /approve/i }).click()
    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByText('Approve techpulse proposal 001-add-digest')).toBeVisible()
  })
  ```
  Run: `pnpm --filter @agentos/dashboard e2e` — expect FAIL: `tools/e2e-kernel.mjs` (a small helper that boots `createKernel` with `AGENTOS_CLAUDE_BIN` pointed at `tools/fake-claude/bin.js`, an empty `os/` fixture, and calls `seedDecision` before `start()`) does not exist yet.

- [ ] **Step 2: Add the missing e2e harness**
  `tools/e2e-kernel.mjs`:
  ```js
  import { createKernel, loadKernelConfig } from '@agentos/kernel'
  import { fileURLToPath } from 'node:url'
  import path from 'node:path'
  import { seedDecision } from './seed-decision.ts'

  const osRoot = path.resolve(fileURLToPath(import.meta.url), '../fixtures/e2e-os')
  const cfg = loadKernelConfig(osRoot, {
    port: 4545,
    claudeBin: path.resolve(fileURLToPath(import.meta.url), '../fake-claude/bin.js')
  })
  const kernel = createKernel(cfg)
  await kernel.start()
  seedDecision(cfg.dbPath)
  ```
  (`tools/fixtures/e2e-os/` is a minimal valid `os/` per contract §2, provided by M1's bootstrap fixtures — reused here, not recreated.)
  Run: `pnpm --filter @agentos/dashboard build && pnpm --filter @agentos/dashboard e2e` — PASS.

- [ ] **Step 3: Commit**
  ```
  git add tools/seed-decision.ts tools/e2e-kernel.mjs packages/dashboard/playwright.config.ts packages/dashboard/e2e/dashboard.spec.ts
  git commit -m "test(dashboard): add Playwright smoke covering all panels and decision approval

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

## Self-review

- **Spec §6 coverage:** all seven panels (Agents, Runs, Decisions, Wiki, Skills, Routines, Costs) implemented with loading/empty/error states; live stream + tool calls + cost in RunStream; Approve/Reject with history in Decisions; wikilinked page viewer in Wiki; dashboard served by the kernel on `127.0.0.1:4545` (Task 13); WebSocket-driven live updates via `useEvents`.
- **Placeholder scan:** no `TBD`/`TODO`/"style it nicely" strings; every step's code is complete and references only components defined earlier in this plan or in the contract.
- **Type consistency vs contract:** `Run`, `Event`, `Decision`, `RunStatus`, `EventType`, `DecisionStatus`, `RoutineConfig`, `SkillMeta`, `EvalCriteria`, `ClaudeStreamMessage` are imported from `@agentos/shared` per contract §3, never redefined; response-only shapes not in §3 (`AgentStatus`, `RoutineListItem`, `CostEntry`, `SkillDetail`) are declared locally in `api/client.ts` and match the exact JSON shapes in contract §7 and the additions below.

## Contract additions

1. **`GET /api/skills/:name`** → `{ skillMd: string; learningsMd: string; eval: EvalCriteria; lastOutputMd: string }`. Reads `os/skills/<name>/{skill.md, learnings.md, eval.json, last-output.md}` (paths per contract §2); 404 with `{ error: string }` if the skill directory doesn't exist. Owned by kernel `api/server.ts`, no new deps.
2. **Kernel static serving**: `packages/kernel/src/api/server.ts` registers `@fastify/static@^8` (already pinned in contract §0, no version change) at prefix `/` rooted at `packages/dashboard/dist`, with a not-found handler that falls back to `index.html` for any non-`/api`,`/ws` path (SPA routing) and preserves JSON 404s under `/api`. `pnpm --filter @agentos/dashboard build` must run before `agentos up` serves a non-stale UI; CI's `pnpm -r build` covers this.

New dev/runtime deps (all new to `packages/dashboard`, none change the pinned majors in contract §0): `react-markdown@^9.0.1`, `@tailwindcss/vite@^4.0.0`, `@vitejs/plugin-react@^4.3.4`, `vitest@^2.1.8`, `@testing-library/react@^16.1.0`, `@testing-library/jest-dom@^6.6.3`, `@testing-library/user-event@^14.5.2`, `jsdom@^25.0.1`, `@playwright/test@^1.49.1`.
