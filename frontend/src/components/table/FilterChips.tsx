import { X } from 'lucide-react'
import type { SchemaProperty } from '@/api/types'
import { Button } from '@/components/ui/button'
import { filterLabel, type FilterCondition } from './filters'

/** Applied filter conditions as removable chips + a clear-all action. */
export function FilterChips({
  filters,
  properties,
  onRemove,
  onClearAll,
}: {
  filters: readonly FilterCondition[]
  properties: readonly SchemaProperty[]
  onRemove: (id: string) => void
  onClearAll: () => void
}) {
  if (filters.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
        >
          {filterLabel(f, properties)}
          <button
            type="button"
            aria-label="Remove filter"
            className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => onRemove(f.id)}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={onClearAll}
        >
          Clear all
        </Button>
      )}
    </div>
  )
}
