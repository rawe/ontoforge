import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFeatures } from '@/api/hooks'
import { useSearchIndices } from '@/api/searchIndexHooks'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { KindBadge, StatusChip } from './shared'

/**
 * "Search indices" section of the entity type editor: the indices rooted
 * on the type, with links to the designer. Hidden when the server has no
 * search indices.
 */
export function EntityTypeIndices({
  ontologyKey,
  entityTypeKey,
}: {
  ontologyKey: string
  entityTypeKey: string
}) {
  const supported = useFeatures().data?.searchIndices === true
  const { data: records } = useSearchIndices(ontologyKey, supported)
  if (!supported) return null

  const rooted = (records ?? []).filter((r) => r.definition.entityType === entityTypeKey)
  const base = `/o/${ontologyKey}/studio/search`

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Search indices</h2>
        <span className="text-[13px] text-muted-foreground">{rooted.length}</span>
        <Button size="sm" variant="outline" className="ml-auto" asChild>
          <Link to={`${base}/new?entityType=${encodeURIComponent(entityTypeKey)}`}>
            <Plus className="size-3.5" /> New index
          </Link>
        </Button>
      </div>
      {records === undefined ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : rooted.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
          No search index finds this type — it has no string or document property and no
          custom index.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {rooted.map((r) => (
            <li key={r.key}>
              <Link
                to={`${base}/${encodeURIComponent(r.key)}`}
                className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/40"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[13px] font-medium">{r.definition.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {r.key}
                  </span>
                </span>
                <KindBadge kind={r.kind} />
                <StatusChip status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
