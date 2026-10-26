import { cn } from '@/lib/utils'

/**
 * An entity's identity as secondary text beside its label: muted and
 * monospaced, nothing when the entity has none (or the lens withholds it).
 */
export function IdentityText({ identity, className }: {
  identity: string | undefined | null
  className?: string
}) {
  if (identity === undefined || identity === null) return null
  return (
    <span
      className={cn('min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground', className)}
      title={`Identity: ${identity}`}
    >
      {identity}
    </span>
  )
}
