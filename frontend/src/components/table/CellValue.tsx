import { Check, Minus } from 'lucide-react'
import type { DataType, JsonValue } from '@/api/types'
import { DocumentBadge } from '@/components/DocumentBadge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isDocumentStub } from '@/lib/documents'
import { humanDate, humanDateTime } from './format'

const TRUNCATE_AT = 80

/** Size badge, click-to-read when the caller can resolve the document. */
function DocumentCell({ length, onOpen }: { length: number; onOpen?: () => void }) {
  if (onOpen === undefined) return <DocumentBadge length={length} />
  return (
    <button
      type="button"
      onClick={(e) => {
        // The row itself navigates on click — reading a document must not.
        e.stopPropagation()
        onOpen()
      }}
      className="rounded focus-visible:outline-2 focus-visible:outline-ring/60"
      aria-label="Read document"
    >
      <DocumentBadge
        length={length}
        className="cursor-pointer transition-colors hover:bg-muted hover:text-foreground"
      />
    </button>
  )
}

/**
 * Renders one table cell by dataType: booleans as check/dash, dates human,
 * numbers tabular, long strings truncated with a tooltip. Text stays
 * selectable — row navigation must not swallow text selection.
 */
export function CellValue({
  value,
  dataType,
  onOpenDocument,
}: {
  value: JsonValue | undefined
  dataType: DataType
  /** When set, document badges become click-to-read (opens a viewer). */
  onOpenDocument?: () => void
}) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground/50">—</span>
  }

  // Document properties arrive as stubs — a compact size badge, never content.
  // Even if a raw value slips through (explicit `fields` projection), tables
  // still only show the size.
  if (isDocumentStub(value)) {
    return <DocumentCell length={value.length} onOpen={onOpenDocument} />
  }
  if (dataType === 'document' && typeof value === 'string') {
    return <DocumentCell length={value.length} onOpen={onOpenDocument} />
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
