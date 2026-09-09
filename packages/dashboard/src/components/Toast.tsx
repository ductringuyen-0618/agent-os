import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react'

interface ToastMsg {
  id: number
  text: string
  kind: 'info' | 'error'
}
interface ToastCtx {
  push: (text: string, kind?: 'info' | 'error') => void
}

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
          <div
            key={m.id}
            className={`rounded border px-3 py-2 text-sm shadow-lg ${m.kind === 'error' ? 'border-danger text-danger bg-surface' : 'border-border text-text bg-surface'}`}
          >
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
