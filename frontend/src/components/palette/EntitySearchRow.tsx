import { useDisplayLabel, useMatchedVia } from '@/api/hooks'
import { IdentityText } from '@/components/IdentityText'
import { TypeChip } from '@/components/TypeChip'
import { identityText, referenceLabel } from '@/lib/displayLabel'
import type { EntitySearchResult } from './usePaletteSearch'

/**
 * The rank is conveyed by list position only — no scores. A ranked hit
 * found by a relation or passage entry gets one muted "matched via" line.
 * The entity's identity, when it has one, follows its label: a whole
 * entity's `_identity`, a ranked hit's identity properties in their text
 * form.
 */
export function EntitySearchRow({ result, typeName }: { result: EntitySearchResult; typeName: string }) {
  const displayLabel = useDisplayLabel()
  const matchedVia = useMatchedVia()
  const { entity } = result
  const ranked = 'match' in result
  const via = ranked ? matchedVia(result.match, entity._entityTypeKey) : null
  const identity = ranked
    ? result.entity.identity === undefined ? undefined : identityText(result.entity.identity)
    : result.entity._identity
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <TypeChip typeKey={entity._entityTypeKey} displayName={typeName} size="sm" />
        <span className="min-w-0 flex-1 truncate">
          {ranked ? referenceLabel(result.entity) : displayLabel(result.entity)}
        </span>
        <IdentityText identity={identity} />
      </span>
      {via !== null && (
        <span className="truncate text-[11px] text-muted-foreground">{via}</span>
      )}
    </span>
  )
}
