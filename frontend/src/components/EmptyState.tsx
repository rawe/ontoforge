import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/**
 * Purposeful empty state: icon in a soft tile, one-line title, one sentence,
 * optional primary action. Used for placeholders, zero-data states and
 * feature-off explanations.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-xl border bg-muted/40">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description !== undefined && (
          <p className="mx-auto max-w-sm text-[13px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  )
}
