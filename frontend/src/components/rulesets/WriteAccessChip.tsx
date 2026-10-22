import { Eye, FileStack, PencilLine, type LucideIcon } from 'lucide-react'
import type { WriteAccess } from '@/api/types'
import { cn } from '@/lib/utils'

/** Each level's icon and colour: `propose` in the amber of working in a changeset. */
const LEVEL_LOOK: Record<WriteAccess, { icon: LucideIcon; chip: string; text: string }> = {
  none: { icon: Eye, chip: 'border-border bg-muted', text: 'text-muted-foreground' },
  propose: { icon: FileStack, chip: 'border-(--tc-amber-border) bg-(--tc-amber-bg)', text: 'text-(--tc-amber)' },
  full: { icon: PencilLine, chip: 'border-border bg-background', text: 'text-foreground' },
}

/** A write access level as a chip: icon and the level's own word. */
export function WriteAccessChip({ level, className }: { level: WriteAccess; className?: string }) {
  const { icon: Icon, chip, text } = LEVEL_LOOK[level]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        chip,
        text,
        className,
      )}
    >
      <Icon className="size-3" />
      {level}
    </span>
  )
}

/** A write access level's icon in its colour: the Connect panel's write access line. */
export function WriteAccessIcon({ level, className }: { level: WriteAccess; className?: string }) {
  const { icon: Icon, text } = LEVEL_LOOK[level]
  return <Icon className={cn('size-3', text, className)} />
}
