import { cn } from '@/lib/utils'

/** The OntoForge mark (same artwork as the favicon). */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/ontoforge-logo.svg"
      alt=""
      aria-hidden
      className={cn('size-5 select-none', className)}
      draggable={false}
    />
  )
}
