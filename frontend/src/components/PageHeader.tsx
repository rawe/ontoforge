import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned actions. */
  actions?: ReactNode
  /** Rendered inline after the title (badges, chips). */
  meta?: ReactNode
  className?: string
}

/** Standard page header: title row + optional description, hairline below. */
export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('border-b px-6 py-4', className)}>
      <div className="flex items-center gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {meta}
        {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {description !== undefined && (
        <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">{description}</p>
      )}
    </header>
  )
}
