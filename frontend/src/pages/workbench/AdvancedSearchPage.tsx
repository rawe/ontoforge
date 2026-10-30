import { useParams } from 'react-router-dom'
import { useRuntimeSchema } from '@/api/hooks'
import { AdvancedSearch } from '@/components/advancedsearch/AdvancedSearch'
import { SearchExplainerButton } from '@/components/advancedsearch/explainer/SearchExplainer'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * `/o/:ontologyKey/w/:lensKey/search` — Advanced search: the entity search and
 * the passage search with every option, apart from the Cmd+K palette's quick
 * search. A "?" beside the title explains how search works.
 */
export function AdvancedSearchPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  if (ontologyKey === undefined || lensKey === undefined) return null

  return (
    <div>
      <PageHeader
        title="Advanced search"
        meta={<SearchExplainerButton className="-ml-2" />}
        description="Search entities or passages of their documents in this lens — by keyword, by meaning, or both."
      />

      <div className="p-6">
        {schema.isPending && (
          <div className="space-y-3">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        )}

        {schema.data !== undefined && (
          <AdvancedSearch
            key={`${ontologyKey}/${lensKey}`}
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            schema={schema.data}
          />
        )}
      </div>
    </div>
  )
}
