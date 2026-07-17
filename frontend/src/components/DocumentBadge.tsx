import { FileText } from 'lucide-react'
import { formatDocSize } from '@/lib/documents'
import { cn } from '@/lib/utils'

/**
 * Compact badge for a document property stub: document icon + human size.
 * Used wherever entity properties render in aggregate (tables, query results)
 * — document content itself is never shown inline.
 */
export function DocumentBadge({
  length,
  className,
}: {
  /** Character count of the full document (from the stub). */
  length: number
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground',
        className,
      )}
    >
      <FileText className="size-3 shrink-0" aria-hidden />
      {formatDocSize(length)}
    </span>
  )
}
