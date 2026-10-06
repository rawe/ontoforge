import { useState } from 'react'
import type { RetrieverAgentConfig, RetrieverAgentMeta, RetrieverAgentResult } from '@/api/retrieverAgents'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { matchedViaText } from '@/lib/matchedVia'
import {
  MODE_LABEL, STEPS, callCounts, formatMs, indexName, stepText, type TurnStatus, modelCallName, phaseName, plannedFilterText, relationName, resultLabel, resultsBySubQuery,
} from './retrieverAgentModel'

interface Context { config: RetrieverAgentConfig | null; catalog: SearchCatalogEntry[] | undefined; schema: RuntimeSchema | undefined }

function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">–</span>
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value).slice(0, 16000)}</span>
  if (depth > 3) return <span>Further details truncated</span>
  if (Array.isArray(value)) return <ul className="space-y-1">{value.slice(0, 30).map((v, i) => <li key={i}><Value value={v} depth={depth + 1} /></li>)}</ul>
  return <dl className="space-y-1">{Object.entries(value).slice(0, 30).map(([key, v]) => <div key={key} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-3"><dt className="text-muted-foreground">{key}</dt><dd className="min-w-0"><Value value={v} depth={depth + 1} /></dd></div>)}</dl>
}

function Intro({ children }: { children: string }) {
  return <p className="text-muted-foreground">{children}</p>
}

function Pre({ title, text, note }: { title: string; text: string; note?: string }) {
  return <details className="rounded border">
    <summary className="cursor-pointer px-2 py-1.5">{title} <span className="text-muted-foreground">· {text.length.toLocaleString('en-US')} characters</span></summary>
    {note && <p className="px-2 text-amber-600">{note}</p>}
    <pre className="max-h-72 overflow-auto border-t p-2 whitespace-pre-wrap break-words">{text}</pre>
  </details>
}

function Overview({ meta, status }: { meta: RetrieverAgentMeta; status: TurnStatus }) {
  const timings = meta.timings ?? {}
  const calls = callCounts(meta, status)
  const total = timings.total ?? STEPS.reduce((sum, key) => sum + (timings[key] ?? 0), 0)
  const details = Object.entries(timings).filter(([key]) => !(STEPS as readonly string[]).includes(key) && key !== 'total')
  return <div className="space-y-4">
    <Intro>Where the time went. The three steps run one after another.</Intro>
    <div className="space-y-2">{STEPS.map((key) => {
      const ms = timings[key]
      return <div key={key} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2">
        <span>{phaseName(key)}</span>
        <span className="h-2 overflow-hidden rounded bg-muted"><span className="block h-full rounded bg-primary/70" style={{ width: ms && total ? `${Math.max(1, (ms / total) * 100)}%` : 0 }} /></span>
        <span className={`text-right tabular-nums ${ms === undefined && status !== 'pending' ? 'text-muted-foreground' : ''}`}>{stepText(timings, key, status)}</span>
      </div>
    })}
    {timings.total !== undefined && <p className="text-right font-medium tabular-nums">Total {formatMs(timings.total)}</p>}</div>
    <dl className="grid grid-cols-2 gap-2 text-center">
      {([['Model calls', calls.model], ['Search calls', calls.search]] as const).map(([name, value]) =>
        <div key={name} className="rounded border p-2"><dd className="text-base font-semibold tabular-nums">{value ?? '–'}</dd><dt className="text-muted-foreground">{name}</dt></div>)}
    </dl>
    {!!meta.limitations?.length && <section className="space-y-1"><h4 className="font-medium">Limitations</h4>{meta.limitations.map((text, i) => <p key={i} className="rounded border border-amber-500/30 bg-amber-500/5 p-2">{text}</p>)}</section>}
    {details.length > 0 && <details><summary className="cursor-pointer">Detailed timings</summary>
      <dl className="mt-2 space-y-1">{details.map(([key, ms]) => <div key={key} className="flex justify-between gap-3"><dt>{phaseName(key)}</dt><dd className="tabular-nums">{formatMs(ms)}</dd></div>)}</dl>
      <p className="mt-1 text-muted-foreground">These are parts of the steps above; do not add them up.</p>
    </details>}
  </div>
}

function Plan({ meta, config, catalog, schema }: { meta: RetrieverAgentMeta } & Context) {
  const plan = meta.plan
  if (!plan) return <Intro>No plan yet.</Intro>
  const unsupported = typeof plan.unsupportedReason === 'string' ? plan.unsupportedReason : null
  return <div className="space-y-4">
    <Intro>What the planning model made of the question. The search runs exactly these sub-queries; it never sees the question text itself.</Intro>
    {unsupported && <p className="rounded border border-amber-500/30 p-2">Not answerable from this lens: {unsupported}</p>}
    {plan.subQueries?.length === 0 && <p>No search planned.</p>}
    {plan.subQueries?.map((sub, i) => <dl key={i} className="space-y-2 rounded border p-3">
      <div><dt className="text-muted-foreground">Sub-query {i + 1} · searches</dt><dd className="font-medium">{sub.indices.map((key) => indexName(key, catalog)).join(', ') || '–'}</dd></div>
      <div><dt className="text-muted-foreground">Relations</dt><dd>{sub.relations?.length ? sub.relations.map((key) => relationName(key, sub.indices, catalog, schema)).join(', ') : 'all relation groups of these indices'}</dd></div>
      <div><dt className="text-muted-foreground">Query, {MODE_LABEL[sub.mode] ?? sub.mode}</dt><dd>{sub.query ? <span className="rounded bg-muted px-1.5 py-0.5 font-medium">“{sub.query}”</span> : 'none — exact filters only'}{!!sub.variants?.length && <span className="text-muted-foreground"> · also {sub.variants.map((v) => `“${v}”`).join(', ')}</span>}</dd></div>
      <div><dt className="text-muted-foreground">Exact filters</dt><dd>{sub.filters?.length ? sub.filters.map((f, j) => <div key={j}>{plannedFilterText(f, config, schema)}</div>) : 'none'}</dd></div>
    </dl>)}
    <details><summary className="cursor-pointer">Raw plan</summary><div className="mt-2"><Value value={plan} /></div></details>
  </div>
}

function ResultRow({ result, rank, via, schema }: { result: RetrieverAgentResult; rank: number; via: string | null; schema: RuntimeSchema | undefined }) {
  const [open, setOpen] = useState(false)
  const type = schema?.entityTypes.find((t) => t.key === result.entityType)
  return <li>
    <button type="button" className="grid w-full grid-cols-[1.5rem_1fr] items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/50" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="text-muted-foreground tabular-nums">{rank}</span>
      <span className="min-w-0 space-y-0.5">
        <span className="flex min-w-0 items-center gap-2"><TypeChip typeKey={result.entityType} displayName={type?.displayName ?? result.entityType} size="sm" /><span className="truncate font-medium">{resultLabel(result)}</span></span>
        {via && <span className="block truncate text-muted-foreground">{via}</span>}
      </span>
    </button>
    {open && <div className="space-y-3 bg-muted/20 px-3 py-2">
      <div><h5 className="mb-1 font-medium">Answer fields sent as evidence</h5><Value value={result.answerFields} /></div>
      <p className="text-muted-foreground">ID {result.entityId}{result.matched ? ` · index ${result.matched.index}` : ''}</p>
    </div>}
  </li>
}

function Results({ meta, catalog, schema }: { meta: RetrieverAgentMeta } & Context) {
  if (!meta.results) return <Intro>No results yet.</Intro>
  const groups = resultsBySubQuery(meta)
  return <div className="space-y-4">
    <Intro>What the search found per sub-query, best first, and the entry each result was found by. These results are the answer's evidence.</Intro>
    {groups.length === 0 && <p>Nothing found.</p>}
    {groups.map((group) => <section key={group.subQuery} className="space-y-2">
      <h4 className="font-medium">Sub-query {group.subQuery + 1}{group.plan?.query ? <span className="font-normal text-muted-foreground"> · “{group.plan.query}”</span> : ''}</h4>
      <ol className="divide-y rounded border">{group.results.map((result, rank) =>
        <ResultRow key={`${result.entityType}/${result.entityId}/${rank}`} result={result} rank={rank + 1} via={matchedViaText(result.matched, schema, catalog)} schema={schema} />)}</ol>
    </section>)}
  </div>
}

function ModelCalls({ meta }: { meta: RetrieverAgentMeta }) {
  if (!meta.modelIO?.length) return <Intro>No model calls yet.</Intro>
  return <div className="space-y-4">
    <Intro>The language model calls: the planner turns the question into sub-queries, the response model writes the answer from the found evidence. When a follow-up's first plan searches nothing, planning is repeated once.</Intro>
    {meta.modelIO.map((call) => {
      const usage = call.usage as { input_tokens?: number; output_tokens?: number } | undefined
      return <section key={call.phase} className="space-y-2 rounded border p-3">
        <h4 className="flex justify-between gap-3 font-medium"><span>{modelCallName(call.phase)}</span>
          <span className="font-normal text-muted-foreground tabular-nums">{usage ? `${usage.input_tokens ?? '–'} tokens in · ${usage.output_tokens ?? '–'} out` : ''}{call.finishReason ? ` · ${call.finishReason}` : ''}</span></h4>
        {call.systemPrompt !== undefined && <Pre title="System instructions" text={call.systemPrompt} />}
        <Pre title="Input" text={call.input} note={call.inputTruncated ? 'Trace is truncated; the model received the full input.' : undefined} />
        <Pre title="Output" text={call.output} note={call.outputTruncated ? 'Trace is truncated.' : undefined} />
      </section>
    })}
  </div>
}

/** Diagnostics of one answer, split along the pipeline so each tab answers one question. No scores. */
export function RetrieverAgentDiagnostics({ meta, question, status, config, catalog, schema }: { meta: RetrieverAgentMeta; question: string; status: TurnStatus } & Context) {
  const [tab, setTab] = useState('overview')
  return <div className="flex min-h-0 flex-1 flex-col text-xs">
    <p className="truncate px-4 pt-3 text-muted-foreground" title={question}>For: <span className="text-foreground">{question}</span>{status === 'failed' && <span className="text-destructive"> · failed or cancelled</span>}</p>
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList variant="line" className="mx-2 mt-2 h-8 w-auto justify-start border-b">
        {[['overview', 'Overview'], ['plan', 'Plan'], ['results', `Results${meta.results ? ` (${meta.results.length})` : ''}`], ['models', 'Model calls']].map(([value, name]) =>
          <TabsTrigger key={value} value={value} className="px-2 text-xs">{name}</TabsTrigger>)}
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <TabsContent value="overview"><Overview meta={meta} status={status} /></TabsContent>
        <TabsContent value="plan"><Plan meta={meta} config={config} catalog={catalog} schema={schema} /></TabsContent>
        <TabsContent value="results"><Results meta={meta} config={config} catalog={catalog} schema={schema} /></TabsContent>
        <TabsContent value="models"><ModelCalls meta={meta} /></TabsContent>
      </div>
    </Tabs>
  </div>
}
