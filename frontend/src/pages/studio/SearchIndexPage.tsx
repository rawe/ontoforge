import { SearchX } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api/http'
import { useSearchIndex } from '@/api/searchIndexHooks'
import { EmptyState } from '@/components/EmptyState'
import { IndexDesigner } from '@/components/search/IndexDesigner'
import { ManagedIndexView } from '@/components/search/ManagedIndexView'
import { SearchFeatureGate } from '@/components/search/shared'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * `/o/:ontologyKey/studio/search/:key` — index designer (custom) or the
 * read-only view (managed); `/search/new[?entityType=…]` — a new index.
 */
export function SearchIndexPage() {
  const { ontologyKey, key } = useParams<{ ontologyKey: string; key: string }>()
  const [searchParams] = useSearchParams()
  if (ontologyKey === undefined) return null
  return (
    <SearchFeatureGate>
      {key === undefined ? (
        <IndexDesigner
          ontologyKey={ontologyKey}
          saved={null}
          initialEntityType={searchParams.get('entityType') ?? undefined}
        />
      ) : (
        <SavedIndex ontologyKey={ontologyKey} indexKey={key} />
      )}
    </SearchFeatureGate>
  )
}

function SavedIndex({ ontologyKey, indexKey }: { ontologyKey: string; indexKey: string }) {
  const { data: record, isPending, error } = useSearchIndex(ontologyKey, indexKey)

  if (isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (record === undefined) {
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <EmptyState
        icon={SearchX}
        title={notFound ? 'Index not found' : 'Could not load the index'}
        description={notFound ? 'It may have been deleted.' : (error?.message ?? undefined)}
        action={
          <Button variant="outline" asChild>
            <Link to={`/o/${ontologyKey}/studio/search`}>Back to search</Link>
          </Button>
        }
      />
    )
  }
  if (record.kind !== 'custom') {
    return <ManagedIndexView ontologyKey={ontologyKey} record={record} />
  }
  // A newer saved version re-seeds the draft.
  return <IndexDesigner key={`${record.key}@${record.updatedAt}`} ontologyKey={ontologyKey} saved={record} />
}
