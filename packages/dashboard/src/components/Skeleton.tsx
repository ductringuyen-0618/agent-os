export function Skeleton({ className = 'h-4 w-24' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />
}

/** A few placeholder rows while a list loads. Announced once, not per row. */
export function SkeletonRows({
  rows = 3,
  label = 'Loading…',
}: { rows?: number; label?: string }) {
  return (
    <output aria-label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
          key={i}
          className="flex items-center gap-3"
        >
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <Skeleton className={`h-3.5 ${i % 2 ? 'w-2/5' : 'w-3/5'}`} />
          <Skeleton className="ml-auto h-3 w-14" />
        </div>
      ))}
    </output>
  )
}
