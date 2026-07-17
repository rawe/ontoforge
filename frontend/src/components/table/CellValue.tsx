import { Check, Minus } from 'lucide-react'
import type { DataType, JsonValue } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { humanDate, humanDateTime } from './format'

const TRUNCATE_AT = 80

/**
 * Renders one table cell by dataType: booleans as check/dash, dates human,
 * numbers tabular, long strings truncated with a tooltip. Text stays
 * selectable — row navigation must not swallow text selection.
 */
export function CellValue({
  value,
  dataType,
}: {
  value: JsonValue | undefined
  dataType: DataType
}) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground/50">—</span>
  }

  if (dataType === 'boolean') {
    return value === true ? (
      <Check className="size-3.5 text-muted-foreground" aria-label="true" />
    ) : (
      <Minus className="size-3.5 text-muted-foreground/50" aria-label="false" />
    )
  }

  if (dataType === 'integer' || dataType === 'float') {
    return <span className="font-mono text-xs tabular-nums">{String(value)}</span>
  }

  if (dataType === 'date' && typeof value === 'string') {
    return <span className="whitespace-nowrap">{humanDate(value)}</span>
  }

  if (dataType === 'datetime' && typeof value === 'string') {
    return <span className="whitespace-nowrap">{humanDateTime(value)}</span>
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= TRUNCATE_AT) return <span>{text}</span>

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block max-w-72 truncate">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-96">
        <p className="break-words">{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}
