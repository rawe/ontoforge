import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RetrieveResponse, RetrieveResult } from '@/api/retrievers'
import type { SearchCatalogEntry } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { matchedViaText } from '@/lib/matchedVia'
import { cn } from '@/lib/utils'
import type { RetrieverSchema } from './retrieverModel'

interface Context {
  schema: RetrieverSchema | undefined
  catalog: readonly SearchCatalogEntry[] | undefined
}

/**
 * One found entity: type chip, label, the matched-via line when a relation
 * or passage matched, and a muted chip per proven condition. A result only
 * listed by its conditions (no text match) has no via line — its chips are
 * what put it there. No number or score.
 */
export function RetrievalResultRow({ result, schema, catalog }: { result: RetrieveResult } & Context) {
  const typeName = schema?.entityTypes.find((t) => t.key === result.entityType)?.displayName ?? result.entityType
  const via = matchedViaText(result.matched ?? undefined, schema, catalog ?? [])
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <TypeChip typeKey={result.entityType} displayName={typeName} size="sm" />
        <span className="min-w-0 flex-1 truncate">{result.label ?? result.entityId.slice(0, 12)}</span>
      </span>
      {via !== null && <span className="truncate text-[11px] text-muted-foreground">{via}</span>}
      {result.conditions.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {result.conditions.map((condition) => (
            <span
              key={`${condition.filter}\u0000${condition.value}`}
              className="rounded border bg-muted/40 px-1.5 py-px text-[10px] text-muted-foreground"
            >
              {condition.text}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * The result list of a retrieve, shared by the palette's question mode and
 * the retriever test panel: results in server order, the
 * limitations in one collapsible note above them, an unsupported reason as
 * the empty state, errors inline with the server's message. Results of an
 * earlier question stay, dimmed, until the next one is asked.
 */
export function RetrievalResults({
  response,
  error,
  running,
  stale,
  schema,
  catalog,
  item = (result, row) => <li key={`${result.entityType}/${result.entityId}`} className="px-2 py-1.5">{row}</li>,
  list = (items) => <ol className="divide-y rounded border">{items}</ol>,
  status = (children) => <p className="flex items-center gap-2 px-2 py-3 text-muted-foreground">{children}</p>,
  footer,
}: {
  response: RetrieveResponse | null
  error: string | null
  running: boolean
  /** The results answer an earlier question than the current one. */
  stale: boolean
  /** Wraps one row: a list item, or the palette's command item. */
  item?: (result: RetrieveResult, row: ReactNode) => ReactNode
  /** Wraps the rows. */
  list?: (items: ReactNode) => ReactNode
  /** Renders a status line. */
  status?: (children: ReactNode) => ReactNode
  /** Below the results, e.g. "Show all in Explorer". */
  footer?: ReactNode
} & Context) {
  const results = response?.results ?? []
  return (
    <>
      {running && status(<><Loader2 className="size-4 animate-spin" /> Searching… <span className="text-muted-foreground">Esc cancels.</span></>)}
      {error !== null && status(<span className="whitespace-pre-wrap text-destructive">{error}</span>)}
      {response !== null && (
        <div className={cn('space-y-1', stale && 'opacity-50')} aria-label={stale ? 'Results of an earlier question' : undefined}>
          {stale && !running && status('Results of an earlier question. Press Enter to ask the new one.')}
          {response.limitations.length > 0 && (
            <details className="mx-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px]">
              <summary className="cursor-pointer">
                {response.limitations.length === 1 ? '1 limitation' : `${response.limitations.length} limitations`}
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {response.limitations.map((text, i) => <li key={i}>{text}</li>)}
              </ul>
            </details>
          )}
          {results.length === 0
            ? status(response.unsupportedReason ?? 'Nothing found.')
            : list(results.map((result) => item(result, <RetrievalResultRow result={result} schema={schema} catalog={catalog} />)))}
          {results.length > 0 && footer}
        </div>
      )}
    </>
  )
}
