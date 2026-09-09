export function ErrorState({
  message,
  onRetry,
}: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 p-6 text-center">
      <div className="text-sm text-danger">{message}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-border px-3 py-1 text-xs text-text hover:border-accent"
        >
          Retry
        </button>
      )}
    </div>
  )
}
