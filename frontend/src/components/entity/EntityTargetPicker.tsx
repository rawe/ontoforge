import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useFeatures } from '@/api/hooks'
import type { EntityInstance, SchemaEntityType } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { EntitySearchRow } from '@/components/palette/EntitySearchRow'
import { useDebouncedValue, useEntitySearch } from '@/components/palette/usePaletteSearch'

interface EntityTargetPickerProps {
  ontologyKey: string
  lensKey: string
  /** The type to search; an empty query lists its first entities. */
  targetType: SchemaEntityType
  /** The search text; the caller holds it, so it survives a step away and back. */
  query: string
  onQueryChange: (query: string) => void
  onPick: (entity: EntityInstance) => void
  disabled?: boolean
  /** Focus the search on mount (default); off where another field comes first. */
  autoFocus?: boolean
  /** Items before the results, such as "New connected …". */
  leading?: ReactNode
  /** An extra line under each result, such as its path. */
  detail?: (entity: EntityInstance) => ReactNode
}

/**
 * Search one entity type through the lens and pick an entity: the add-relation
 * target picker, also used to choose where a ruleset's anchor points.
 */
export function EntityTargetPicker({
  ontologyKey,
  lensKey,
  targetType,
  query,
  onQueryChange,
  onPick,
  disabled = false,
  autoFocus = true,
  leading,
  detail,
}: EntityTargetPickerProps) {
  const { data: features } = useFeatures()
  const debouncedQuery = useDebouncedValue(query.trim(), 250)
  const search = useEntitySearch({
    ontologyKey,
    lensKey,
    q: debouncedQuery,
    typeKey: targetType.key,
    ranked: (features?.searchStrategies.length ?? 0) > 0,
    allTypeKeys: [],
    enabled: true,
  })

  return (
    // h-auto: Command's size-full would take the whole height of a stretched
    // grid item, siblings included, and run over what follows.
    <Command shouldFilter={false} className="h-auto rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3">
        {search.isFetching ? (
          <Loader2 className="size-4 shrink-0 animate-spin opacity-50" />
        ) : (
          <TypeChip typeKey={targetType.key} displayName={targetType.displayName} size="sm" />
        )}
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={`Search ${targetType.displayName}…`}
          className="h-9 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
        />
      </div>
      <CommandList className="max-h-52">
        {leading}
        {(search.data ?? []).map(({ entity: candidate, matches, matched }) => (
          <CommandItem
            key={candidate._id}
            value={`target:${candidate._id}`}
            disabled={disabled}
            onSelect={() => onPick(candidate)}
          >
            {detail === undefined ? (
              <EntitySearchRow
                entity={candidate}
                matches={matches}
                matched={matched}
                typeName={targetType.displayName}
              />
            ) : (
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <EntitySearchRow
                  entity={candidate}
                  matches={matches}
                  matched={matched}
                  typeName={targetType.displayName}
                />
                {detail(candidate)}
              </span>
            )}
          </CommandItem>
        ))}
        {!search.isFetching && (search.data?.length ?? 0) === 0 && (
          <div className="px-4 py-4 text-center text-[13px] text-muted-foreground">
            {debouncedQuery === ''
              ? `No ${targetType.displayName} entities yet.`
              : `No ${targetType.displayName} matches “${debouncedQuery}”.`}
          </div>
        )}
      </CommandList>
    </Command>
  )
}
