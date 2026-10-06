import { useDisplayLabel, useMatchedVia } from '@/api/hooks'
import type { EntityInstance, Matched, SearchMatch } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'

/**
 * The rank is conveyed by list position only — no scores. A hit found by a
 * relation or passage entry gets one muted "matched via" line; servers
 * without `matched` keep the per-document `in <property>` badges.
 */
export function EntitySearchRow({
  entity,
  matches = [],
  matched,
  typeName,
}: {
  entity: EntityInstance
  matches?: SearchMatch[]
  matched?: Matched
  typeName: string
}) {
  const displayLabel = useDisplayLabel()
  const matchedVia = useMatchedVia()
  const via = matchedVia(matched)
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <TypeChip typeKey={entity._entityTypeKey} displayName={typeName} size="sm" />
        <span className="min-w-0 flex-1 truncate">{displayLabel(entity)}</span>
        {matched === undefined &&
          matches
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
      {via !== null && (
        <span className="truncate text-[11px] text-muted-foreground">{via}</span>
      )}
    </span>
  )
}
