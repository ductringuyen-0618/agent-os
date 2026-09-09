export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-10 text-center">
      <div className="font-medium text-text">{title}</div>
      <div className="text-sm text-muted">{body}</div>
    </div>
  );
}
