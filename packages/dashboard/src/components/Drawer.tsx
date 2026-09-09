import { type ReactNode, useEffect, useRef } from 'react'
import { Icon } from './Icon'

/** Right-hand panel for detail that should not push the page around. */
export function Drawer({
  open,
  title,
  onClose,
  children,
  widthClass = 'w-[min(720px,92vw)]',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  widthClass?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in cursor-default bg-background/60 backdrop-blur-[2px]"
      />
      {/* biome-ignore lint/a11y/useSemanticElements: a native <dialog> needs showModal(), which fights the slide-in and jsdom */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex h-full ${widthClass} animate-slide-in flex-col border-l border-border bg-surface shadow-2xl outline-none`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="truncate font-medium text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded p-1 text-muted hover:bg-raised hover:text-text"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  )
}
