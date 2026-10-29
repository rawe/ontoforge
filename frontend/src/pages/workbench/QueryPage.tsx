import { useParams, useSearchParams } from 'react-router-dom'
import { useRuntimeSchema } from '@/api/hooks'
import { PageHeader } from '@/components/PageHeader'
import { ConsoleTab } from '@/components/query/ConsoleTab'
import { LibraryTab } from '@/components/query/LibraryTab'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Tab = 'console' | 'library'

/**
 * `/o/:ontologyKey/w/:lensKey/query` — Query workbench. Two tabs: Console and
 * saved-query Library. URL params: `?tab=library`, `?run={queryKey}` (open a
 * saved query's run panel) and `?query=...` (prefill the console).
 */
export function QueryPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  const runParam = searchParams.get('run')
  const queryParam = searchParams.get('query')
  const tabParam = searchParams.get('tab')
  // `?run=` forces the Library, `?query=` forces the Console.
  const tab: Tab =
    runParam !== null
      ? 'library'
      : queryParam !== null
        ? 'console'
        : tabParam === 'library'
          ? 'library'
          : 'console'

  const switchTab = (next: Tab) => {
    setSearchParams(next === 'console' ? {} : { tab: 'library' }, { replace: true })
  }

  if (ontologyKey === undefined || lensKey === undefined) return null

  return (
    <div>
      <PageHeader
        title="Query"
        description="Run read-only OQL queries against this lens and use the saved-query library."
        actions={
          <Tabs value={tab} onValueChange={(v) => switchTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="library">Library</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="p-6">
        {schema.isPending && (
          <div className="space-y-3">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-8 w-64 rounded-lg" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        )}

        {schema.data !== undefined && (
          <>
            {/* Both tabs stay mounted so console results survive a Library visit. */}
            <div className={tab === 'console' ? '' : 'hidden'}>
              <ConsoleTab
                key={`${ontologyKey}/${lensKey}`}
                ontologyKey={ontologyKey}
                lensKey={lensKey}
                schema={schema.data}
                initialQuery={queryParam ?? undefined}
              />
            </div>
            <div className={tab === 'library' ? '' : 'hidden'}>
              <LibraryTab
                key={`${ontologyKey}/${lensKey}`}
                ontologyKey={ontologyKey}
                lensKey={lensKey}
                relationTypes={schema.data.relationTypes}
                runKey={runParam}
                onOpenConsole={() => switchTab('console')}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
