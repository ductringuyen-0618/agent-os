export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <output
      aria-label={label}
      className="flex items-center gap-2 text-sm text-muted"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label}
    </output>
  );
}
