import { useQuery } from '@tanstack/react-query'
import { Check, LoaderCircle, Plus, SendHorizonal, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  chatRetrieval, prepareRetrieval, retrievalCatalog,
  type RetrievalBucket, type RetrievalCatalog, type RetrievalCondition, type RetrievalConfig,
  type RetrievalEvent, type RetrievalMeta, type RetrievalPathStep, type RetrievalPreparation, type RetrievalProperty, type RetrievalType,
} from '@/api/retrievalPrototype'
import { Markdown } from '@/components/ai/Markdown'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { chatSavedRetriever, prepareSavedRetriever, type RetrieverProfile } from '@/api/retrievers'
import { RetrieverProfiles } from './RetrieverProfiles'
import { editableRetrievalConfig, retrieverExecution } from './retrieverProfileState'

type PathChoice = { key: string; path: RetrievalPathStep[]; label: string; target: RetrievalType }
type Turn = { id: string; question: string; reply: string; status: 'pending' | 'complete' | 'failed'; error?: string; meta: RetrievalMeta }
const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'
const phaseNames: Record<string, string> = {
  prepare: 'Prepare search texts', plan: 'Plan question', validation: 'Validate plan', retrieve: 'Find and rank results',
  context: 'Build answer context', answer: 'Write answer', firstDelta: 'First answer text', total: 'Total',
  schemaRead: 'Read schema', dataRead: 'Read data', planModel: 'Planner model', queryEmbedding: 'Embed queries',
  candidateEmbedding: 'Embed result texts / cache', scoring: 'Calculate similarities', answerModel: 'Response model',
}
const semanticProperties = (type: RetrievalType) => type.properties.filter((p) => ['string', 'document'].includes(p.dataType))
const scalarProperties = (type: RetrievalType) => type.properties.filter((p) => p.dataType !== 'document')
const pathKey = (path: RetrievalPathStep[]) => path.map((p) => `${p.relationTypeKey}:${p.direction}`).join('/')
const nameField = (type: RetrievalType) => type.properties.find((p) => /^(name|title|titel)$/i.test(p.key))?.key ?? scalarProperties(type)[0]?.key ?? ''
const textDefaults = (type: RetrievalType) => {
  const preferred = semanticProperties(type).filter((p) => /name|title|titel|beschreibung|description|summary/i.test(p.key)).map((p) => p.key)
  return preferred.length ? preferred : semanticProperties(type).slice(0, 2).map((p) => p.key)
}

/** Only visible schema endpoints; no ontology-specific traversal or entity IDs. */
function pathChoices(catalog: RetrievalCatalog, start: RetrievalType): PathChoice[] {
  const choices: PathChoice[] = [{ key: '', path: [], label: start.displayName, target: start }]
  function visit(type: RetrievalType, path: RetrievalPathStep[], labels: string[], visited: string[]) {
    if (path.length === 2) return
    for (const relation of catalog.relationTypes) {
      const directions: ('outgoing' | 'incoming')[] = []
      if (relation.fromEntityTypeKey === type.key) directions.push('outgoing')
      if (relation.toEntityTypeKey === type.key) directions.push('incoming')
      for (const direction of directions) {
        const targetKey = direction === 'outgoing' ? relation.toEntityTypeKey : relation.fromEntityTypeKey
        const target = catalog.entityTypes.find((t) => t.key === targetKey)
        if (!target || visited.includes(targetKey)) continue
        const next = [...path, { relationTypeKey: relation.key, direction }]
        const nextLabels = [...labels, target.displayName]
        choices.push({ key: pathKey(next), path: next, label: nextLabels.join(' → '), target })
        visit(target, next, nextLabels, [...visited, targetKey])
      }
    }
  }
  visit(start, [], [start.displayName], [start.key])
  return choices
}

function suggestedBucket(catalog: RetrievalCatalog, type: RetrievalType): RetrievalBucket {
  const conditions: RetrievalCondition[] = []
  const choices = pathChoices(catalog, type)
  for (const choice of choices.filter((p) => p.path.length > 0)) {
    const label = `${choice.target.key} ${choice.target.displayName}`
    const mode = /halle|hall\b|location|standort|aussteller|exhibitor/i.test(label) ? 'hard'
      : /branche|industry|produktgruppe|product.?group|kategorie|category/i.test(label) ? 'soft' : null
    if (!mode) continue
    if (mode === 'soft' && choice.path.length > 1) continue
    if (mode === 'hard' && choice.path.length > 1 && !/halle|hall\b|location|standort/i.test(label)) continue
    // Keep the shortest route to each suggested facet, not every possible path.
    if (conditions.some((condition) => choices.find((p) => p.key === pathKey(condition.path))?.target.key === choice.target.key)) continue
    const targetField = /halle|hall\b/i.test(label)
      ? choice.target.properties.find((p) => /nummer|number/i.test(p.key))?.key ?? nameField(choice.target)
      : nameField(choice.target)
    if (targetField) conditions.push({ id: `rule-${conditions.length + 1}`, mode, path: choice.path, targetField, textFields: textDefaults(choice.target) })
  }
  const ownFields = scalarProperties(type).filter((p) => /^(name|title|titel|veranstaltungsart|event.?type)$/i.test(p.key))
  for (const field of ownFields) conditions.push({ id: `rule-${conditions.length + 1}`, mode: 'hard', path: [], targetField: field.key, textFields: textDefaults(type) })
  return {
    entityTypeKey: type.key, searchFields: textDefaults(type),
    answerFields: scalarProperties(type).map((p) => p.key), conditions,
  }
}

function defaults(catalog: RetrievalCatalog): RetrievalConfig {
  const mainTypes = catalog.entityTypes.filter((t) => !/branche|industry|produktgruppe|product.?group|halle|hall\b|kategorie|category/i.test(`${t.key} ${t.displayName}`))
  return { buckets: (mainTypes.length ? mainTypes : catalog.entityTypes.slice(0, 3)).map((t) => suggestedBucket(catalog, t)), threshold: catalog.defaults.threshold, answerFieldCharacters: 800 }
}

function readConfig(key: string, catalog: RetrievalCatalog): RetrievalConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as { version: number; config: RetrievalConfig } | null
    if (stored?.version !== 1 || !Array.isArray(stored.config.buckets)) return defaults(catalog)
    const buckets = stored.config.buckets.flatMap((bucket) => {
      const type = catalog.entityTypes.find((t) => t.key === bucket.entityTypeKey)
      if (!type) return []
      const choices = pathChoices(catalog, type)
      return [{ ...bucket,
        searchFields: bucket.searchFields.filter((f) => semanticProperties(type).some((p) => p.key === f)),
        answerFields: bucket.answerFields.filter((f) => scalarProperties(type).some((p) => p.key === f)),
        conditions: bucket.conditions.flatMap((condition) => {
          const choice = choices.find((p) => p.key === pathKey(condition.path))
          if (!choice || !['hard', 'soft'].includes(condition.mode) || !scalarProperties(choice.target).some((p) => p.key === condition.targetField)) return []
          return [{ ...condition, textFields: condition.textFields.filter((f) => semanticProperties(choice.target).some((p) => p.key === f)) }]
        }),
      }]
    })
    return { buckets, threshold: Math.max(-1, Math.min(1, Number.isFinite(stored.config.threshold) ? stored.config.threshold : catalog.defaults.threshold)),
      answerFieldCharacters: Math.max(100, Math.min(2000, stored.config.answerFieldCharacters ?? 800)) }
  } catch { return defaults(catalog) }
}

function Fields({ properties, selected, disabled, onChange }: {
  properties: RetrievalProperty[]; selected: string[]; disabled: boolean; onChange: (fields: string[]) => void
}) {
  return <div className="flex flex-wrap gap-x-5 gap-y-2">{properties.map((property) =>
    <label key={property.key} className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={selected.includes(property.key)} disabled={disabled}
        onCheckedChange={(checked) => onChange(checked === true ? [...selected, property.key] : selected.filter((f) => f !== property.key))} />
      {property.displayName}
    </label>,
  )}</div>
}

function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">–</span>
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value).slice(0, 16000)}</span>
  if (depth > 3) return <span>Further details truncated</span>
  if (Array.isArray(value)) return <ul className="space-y-1">{value.slice(0, 30).map((v, i) => <li key={i}><Value value={v} depth={depth + 1} /></li>)}</ul>
  return <dl className="space-y-1">{Object.entries(value).slice(0, 30).map(([key, v]) => <div key={key} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-3"><dt className="text-muted-foreground">{key}</dt><dd className="min-w-0"><Value value={v} depth={depth + 1} /></dd></div>)}</dl>
}

function Inspection({ meta, catalog }: { meta: RetrievalMeta; catalog: RetrievalCatalog }) {
  return <details className="mt-3 rounded-md border bg-muted/20 p-3 text-xs">
    <summary className="cursor-pointer font-medium">Inspect retrieval, timings and model calls</summary>
    <div className="mt-3 space-y-4">
      {meta.limitations?.map((text, i) => <p key={i} className="rounded border border-amber-500/30 p-2">{text}</p>)}
      {meta.results?.map((bucket) => <section key={bucket.entityTypeKey}>
        <h4 className="font-medium">{catalog.entityTypes.find((t) => t.key === bucket.entityTypeKey)?.displayName ?? bucket.entityTypeKey}: {bucket.totalHardMatches} after hard conditions · {bucket.totalAccepted} accepted · {bucket.omitted} omitted</h4>
        {bucket.items.map((item) => <details key={item.id} className="mt-2 rounded border p-2">
          <summary className="cursor-pointer">{String(item.fields.name ?? item.fields.title ?? item.id)} · {item.score === null ? 'exact match' : `Similarity ${item.score.toFixed(3)}`}</summary>
          <div className="mt-2 space-y-2"><p className="text-muted-foreground">Evidence ID: {item.id}</p><Value value={item.fields} /><Value value={item.relations} />{item.sources && <details><summary className="cursor-pointer">Candidate sources and scores</summary><div className="mt-2"><Value value={item.sources} /></div></details>}</div>
        </details>)}
      </section>)}
      {meta.timings && <><dl className="grid grid-cols-2 gap-x-6 gap-y-1">{Object.entries(meta.timings).map(([key, ms]) => <div key={key} className="flex justify-between gap-3"><dt>{phaseNames[key] ?? key}</dt><dd>{ms < 1000 ? `${ms.toFixed(3)} ms` : `${(ms / 1000).toFixed(2)} s`}</dd></div>)}</dl><p className="text-muted-foreground">Phases contain subphases; do not add these durations.</p></>}
      <p>Language model calls: {meta.llmCalls ?? '–'} · Embedding requests: {meta.embeddingRequests ?? '–'} · Reused texts: {meta.cacheHits ?? '–'}</p>
      {meta.plan !== undefined && <details><summary className="cursor-pointer">Validated question plan</summary><div className="mt-2"><Value value={meta.plan} /></div></details>}
      {meta.modelIO?.map((call, i) => <details key={i}><summary className="cursor-pointer">{call.phase === 'plan' ? 'Planner' : 'Response'}: input, output and available tokens</summary>
        <div className="mt-2 space-y-3">{call.systemPrompt !== undefined && <><h5>System instructions</h5><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border p-2">{call.systemPrompt}</pre></>}
          <h5>User/context input</h5>{call.inputTruncated && <p className="text-amber-600">Input trace is truncated; the model received the full input.</p>}<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border p-2">{call.input}</pre>
          <h5>Output</h5>{call.outputTruncated && <p className="text-amber-600">Output trace is truncated.</p>}<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border p-2">{call.output}</pre>{call.finishReason && <p>Finish reason: {call.finishReason}</p>}<Value value={call.usage} /></div>
      </details>)}
    </div>
  </details>
}

function RetrieverEditor({ ontologyKey, lensKey, catalog }: { ontologyKey: string; lensKey: string; catalog: RetrievalCatalog }) {
  const storageKey = `ontoforge:retriever-v2:${ontologyKey}:${lensKey}`
  const [config, setConfig] = useState(() => readConfig(storageKey, catalog))
  const [selectedType, setSelectedType] = useState(config.buckets[0]?.entityTypeKey ?? '')
  const [step, setStep] = useState(1)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<'prepare' | 'chat' | null>(null)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [prepared, setPrepared] = useState<RetrievalPreparation | null>(null)
  const [profile, setProfile] = useState<RetrieverProfile | null>(null)
  const [preview, setPreview] = useState(false)
  const [managementBusy, setManagementBusy] = useState(false)
  const [repairReviewed, setRepairReviewed] = useState(false)
  const active = useRef<AbortController | null>(null)
  const turnToken = useRef<string | undefined>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const busy = pending !== null || managementBusy
  const unsupported = profile !== null && (profile.configVersion !== 1 || !editableRetrievalConfig(profile.config))
  const hideEditor = unsupported && !repairReviewed
  const dirty = profile !== null && (JSON.stringify(profile.config) !== JSON.stringify(config) || (unsupported && repairReviewed))
  const execution = retrieverExecution(profile, config, preview, repairReviewed)
  const bucket = config.buckets.find((b) => b.entityTypeKey === selectedType) ?? config.buckets[0]
  const type = catalog.entityTypes.find((t) => t.key === bucket?.entityTypeKey)
  const paths = useMemo(() => type ? pathChoices(catalog, type) : [], [catalog, type])
  const valid = config.buckets.length > 0 && config.buckets.every((b) => b.searchFields.length > 0 && b.answerFields.length > 0 && b.conditions.every((r) => r.mode === 'hard' || r.textFields.length > 0))

  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [turns, phase])

  function persist(next: RetrievalConfig) {
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, config: next })); setStorageError(false) }
    catch { setStorageError(true) }
  }
  function update(next: RetrievalConfig) {
    setConfig(next); if (!profile) persist(next); setPreview(false); setPrepared(null); setError(''); setTurns([]); setPhase(''); turnToken.current = undefined
  }
  function selectProfile(next: RetrieverProfile | null, draft?: RetrievalConfig) {
    active.current?.abort(); active.current = null; setPending(null)
    const nextConfig = next ? editableRetrievalConfig(next.config) ? next.config : defaults(catalog) : draft ?? readConfig(storageKey, catalog)
    setProfile(next); setConfig(nextConfig); setSelectedType(nextConfig.buckets[0]?.entityTypeKey ?? ''); setPreview(false)
    setRepairReviewed(false)
    setPrepared(null); setTurns([]); setPhase(''); setError(''); turnToken.current = undefined
    if (!next && draft) persist(draft)
  }
  function updateBucket(next: RetrievalBucket) { update({ ...config, buckets: config.buckets.map((b) => b.entityTypeKey === next.entityTypeKey ? next : b) }) }
  function updateCondition(index: number, change: Partial<RetrievalCondition>) {
    if (bucket) updateBucket({ ...bucket, conditions: bucket.conditions.map((c, i) => i === index ? { ...c, ...change } : c) })
  }
  function cancel() { active.current?.abort() }
  async function prepare() {
    if (!valid || execution.mode === 'blocked' || busy || active.current) return
    const controller = new AbortController(); active.current = controller
    if (execution.mode === 'draft' && !profile) persist(config)
    setPending('prepare'); setPhase('Preparing search texts and relation context …'); setError('')
    try {
      const result = execution.mode === 'saved' ? await prepareSavedRetriever(ontologyKey, lensKey, execution.key, controller.signal) : await prepareRetrieval(ontologyKey, lensKey, config, controller.signal)
      if (active.current === controller && !controller.signal.aborted) { setPrepared(result); setPhase('Search index ready') }
    } catch (err) {
      if (active.current === controller) { setError(controller.signal.aborted ? 'Preparation cancelled.' : err instanceof Error ? err.message : 'Preparation failed.'); setPhase('') }
    } finally { if (active.current === controller) { active.current = null; setPending(null) } }
  }
  async function send() {
    const question = input.trim()
    if (!valid || execution.mode === 'blocked' || !question || busy || active.current) return
    const controller = new AbortController(); active.current = controller
    if (execution.mode === 'draft' && !profile) persist(config)
    const history = turns.filter((t) => t.status === 'complete').slice(-4).flatMap((t) => [{ role: 'user' as const, content: t.question.slice(0, 2000) }, { role: 'assistant' as const, content: t.reply.slice(0, 2000) }])
    let turn: Turn = { id: crypto.randomUUID(), question, reply: '', status: 'pending', meta: {} }
    let nextToken: string | undefined
    const previous = turns.slice(-9)
    const save = () => { if (active.current === controller) setTurns([...previous, turn]) }
    setPending('chat'); setPhase('Starting retrieval …'); setError(''); setInput(''); save()
    try {
      const onEvent = (event: RetrievalEvent) => {
        if (active.current !== controller || controller.signal.aborted) return
        switch (event.type) {
          case 'phase': setPhase(`${phaseNames[event.phase] ?? event.phase}${event.status === 'start' ? ' …' : ' completed'}`); break
          case 'delta': turn = { ...turn, reply: turn.reply + event.text }; break
          case 'meta': if (event.turnToken) nextToken = event.turnToken; turn = { ...turn, meta: { ...turn.meta, ...event,
            timings: { ...turn.meta.timings, ...event.timings },
            modelIO: event.modelIO ? [...(turn.meta.modelIO ?? []).filter((call) => !event.modelIO?.some((next) => next.phase === call.phase)), ...event.modelIO] : turn.meta.modelIO,
            limitations: [...new Set([...(turn.meta.limitations ?? []), ...(event.limitations ?? [])])],
          } }; break
          case 'final': turn = { ...turn, reply: event.reply, status: 'complete' }; turnToken.current = nextToken; setPhase('Answer complete'); break
          case 'error': turn = { ...turn, status: 'failed', error: event.error.message }; setPhase('Retrieval failed'); break
        }
        save()
      }
      const body = { message: question, history, turnToken: turnToken.current }
      if (execution.mode === 'saved') await chatSavedRetriever(ontologyKey, lensKey, execution.key, body, onEvent, controller.signal)
      else await chatRetrieval(ontologyKey, lensKey, { ...body, config }, onEvent, controller.signal)
    } catch (err) {
      if (active.current === controller) { turn = { ...turn, status: 'failed', error: controller.signal.aborted ? 'Cancelled. This incomplete answer will not be used as conversation context.' : err instanceof Error ? err.message : 'Retrieval failed.' }; save(); setPhase('') }
    } finally { if (active.current === controller) { active.current = null; setPending(null) } }
  }

  return <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
    <aside className="max-h-[45%] w-full shrink-0 overflow-y-auto border-b p-4 lg:max-h-none lg:w-[420px] lg:border-r lg:border-b-0">
      <div className="mb-4"><h2 className="font-semibold">Configure retriever</h2><p className="mt-1 text-xs text-muted-foreground">Select a lens-local saved profile or try an explicit browser draft.</p></div>
      <RetrieverProfiles key={`${profile?.retrieverConfigId ?? 'draft'}:${profile?.updatedAt ?? ''}`} ontologyKey={ontologyKey} lensKey={lensKey} config={config} profile={profile} dirty={dirty} disabled={pending !== null} repairReviewed={repairReviewed} onSelect={selectProfile} onConfig={(next) => { update(next); setRepairReviewed(true) }} onBusy={setManagementBusy} />
      {dirty && !hideEditor && <div className="mb-4 space-y-2 rounded border border-amber-500/30 p-3 text-xs"><p>Your edits are not saved. {preview ? 'Draft preview is active; the saved server profile is excluded from this run.' : 'Save them, or explicitly choose draft preview.'}</p><Button size="sm" variant="outline" disabled={busy || preview} onClick={() => { setPreview(true); setPrepared(null); setTurns([]); setPhase(''); turnToken.current = undefined }}>Preview draft changes</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => selectProfile(profile)}>Discard edits</Button></div>}
      {!hideEditor && <>
      {config.buckets.filter((item) => !catalog.entityTypes.some((candidate) => candidate.key === item.entityTypeKey)).map((item) => <div key={item.entityTypeKey} className="mb-3 rounded border border-destructive/30 p-3 text-xs"><p className="text-destructive">Result type {item.entityTypeKey} is not visible in this lens. Its configuration has been preserved.</p><Button size="sm" variant="outline" disabled={busy} onClick={() => update({ ...config, buckets: config.buckets.filter((candidate) => candidate !== item) })}>Remove unavailable bucket</Button></div>)}
      <div className="mb-4 flex gap-1">{['Find', 'Search', 'Answer'].map((label, i) => <Button key={label} variant={step === i + 1 ? 'secondary' : 'ghost'} size="sm" onClick={() => setStep(i + 1)} className="flex-1 px-1 text-xs">{i + 1}. {label}</Button>)}</div>
      {step === 1 ? <section className="space-y-4">
        <p className="text-sm text-muted-foreground">Each selected type has its own result bucket. Reference data can help retrieval without appearing as a result.</p>
        <div className="grid grid-cols-2 gap-2">{catalog.entityTypes.map((t) => <label key={t.key} className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm">
          <Checkbox checked={config.buckets.some((b) => b.entityTypeKey === t.key)} disabled={busy} onCheckedChange={(checked) => {
            const buckets = checked === true ? [...config.buckets, suggestedBucket(catalog, t)] : config.buckets.filter((b) => b.entityTypeKey !== t.key)
            update({ ...config, buckets }); if (checked === true) setSelectedType(t.key)
          }} />{t.displayName}
        </label>)}</div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { const next = defaults(catalog); update(next); setSelectedType(next.buckets[0]?.entityTypeKey ?? '') }}>Use schema suggestion</Button>
        <p className="text-xs text-muted-foreground">The suggestion recognises common names and relations. Review it in step 2; it does not set a fixed hall or industry.</p>
        <Button size="sm" onClick={() => setStep(2)} disabled={!config.buckets.length}>Configure search</Button>
      </section> : <section className="space-y-4">
        <label className="block space-y-1 text-sm"><span>Edit result bucket</span><select className={`${selectClass} w-full`} value={bucket?.entityTypeKey ?? ''} disabled={busy || !config.buckets.length} onChange={(e) => setSelectedType(e.target.value)}>
          {config.buckets.map((b) => <option key={b.entityTypeKey} value={b.entityTypeKey}>{catalog.entityTypes.find((t) => t.key === b.entityTypeKey)?.displayName ?? b.entityTypeKey}</option>)}
        </select></label>
        {bucket && type && (step === 2 ? <>
          <div className="space-y-2"><h3 className="text-sm font-medium">Search text and ranking</h3><Fields properties={semanticProperties(type)} selected={bucket.searchFields} disabled={busy} onChange={(searchFields) => updateBucket({ ...bucket, searchFields })} />
            <p className="text-xs text-muted-foreground">Only these contents are embedded for semantic retrieval and final ranking. Descriptions help find topics; location text may distract from relevance.</p></div>
          <div className="space-y-2"><h3 className="text-sm font-medium">Allowed question conditions</h3><p className="text-xs text-muted-foreground">“Must match” checks exact values. “By meaning” considers related terms. A rule alone does not filter anything: a relevant question activates it.</p>
            {bucket.conditions.map((condition, i) => {
              const choice = paths.find((p) => p.key === pathKey(condition.path))
              if (!choice) return <div key={condition.id} className="rounded border border-destructive/30 p-3 text-xs"><p className="text-destructive">Condition {condition.id} refers to a path that is no longer visible. It has been preserved for repair.</p><Button size="sm" variant="outline" disabled={busy} onClick={() => updateBucket({ ...bucket, conditions: bucket.conditions.filter((_, index) => index !== i) })}>Remove unavailable condition</Button></div>
              return <div key={condition.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-start gap-2"><div className="min-w-0 flex-1 text-sm font-medium">{choice.label}<p className="mt-1 text-xs font-normal text-muted-foreground">{condition.path.map((p) => catalog.relationTypes.find((r) => r.key === p.relationTypeKey)?.displayName ?? p.relationTypeKey).join(' · ') || 'Property of this result'}</p></div>
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={`Remove condition ${choice.label}`} className="size-6" onClick={() => updateBucket({ ...bucket, conditions: bucket.conditions.filter((_, n) => n !== i) })}><Trash2 className="size-3.5" /></Button></div>
                <div className="flex gap-2"><select aria-label={`Search mode ${choice.label}`} className={`${selectClass} min-w-0 flex-1`} value={condition.mode} disabled={busy} onChange={(e) => updateCondition(i, { mode: e.target.value as 'hard' | 'soft' })}><option value="hard">Must match (exact)</option><option value="soft">By meaning</option></select>
                  {condition.mode === 'hard' && <label className="min-w-0 flex-1 space-y-1 text-xs"><span>Compare field</span><select aria-label={`Comparison field ${choice.label}`} className={`${selectClass} w-full`} value={condition.targetField} disabled={busy} onChange={(e) => updateCondition(i, { targetField: e.target.value })}>{scalarProperties(choice.target).map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}</select></label>}</div>
                {condition.mode === 'soft' ? <><Fields properties={semanticProperties(choice.target)} selected={condition.textFields} disabled={busy} onChange={(textFields) => updateCondition(i, { textFields })} /><p className="text-xs text-muted-foreground">These category texts provide additional candidates and contribute to their ranking.</p></> : <p className="text-xs text-muted-foreground">{condition.path.length ? `When asked, the linked ${choice.target.displayName} must match exactly.` : 'When asked, this field must match exactly.'} Compare field selects the actual value to check, not an embedding field.</p>}
              </div>
            })}
            <details className="rounded border p-3 text-sm"><summary className="cursor-pointer">Add another condition</summary><div className="mt-3 space-y-2"><label className="block text-xs">Select relation path<select className={`${selectClass} mt-1 w-full`} disabled={busy} value="" onChange={(e) => {
              const choice = paths.find((p) => (p.key || '__self') === e.target.value)
              if (!choice) return
              const targetField = nameField(choice.target)
              if (targetField) updateBucket({ ...bucket, conditions: [...bucket.conditions, { id: crypto.randomUUID(), path: choice.path, mode: 'hard', targetField, textFields: textDefaults(choice.target) }] })
            }}><option value="">Select a relation or a result property …</option>{paths.map((p) => <option key={p.key} value={p.key || '__self'}>{p.label}</option>)}</select></label><p className="text-xs text-muted-foreground">Up to two relations; then choose the comparison field and mode.</p></div></details>
          </div>
          <label className="block space-y-2 text-sm"><span className="font-medium">Similarity threshold: {config.threshold.toFixed(2)}</span><input className="w-full accent-primary" type="range" min="-1" max="1" step="0.05" disabled={busy} value={config.threshold} onChange={(e) => update({ ...config, threshold: Number(e.target.value) })} /><span className="block text-xs text-muted-foreground">Scale −1 to 1. Higher = fewer semantic results. This does not prove correctness. Exact lists are not shortened by this threshold.</span></label>
          <Button size="sm" onClick={() => setStep(3)}>Configure answer</Button>
        </> : <>
          <div className="space-y-2"><h3 className="text-sm font-medium">Answer fields</h3><Fields properties={scalarProperties(type)} selected={bucket.answerFields} disabled={busy} onChange={(answerFields) => updateBucket({ ...bucket, answerFields })} /><p className="text-xs text-muted-foreground">Only selected values are passed to the response phase as evidence. Search fields may differ. IDs and allowed relation evidence remain traceable.</p></div>
          <label className="block space-y-2 text-sm"><span>Maximum characters per answer field</span><Input type="number" min={100} max={2000} step={100} disabled={busy} value={config.answerFieldCharacters ?? 800} onChange={(e) => update({ ...config, answerFieldCharacters: Math.max(100, Math.min(2000, Number(e.target.value) || 100)) })} /><span className="block text-xs text-muted-foreground">Long contents are truncated. Result context: at most {catalog.limits.contextCharacters.toLocaleString('en-US')} characters. Truncation is disclosed with the evidence.</span></label>
          <p className="text-xs text-muted-foreground">Answers use available facts. There are two language model calls: planning the question and writing the response. Embeddings determine ranking.</p>
        </>)}
      </section>}
      </>}
      <div className="mt-5 space-y-2 border-t pt-4"><p className="text-xs text-muted-foreground">{!hideEditor && (config.buckets.map((b) => catalog.entityTypes.find((t) => t.key === b.entityTypeKey)?.displayName).join(' · ') || 'No result bucket selected')} {!hideEditor && `· Threshold ${config.threshold.toFixed(2)}`}</p>
        {!valid && <p className="text-xs text-destructive">Select result buckets with at least one search and answer field. Soft conditions need reference text.</p>}
        {execution.mode === 'blocked' && <p role="alert" className="text-xs text-destructive">{execution.reason}</p>}
        <Button className="w-full" variant="outline" disabled={busy || !valid || execution.mode === 'blocked'} onClick={prepare}>{pending === 'prepare' ? <LoaderCircle className="size-4 animate-spin" /> : prepared ? <Check className="size-4" /> : <Plus className="size-4" />}{prepared ? 'Prepare again' : 'Prepare search index'}</Button>
        <p className="text-xs text-muted-foreground">Preparation does not change database data. Each question checks data freshness again.</p>
        {prepared && <p className="text-xs">Ready: {prepared.entityCount} entities, {prepared.relationCount} relations · {prepared.embeddingRequests} embedding requests, {prepared.cacheHits} texts reused.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {storageError && <p role="alert" className="text-xs text-destructive">The browser could not save settings. They apply until you leave this tab.</p>}
      </div>
    </aside>
    <section className="flex min-h-[440px] min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-sm font-medium">Questions for {profile?.name ?? 'the browser draft'}</h2><p className="mt-1 text-xs text-muted-foreground">{execution.mode === 'saved' ? `Server configuration: ${lensKey} / ${execution.key}` : execution.mode === 'draft' ? 'Draft preview · unsaved request configuration' : 'Unsaved or invalid configuration · execution blocked'}</p></div><Button size="sm" variant="ghost" disabled={busy || !turns.length} onClick={() => { setTurns([]); setPhase(''); turnToken.current = undefined }}>New conversation</Button></div>
      <div ref={scroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {!turns.length && <div className="mx-auto max-w-lg py-12 text-sm text-muted-foreground"><h3 className="mb-2 text-base font-medium text-foreground">Configure, prepare, ask</h3><p>Choose result types and contents on the left. Exact conditions narrow the search; descriptions help with related terms.</p><p className="mt-3">Ask about a topic, an exact assignment, or both. Follow-up questions refer to completed answers in this conversation.</p></div>}
        {turns.map((turn) => <article key={turn.id} className="mx-auto max-w-3xl space-y-3"><div className="ml-auto max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{turn.question}</div>
          <div className="text-sm">{turn.reply ? <Markdown>{turn.reply}</Markdown> : turn.status === 'pending' ? <span className="text-muted-foreground">Retrieval in progress …</span> : null}
            {turn.error && <p role="alert" className="mt-2 text-destructive">{turn.error}</p>}
            {Object.keys(turn.meta).length > 0 && <Inspection meta={turn.meta} catalog={catalog} />}
          </div></article>)}
      </div>
      <div className="space-y-2 border-t p-4"><div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground" role="status">{busy && <LoaderCircle className="size-3 animate-spin" />}{phase}{busy && <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={cancel}><Square className="size-3" />Cancel</Button>}</div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}><Textarea aria-label="Question for the retriever" placeholder="What would you like to find?" value={input} disabled={busy} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /><Button type="submit" aria-label="Send question" disabled={busy || !valid || execution.mode === 'blocked' || !input.trim()}><SendHorizonal className="size-4" /></Button></form>
        <p className="text-xs text-muted-foreground">Enter sends · Shift+Enter adds a line. Context: last four completed pairs, at most 2000 characters per message. Changing settings starts a new conversation.</p>
      </div>
    </section>
  </div>
}

export function RetrievalPrototypeTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const catalog = useQuery({ queryKey: ['retriever-catalog', ontologyKey, lensKey], queryFn: () => retrievalCatalog(ontologyKey, lensKey), retry: false })
  if (catalog.isPending) return <div className="space-y-3 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full" /></div>
  if (catalog.error || !catalog.data) return <div className="p-6 text-sm"><p role="alert">Could not load retriever: {catalog.error instanceof Error ? catalog.error.message : 'No schema available.'}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void catalog.refetch()}>Reload</Button></div>
  return <RetrieverEditor key={`${ontologyKey}/${lensKey}`} ontologyKey={ontologyKey} lensKey={lensKey} catalog={catalog.data} />
}
