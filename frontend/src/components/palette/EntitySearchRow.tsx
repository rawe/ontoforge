import type { EntityInstance, SearchMatch } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { displayLabel } from '@/lib/displayLabel'

/** The rank is conveyed by list position only. */
export function EntitySearchRow({
  entity,
  matches = [],
  typeName,
}: {
  entity: EntityInstance
  matches?: SearchMatch[]
  typeName: string
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <TypeChip typeKey={entity._entityTypeKey} displayName={typeName} size="sm" />
      <span className="min-w-0 flex-1 truncate">{displayLabel(entity)}</span>
      {matches
        .filter((m) => m.kind === 'document')
        .map((match) => (
          <span
            key={match.propertyKey}
            className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            in {match.propertyKey}
          </span>
        ))}
    </span>
  )
}
