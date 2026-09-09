export function ErrorState({
  message,
  onRetry,
}: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-6 py-6 text-center">
      <div className="text-sm text-danger">{message}</div>
      <div className="text-xs text-muted">
        Check that the daemon is running and reachable, then try again.
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-quiet btn-sm"
        >
          Try again
        </button>
      )}
    </div>
  )
}
