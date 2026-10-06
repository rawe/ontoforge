import { useMutation } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import * as model from '@/api/model'
import type { SearchIndexRecord } from '@/api/types'
import { KindBadge } from '@/components/search/shared'
import { TypeChip } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { toastError } from './lib'
import { indexInclusionState, orderByRootType } from './scopeModel'

/** One index row: checkbox writes the inclusion immediately, like type rows. */
function IndexRow({
  ontologyKey,
  lensId,
  record,
  rootName,
  includedIndexKeys,
  includedEntityTypeKeys,
  onInvalidate,
}: {
  ontologyKey: string
  lensId: string
  record: SearchIndexRecord
  rootName: string
  includedIndexKeys: ReadonlySet<string>
  includedEntityTypeKeys: ReadonlySet<string>
  onInvalidate: () => void
}) {
  const state = indexInclusionState(record, includedIndexKeys, includedEntityTypeKeys)
  const toggle = useMutation({
    mutationFn: (checked: boolean) =>
      checked
        ? model.addScopeSearchIndex(ontologyKey, lensId, { key: record.key })
        : model.removeScopeSearchIndex(ontologyKey, lensId, record.key),
    onSuccess: onInvalidate,
    onError: toastError,
  })
  const blocked = !state.included && !state.canInclude

  return (
    <label
      className="flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50"
      title={blocked ? `Include the entity type ${rootName} first` : undefined}
    >
      <Checkbox
        checked={state.included}
        disabled={toggle.isPending || blocked}
        onCheckedChange={(checked) => toggle.mutate(checked === true)}
        aria-label={`Include search index ${record.definition.name}`}
      />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[13px]">{record.definition.name}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{record.key}</span>
        {blocked && (
          <span className="text-[11px] text-muted-foreground">
            Include the entity type {rootName} first.
          </span>
        )}
        {state.included && state.rootMissing && (
          <span className="flex items-center gap-1 text-[11px] text-(--tc-amber)">
            <TriangleAlert className="size-3" /> Its entity type {rootName} is not in scope.
          </span>
        )}
      </span>
      <TypeChip typeKey={record.definition.entityType} displayName={rootName} size="sm" />
      <KindBadge kind={record.kind} />
      {!record.enabled && (
        <Badge
          variant="outline"
          className="text-[10.5px] text-muted-foreground"
          title="Switched off in search settings"
        >
          off
        </Badge>
      )}
    </label>
  )
}

/**
 * "Search indices" section of the Scope tab. A scoped lens lists every
 * index (managed + custom) with an inclusion checkbox; an unscoped lens
 * sees every index, so only a note is shown. Index inclusions never make
 * a lens scoped — type inclusions do.
 */
export function ScopeSearchIndices({
  ontologyKey,
  lensId,
  scoped,
  records,
  includedIndexKeys,
  includedEntityTypeKeys,
  entityTypeNames,
  failed,
  onInvalidate,
}: {
  ontologyKey: string
  lensId: string
  scoped: boolean
  records: SearchIndexRecord[] | undefined
  /** Undefined while the inclusions load. */
  includedIndexKeys: ReadonlySet<string> | undefined
  includedEntityTypeKeys: ReadonlySet<string>
  /** Entity type key → display name, in schema order. */
  entityTypeNames: ReadonlyMap<string, string>
  /** The indices or the inclusions could not be loaded. */
  failed: boolean
  onInvalidate: () => void
}) {
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Search indices
      </h4>
      {!scoped ? (
        <p className="px-1.5 text-[12px] text-muted-foreground">
          Unscoped — every search index is available in this lens.
        </p>
      ) : failed ? (
        <p className="px-1.5 text-[12px] text-destructive">Could not load the search indices.</p>
      ) : records === undefined || includedIndexKeys === undefined ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : records.length === 0 ? (
        <p className="px-1.5 text-[12px] text-muted-foreground">
          No search indices in this ontology.
        </p>
      ) : (
        <>
          {orderByRootType(records, [...entityTypeNames.keys()]).map((r) => (
            <IndexRow
              key={r.key}
              ontologyKey={ontologyKey}
              lensId={lensId}
              record={r}
              rootName={entityTypeNames.get(r.definition.entityType) ?? r.definition.entityType}
              includedIndexKeys={includedIndexKeys}
              includedEntityTypeKeys={includedEntityTypeKeys}
              onInvalidate={onInvalidate}
            />
          ))}
          <p className="mt-1 px-1.5 text-[11px] text-muted-foreground">
            An index can be included only with its entity type. Including an entity type
            also includes its default and passage indices.
          </p>
        </>
      )}
    </section>
  )
}
