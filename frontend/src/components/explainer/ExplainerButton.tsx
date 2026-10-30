import type { ReactNode } from 'react'
import { CircleQuestionMark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Opens an explainer — `children`, its `ExplainerDialog`: a bare "?" named by `title`, such as
 * beside a page title, or with a `label` — "? How changesets work" — where a page or another
 * explainer points to it.
 */
export function ExplainerButton({ title, label, className, children }: { title: string; label?: string; className?: string; children: ReactNode }) {
  if (label) return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="sm" className={className}><CircleQuestionMark className="size-3.5" /> {label}</Button>
    </DialogTrigger>
    {children}
  </Dialog>
  return <Dialog>
    <Tooltip>
      <TooltipTrigger asChild>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={title}
            className={cn('text-muted-foreground hover:text-foreground', className)}>
            <CircleQuestionMark />
          </Button>
        </DialogTrigger>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
    {children}
  </Dialog>
}
