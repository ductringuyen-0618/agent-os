import { type ReactNode, useEffect, useRef } from 'react'

/**
 * A small modal that says exactly what will happen before an irreversible
 * action. The confirm button carries the same verb as the toast that follows.
 */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  tone = 'accent',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  tone?: 'accent' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    confirmRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="absolute inset-0 animate-fade-in cursor-default bg-background/70 backdrop-blur-[2px]"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="card relative w-full max-w-md animate-fade-in p-5 shadow-2xl"
      >
        <h3 className="mb-2 text-base font-medium text-text">{title}</h3>
        <div className="text-sm text-muted">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn btn-quiet"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-accent'}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
