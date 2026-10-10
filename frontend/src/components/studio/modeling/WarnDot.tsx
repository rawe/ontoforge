import { cn } from '@/lib/utils'

/** Amber count of a type's lint issues (graph node, outline row); nothing at zero. */
export function WarnDot({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null
  return (
    <span
      className={cn(
        'flex h-4 shrink-0 items-center rounded-full bg-(--tc-amber-bg) px-1.5 text-[10px] font-medium text-(--tc-amber) tabular-nums',
        className,
      )}
      title={`${count} ${count === 1 ? 'issue' : 'issues'} — see Issues`}
    >
      {count}
    </span>
  )
}
