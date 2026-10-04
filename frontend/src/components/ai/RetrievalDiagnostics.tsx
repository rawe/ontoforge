import { useState } from 'react'
import type { RetrievalCatalog, RetrievalConfig, RetrievalMeta, RetrievalResult } from '@/api/retrievalPrototype'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { phaseNames } from './retrievalPhases'

/** The four sequential steps of one question; every other timing is a part of one of them. */
const steps = ['prepare', 'plan', 'retrieve', 'answer']

type PlanBucket = {
  entityTypeKey?: string; all?: boolean; semanticQuery?: string | null; softConditionIds?: string[]; variants?: string[]
  filters?: { conditionId: string; value: unknown; quote?: string }[]; previous?: { quote?: string } | null
}
type Item = RetrievalResult['items'][number]
type Relation = { conditionId?: string; id?: string; value?: unknown }

const duration = (ms: number) => ms < 1000 ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`
const label = (item: Item) => String(item.fields.name ?? item.fields.title ?? item.id)

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

/** Resolves a configured condition to the words a user chose in the editor: the relation path and its compared field. */
function conditionLabel(conditionId: string, entityTypeKey: string, config: RetrievalConfig, catalog: RetrievalCatalog) {
  const condition = config.buckets.find((b) => b.entityTypeKey === entityTypeKey)?.conditions.find((c) => c.id === conditionId)
  if (!condition) return conditionId
  const path = condition.path.map((p) => catalog.relationTypes.find((r) => r.key === p.relationTypeKey)?.displayName ?? p.relationTypeKey).join(' → ')
  return `${path || 'Own field'} · ${condition.targetField}${condition.mode === 'soft' ? ' (by meaning)' : ' (exact)'}`
}

function Overview({ meta }: { meta: RetrievalMeta }) {
  const timings = meta.timings ?? {}
  const total = timings.total ?? steps.reduce((sum, key) => sum + (timings[key] ?? 0), 0)
  const details = Object.entries(timings).filter(([key]) => !steps.includes(key) && key !== 'total')
  return <div className="space-y-4">
    <Intro>Where the time went and what was reused. The four steps run one after another.</Intro>
    <div className="space-y-2">{steps.map((key) => {
      const ms = timings[key]
      return <div key={key} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2">
        <span>{phaseNames[key]}</span>
        <span className="h-2 overflow-hidden rounded bg-muted"><span className="block h-full rounded bg-primary/70" style={{ width: ms && total ? `${Math.max(1, (ms / total) * 100)}%` : 0 }} /></span>
        <span className="text-right tabular-nums">{ms === undefined ? '…' : duration(ms)}</span>
      </div>
    })}
    {timings.total !== undefined && <p className="text-right font-medium tabular-nums">Total {duration(timings.total)}</p>}</div>
    <dl className="grid grid-cols-3 gap-2 text-center">
      {[['Model calls', meta.llmCalls], ['New embeddings', meta.embeddingRequests], ['Reused vectors', meta.cacheHits]].map(([name, value]) =>
        <div key={name} className="rounded border p-2"><dd className="text-base font-semibold tabular-nums">{value ?? '–'}</dd><dt className="text-muted-foreground">{name}</dt></div>)}
    </dl>
    {!!meta.limitations?.length && <section className="space-y-1"><h4 className="font-medium">Limitations</h4>{meta.limitations.map((text, i) => <p key={i} className="rounded border border-amber-500/30 bg-amber-500/5 p-2">{text}</p>)}</section>}
    {details.length > 0 && <details><summary className="cursor-pointer">Detailed timings</summary>
      <dl className="mt-2 space-y-1">{details.map(([key, ms]) => <div key={key} className="flex justify-between gap-3"><dt>{phaseNames[key] ?? key}</dt><dd className="tabular-nums">{duration(ms)}</dd></div>)}</dl>
      <p className="mt-1 text-muted-foreground">These are parts of the steps above; do not add them up.</p>
    </details>}
  </div>
}

function Plan({ meta, config, catalog }: { meta: RetrievalMeta; config: RetrievalConfig; catalog: RetrievalCatalog }) {
  const plan = meta.plan as { buckets?: PlanBucket[]; unsupportedReason?: string | null } | undefined
  if (!plan) return <Intro>No plan yet.</Intro>
  return <div className="space-y-4">
    <Intro>What the planning model made of the question. The search runs exactly this plan; it never sees the question text itself.</Intro>
    {plan.unsupportedReason && <p className="rounded border border-amber-500/30 p-2">Not answerable from this schema: {plan.unsupportedReason}</p>}
    {plan.buckets?.map((bucket) => <dl key={bucket.entityTypeKey} className="space-y-2 rounded border p-3">
      <div><dt className="text-muted-foreground">Looks for</dt><dd className="font-medium">{catalog.entityTypes.find((t) => t.key === bucket.entityTypeKey)?.displayName ?? bucket.entityTypeKey}{bucket.all ? ' · all of them' : ''}</dd></div>
      <div><dt className="text-muted-foreground">Search by meaning for</dt><dd>{bucket.semanticQuery ? <span className="rounded bg-muted px-1.5 py-0.5 font-medium">“{bucket.semanticQuery}”</span> : 'nothing — exact conditions only'}{!!bucket.variants?.length && <span className="text-muted-foreground"> · also {bucket.variants.map((v) => `“${v}”`).join(', ')}</span>}</dd></div>
      <div><dt className="text-muted-foreground">Meaning conditions switched on</dt><dd>{bucket.softConditionIds?.length ? bucket.softConditionIds.map((id) => <div key={id}>{conditionLabel(id, bucket.entityTypeKey ?? '', config, catalog)}</div>) : 'none'}</dd></div>
      <div><dt className="text-muted-foreground">Exact filters</dt><dd>{bucket.filters?.length ? bucket.filters.map((f, i) => <div key={i}>{conditionLabel(f.conditionId, bucket.entityTypeKey ?? '', config, catalog)} = <b>{String(f.value)}</b>{f.quote && <span className="text-muted-foreground"> (from “{f.quote}”)</span>}</div>) : 'none'}</dd></div>
      {bucket.previous && <div><dt className="text-muted-foreground">Refers to previous answer</dt><dd>“{bucket.previous.quote}”</dd></div>}
    </dl>)}
    <details><summary className="cursor-pointer">Raw plan</summary><div className="mt-2"><Value value={meta.plan} /></div></details>
  </div>
}

function Results({ meta, config, catalog }: { meta: RetrievalMeta; config: RetrievalConfig; catalog: RetrievalCatalog }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!meta.results) return <Intro>No results yet.</Intro>
  return <div className="space-y-4">
    <Intro>{`What the search found, ranked by similarity to the planned query (−1 to 1). The line marks the threshold ${config.threshold.toFixed(2)}; scores are not confidence.`}</Intro>
    {meta.results.map((bucket) => <section key={bucket.entityTypeKey} className="space-y-2">
      <h4 className="font-medium">{catalog.entityTypes.find((t) => t.key === bucket.entityTypeKey)?.displayName ?? bucket.entityTypeKey}</h4>
      <p className="flex flex-wrap items-center gap-1 text-muted-foreground"><b className="text-foreground">{bucket.totalHardMatches}</b> pass exact filters → <b className="text-foreground">{bucket.totalAccepted}</b> above threshold → <b className="text-foreground">{bucket.totalAccepted - bucket.omitted}</b> sent to the answer model</p>
      <ol className="divide-y rounded border">{bucket.items.map((item, rank) => {
        const key = `${bucket.entityTypeKey}/${item.id}`
        const related = (item.relations as Relation[]).filter((r) => r.id !== item.id).map((r) => String(r.value))
        return <li key={key}>
          <button type="button" className="grid w-full grid-cols-[1.5rem_1fr_4.5rem] items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
            <span className="text-muted-foreground tabular-nums">{rank + 1}</span>
            <span className="min-w-0"><span className="block truncate font-medium">{label(item)}</span>{related.length > 0 && <span className="block truncate text-muted-foreground">{related.join(' · ')}</span>}</span>
            {item.score === null ? <span className="text-right text-muted-foreground">exact</span> : <span className="space-y-0.5 text-right tabular-nums">{item.score.toFixed(3)}
              <span className="relative block h-1.5 rounded bg-muted"><span className="block h-full rounded bg-primary/70" style={{ width: `${Math.max(0, item.score) * 100}%` }} /><span className="absolute top-[-2px] h-2.5 w-px bg-foreground" style={{ left: `${Math.max(0, config.threshold) * 100}%` }} /></span></span>}
          </button>
          {open === key && <div className="space-y-3 bg-muted/20 px-3 py-2">
            <div><h5 className="mb-1 font-medium">Answer fields sent as evidence</h5><Value value={item.fields} /></div>
            {item.sources && <div><h5 className="mb-1 font-medium">Where the score comes from</h5><ul className="space-y-0.5">{item.sources.map((source, i) => <li key={i} className="flex justify-between gap-3">
              <span>{source.kind === 'entity' ? 'Whole text (search fields + switched-on relations)' : source.kind === 'relation' ? `${conditionLabel(String(source.conditionId), bucket.entityTypeKey, config, catalog)}: ${String((item.relations as Relation[]).find((r) => r.id === source.targetId)?.value ?? source.targetId)}` : 'Exact match'}</span>
              <span className="tabular-nums">{typeof source.score === 'number' ? source.score.toFixed(3) : ''}</span></li>)}</ul></div>}
            <p className="text-muted-foreground">ID {item.id}</p>
          </div>}
        </li>
      })}</ol>
    </section>)}
  </div>
}

function ModelCalls({ meta }: { meta: RetrievalMeta }) {
  if (!meta.modelIO?.length) return <Intro>No model calls yet.</Intro>
  return <div className="space-y-4">
    <Intro>The two language model calls: the planner turns the question into a plan, the response model writes the answer from the found evidence.</Intro>
    {meta.modelIO.map((call) => {
      const usage = call.usage as { input_tokens?: number; output_tokens?: number } | undefined
      return <section key={call.phase} className="space-y-2 rounded border p-3">
        <h4 className="flex justify-between gap-3 font-medium"><span>{call.phase === 'plan' ? '1 · Planner' : '2 · Response'}</span>
          <span className="font-normal text-muted-foreground tabular-nums">{usage ? `${usage.input_tokens ?? '–'} tokens in · ${usage.output_tokens ?? '–'} out` : ''}{call.finishReason ? ` · ${call.finishReason}` : ''}</span></h4>
        {call.systemPrompt !== undefined && <Pre title="System instructions" text={call.systemPrompt} />}
        <Pre title="Input" text={call.input} note={call.inputTruncated ? 'Trace is truncated; the model received the full input.' : undefined} />
        <Pre title="Output" text={call.output} note={call.outputTruncated ? 'Trace is truncated.' : undefined} />
      </section>
    })}
  </div>
}

/** Diagnostics of one answer, split along the pipeline so each region answers one question. */
export function RetrievalDiagnostics({ meta, question, config, catalog }: {
  meta: RetrievalMeta; question: string; config: RetrievalConfig; catalog: RetrievalCatalog
}) {
  const [tab, setTab] = useState('overview')
  return <div className="flex min-h-0 flex-1 flex-col text-xs">
    <p className="truncate px-4 pt-3 text-muted-foreground" title={question}>For: <span className="text-foreground">{question}</span></p>
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList variant="line" className="mx-2 mt-2 h-8 w-auto justify-start border-b">
        {[['overview', 'Overview'], ['plan', 'Plan'], ['results', `Results${meta.results ? ` (${meta.results.reduce((n, b) => n + b.items.length, 0)})` : ''}`], ['models', 'Model calls']].map(([value, name]) =>
          <TabsTrigger key={value} value={value} className="px-2 text-xs">{name}</TabsTrigger>)}
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <TabsContent value="overview"><Overview meta={meta} /></TabsContent>
        <TabsContent value="plan"><Plan meta={meta} config={config} catalog={catalog} /></TabsContent>
        <TabsContent value="results"><Results meta={meta} config={config} catalog={catalog} /></TabsContent>
        <TabsContent value="models"><ModelCalls meta={meta} /></TabsContent>
      </div>
    </Tabs>
  </div>
}
