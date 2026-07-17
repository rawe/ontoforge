import { useQueries } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { listEntities } from '@/api/runtime'
import type { EntityInstance, SchemaEntityType } from '@/api/types'
import { displayLabel } from '@/lib/displayLabel'
import { TypeChip } from '@/components/TypeChip'
import { Skeleton } from '@/components/ui/skeleton'
import { relativeTime } from '@/components/table/format'

const PER_TYPE = 5
const SHOW = 8

/**
 * "Recently updated" — the 5 most recently updated entities of each type,
 * merged client-side and trimmed to the top 8 overall.
 */
export function RecentlyUpdated({
  ontologyKey,
  entityTypes,
}: {
  ontologyKey: string
  entityTypes: readonly SchemaEntityType[]
}) {
  const results = useQueries({
    queries: entityTypes.map((t) => ({
      queryKey: ['entities', ontologyKey, t.key, { recent: PER_TYPE }] as const,
      queryFn: () =>
        listEntities(ontologyKey, t.key, {
          limit: PER_TYPE,
          sort: '_updatedAt',
          order: 'desc',
        }),
      staleTime: 30_000,
    })),
  })

  const loading = results.some((r) => r.isPending)
  const items: EntityInstance[] = results
    .flatMap((r) => r.data?.items ?? [])
    .filter((e) => typeof e._updatedAt === 'string')
    .sort((a, b) => String(b._updatedAt).localeCompare(String(a._updatedAt)))
    .slice(0, SHOW)

  const typeName = new Map(entityTypes.map((t) => [t.key, t.displayName]))

  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Recently updated
      </h2>
      <div className="mt-3 overflow-hidden rounded-xl border bg-card">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-[13px] text-muted-foreground">
            <History className="size-4" />
            Nothing here yet — updates to entities will show up here.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((e) => (
              <li key={e._id}>
                <Link
                  to={`/w/${ontologyKey}/e/${e._entityTypeKey}/${e._id}`}
                  className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-muted/50"
                >
                  <TypeChip
                    typeKey={e._entityTypeKey}
                    displayName={typeName.get(e._entityTypeKey) ?? e._entityTypeKey}
                    size="sm"
                  />
                  <span className="truncate text-[13px] font-medium">
                    {displayLabel(e)}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {relativeTime(String(e._updatedAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
