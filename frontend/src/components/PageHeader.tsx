import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned actions. */
  actions?: ReactNode
  /** Rendered inline after the title (badges, chips). */
  meta?: ReactNode
  /** Rendered above the title row (an entity's path). */
  breadcrumb?: ReactNode
  className?: string
}

/** Standard page header: title row + optional description, hairline below. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('border-b px-6 py-4', className)}>
      {breadcrumb}
      {/* Wraps on narrow screens: the actions move below the title, still right-aligned. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {meta}
        {actions !== undefined && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </div>
      {description !== undefined && (
        <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">{description}</p>
      )}
    </header>
  )
}
