import { Sparkles } from 'lucide-react'
import { ValueDiff } from '@/components/ValueDiff'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { toDiffValue, type DiffValue } from '@/lib/valueDiff'
import type { FieldChange } from './draftFillModel'

/**
 * "Changed by AI" beside a field the Studio helper filled and the person
 * has not edited since; a click opens what the AI changed, the field's
 * value before the fill against the AI's. Nothing for any other field.
 * `label` names the field; `value` turns a field value into one the diff
 * shows, when it is not a text or a list of texts as it stands.
 */
export function AiChangedMark({ field, label, change, value = toDiffValue }: {
  field: string
  label: string
  change: FieldChange | undefined
  value?: (fieldValue: unknown) => DiffValue
}) {
  if (change === undefined) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`ai-mark-${field}`}
          aria-label={`changed by AI: show the change to ${label}`}
          className="inline-flex items-center gap-1 rounded-sm text-[11px] font-normal text-(--tc-violet) hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:underline"
        >
          <Sparkles aria-hidden className="size-3" /> changed by AI
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`${label}: changed by AI`}
        data-testid={`ai-diff-${field}`}
        className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle>{label} · changed by AI</PopoverTitle>
          <PopoverDescription className="text-xs">Its value before the fill against the AI&rsquo;s.</PopoverDescription>
        </PopoverHeader>
        <ValueDiff before={value(change.before)} after={value(change.after)} />
      </PopoverContent>
    </Popover>
  )
}
