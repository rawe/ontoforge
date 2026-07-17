import { useQuery } from '@tanstack/react-query'
import { SquareTerminal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { qk } from '@/api/queryKeys'
import { listSavedQueries } from '@/api/runtime'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Saved queries as quick-run cards; clicking navigates to the Query page
 * with `?run={queryKey}` (the Query slice wires the parameter up).
 */
export function SavedQueriesSection({ ontologyKey }: { ontologyKey: string }) {
  const queries = useQuery({
    queryKey: qk.savedQueries(ontologyKey),
    queryFn: () => listSavedQueries(ontologyKey),
  })

  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Saved queries
      </h2>
      <div className="mt-3">
        {queries.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : queries.data === undefined || queries.data.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
            No saved queries yet. Build them in the Query console or in the Studio.
          </p>
        ) : (
          <ul className="space-y-2">
            {queries.data.map((q) => (
              <li key={q.key}>
                <Link
                  to={`/w/${ontologyKey}/query?run=${encodeURIComponent(q.key)}`}
                  className="group flex items-start gap-2.5 rounded-xl border bg-card px-3.5 py-2.5 transition-all duration-150 hover:border-ring/40"
                >
                  <SquareTerminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{q.name}</span>
                    {q.description !== null && q.description !== '' && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {q.description}
                      </span>
                    )}
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
