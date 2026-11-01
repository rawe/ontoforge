import { Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { FieldChange } from './draftFillModel'

/** A field value as the mark's hover shows it: a list joined, an empty text as such. */
function shownValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ')
  if (typeof value === 'string') return value === '' ? '(empty)' : value
  return String(value)
}

/**
 * "Changed by AI" beside a field the Studio helper filled and the person
 * has not edited since, with the value before and after on hover; nothing
 * for any other field. `show` writes a value for the hover.
 */
export function AiChangedMark({ field, change, show = shownValue }: {
  field: string
  change: FieldChange | undefined
  show?: (value: unknown) => string
}) {
  if (change === undefined) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-testid={`ai-mark-${field}`}
          className="inline-flex items-center gap-1 text-[11px] font-normal text-(--tc-violet)"
        >
          <Sparkles className="size-3" /> changed by AI
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="grid gap-1 text-xs">
          <span className="opacity-70">Before</span>
          <p className="line-clamp-4 whitespace-pre-wrap break-words">{show(change.before)}</p>
          <span className="opacity-70">After</span>
          <p className="line-clamp-4 whitespace-pre-wrap break-words">{show(change.after)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
