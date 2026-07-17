import { cn } from '@/lib/utils'
import { getTypeColor } from '@/lib/typeColors'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface TypeChipProps {
  typeKey: string
  displayName?: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * The app-wide entity-type chip: colored dot + display name, tinted per the
 * type's deterministic hue. The mono type key is shown in a tooltip.
 */
export function TypeChip({ typeKey, displayName, size = 'md', className }: TypeChipProps) {
  const color = getTypeColor(typeKey)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex w-fit shrink-0 items-center rounded-md border font-medium',
            size === 'sm' ? 'gap-1 px-1.5 py-px text-[11px]' : 'gap-1.5 px-2 py-0.5 text-xs',
            color.chip,
            className,
          )}
        >
          <span
            className={cn(
              'rounded-full',
              size === 'sm' ? 'size-1.5' : 'size-2',
              color.dot,
            )}
            aria-hidden
          />
          {displayName ?? typeKey}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono">{typeKey}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/** Bare colored dot for a type — sidebar entries, canvas legends, etc. */
export function TypeDot({ typeKey, className }: { typeKey: string; className?: string }) {
  return (
    <span
      className={cn('size-2 shrink-0 rounded-full', getTypeColor(typeKey).dot, className)}
      aria-hidden
    />
  )
}
