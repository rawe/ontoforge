import type { RetrieverPlan as Plan } from '@/api/retrievers'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { MODE_LABEL, indexName, plannedFilterText, relationName } from './retrieverModel'

function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">–</span>
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value).slice(0, 16000)}</span>
  if (depth > 3) return <span>Further details truncated</span>
  if (Array.isArray(value)) return <ul className="space-y-1">{value.slice(0, 30).map((v, i) => <li key={i}><Value value={v} depth={depth + 1} /></li>)}</ul>
  return <dl className="space-y-1">{Object.entries(value).slice(0, 30).map(([key, v]) => <div key={key} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-3"><dt className="text-muted-foreground">{key}</dt><dd className="min-w-0"><Value value={v} depth={depth + 1} /></dd></div>)}</dl>
}

/** What a retriever's planning step made of the question: its sub-queries with their filters, or why it cannot be answered. */
export function RetrieverPlan({ plan, catalog, schema }: { plan: Plan; catalog: SearchCatalogEntry[] | undefined; schema: RuntimeSchema | undefined }) {
  return <div className="space-y-4 text-xs">
    <p className="text-muted-foreground">What the planning model made of the question. The search runs exactly these sub-queries; it never sees the question text itself.</p>
    {plan.unsupportedReason && <p className="rounded border border-amber-500/30 p-2">Not answerable from this lens: {plan.unsupportedReason}</p>}
    {plan.subQueries.length === 0 && <p>No search planned.</p>}
    {plan.subQueries.map((sub, i) => <dl key={i} className="space-y-2 rounded border p-3">
      <div><dt className="text-muted-foreground">Sub-query {i + 1} · searches</dt><dd className="font-medium">{sub.indices.map((key) => indexName(key, catalog)).join(', ') || '–'}</dd></div>
      <div><dt className="text-muted-foreground">Relations</dt><dd>{sub.relations.length ? sub.relations.map((key) => relationName(key, sub.indices, catalog, schema)).join(', ') : 'all relation groups of these indices'}</dd></div>
      <div><dt className="text-muted-foreground">Query, {MODE_LABEL[sub.mode] ?? sub.mode}</dt><dd>{sub.query ? <span className="rounded bg-muted px-1.5 py-0.5 font-medium">“{sub.query}”</span> : 'none — exact filters only'}{sub.variants.length > 0 && <span className="text-muted-foreground"> · also {sub.variants.map((v) => `“${v}”`).join(', ')}</span>}</dd></div>
      <div><dt className="text-muted-foreground">Exact filters</dt><dd>{sub.filters.length ? sub.filters.map((f, j) => <div key={j}>{plannedFilterText(f, schema)}</div>) : 'none'}</dd></div>
    </dl>)}
    <details><summary className="cursor-pointer">Raw plan</summary><div className="mt-2"><Value value={plan} /></div></details>
  </div>
}
