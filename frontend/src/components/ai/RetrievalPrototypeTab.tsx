import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Check, LoaderCircle, PanelLeftClose, Plus, SendHorizonal, Settings2, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  retrievalCatalog,
  type RetrievalBucket, type RetrievalCatalog, type RetrievalCondition, type RetrievalConfig,
  type RetrievalEvent, type RetrievalMeta, type RetrievalPathStep, type RetrievalPreparation, type RetrievalProperty, type RetrievalType,
} from '@/api/retrievalPrototype'
import { Markdown } from '@/components/ai/Markdown'
import { RetrievalDiagnostics } from '@/components/ai/RetrievalDiagnostics'
import { phaseNames } from './retrievalPhases'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ApiError } from '@/api/http'
import { chatSavedRetriever, importRetriever, listRetrievers, prepareSavedRetriever, saveRetriever, type RetrieverProfile } from '@/api/retrievers'
import { NameKeyDialog, RetrieverDetails, RetrieverMore, RetrieverPicker, RetrieverSaveBar } from './RetrieverProfiles'
import { editableRetrievalConfig, retrieverExecution } from './retrieverProfileState'

const diagnosticsKey = 'ontoforge.retriever.diagnostics'
const configOpenKey = 'ontoforge.retriever.configOpen'

function readStored(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* the choice applies until the tab is left */ }
}
const errorText = (error: unknown) => error instanceof ApiError && error.details ? `${error.message}\n${JSON.stringify(error.details, null, 2)}` : error instanceof Error ? error.message : 'Retriever operation failed.'

type PathChoice = { key: string; path: RetrievalPathStep[]; label: string; target: RetrievalType }
type Turn = { id: string; question: string; reply: string; status: 'pending' | 'complete' | 'failed'; error?: string; meta: RetrievalMeta }
const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'
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

function RetrieverEditor({ ontologyKey, lensKey, catalog }: { ontologyKey: string; lensKey: string; catalog: RetrievalCatalog }) {
  const [config, setConfig] = useState(() => defaults(catalog))
  const [selectedType, setSelectedType] = useState(config.buckets[0]?.entityTypeKey ?? '')
  const [step, setStep] = useState(1)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<'prepare' | 'chat' | null>(null)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<RetrievalPreparation | null>(null)
  const [profile, setProfile] = useState<RetrieverProfile | null>(null)
  const [managementBusy, setManagementBusy] = useState(false)
  const [repairReviewed, setRepairReviewed] = useState(false)
  const [diagnostics, setDiagnostics] = useState(() => readStored(diagnosticsKey) === 'true')
  const [configOpen, setConfigOpen] = useState(() => readStored(configOpenKey) !== 'false')
  const [inspected, setInspected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saveError, setSaveError] = useState('')
  const [dialog, setDialog] = useState<'new' | 'copy' | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [pendingSwitch, setPendingSwitch] = useState<RetrieverProfile | null>(null)
  const client = useQueryClient()
  const profilesKey = ['retrievers', ontologyKey, lensKey]
  const profiles = useQuery({ queryKey: profilesKey, queryFn: () => listRetrievers(ontologyKey, lensKey), retry: false })
  const selectedKey = `ontoforge:retriever:selected:${ontologyKey}:${lensKey}`
  const active = useRef<AbortController | null>(null)
  const turnToken = useRef<string | undefined>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const busy = pending !== null || managementBusy
  const unsupported = profile !== null && (profile.configVersion !== 1 || !editableRetrievalConfig(profile.config))
  const hideEditor = unsupported && !repairReviewed
  const dirty = profile !== null && (JSON.stringify(profile.config) !== JSON.stringify(config) || (unsupported && repairReviewed) || name !== profile.name || description !== (profile.description ?? ''))
  const bucket = config.buckets.find((b) => b.entityTypeKey === selectedType) ?? config.buckets[0]
  const type = catalog.entityTypes.find((t) => t.key === bucket?.entityTypeKey)
  const paths = useMemo(() => type ? pathChoices(catalog, type) : [], [catalog, type])
  const withMeta = turns.filter((t) => Object.keys(t.meta).length > 0)
  const inspectedTurn = withMeta.find((t) => t.id === inspected) ?? withMeta.at(-1)
  // One rule for every unsaved change, configuration or name: questions wait until it is saved or discarded.
  const execution = dirty ? { mode: 'blocked' as const, reason: 'Unsaved changes. Save or discard them before asking.' } : retrieverExecution(profile, config, repairReviewed)
  const existingKeys = profiles.data?.map((item) => item.key) ?? []
  const showConfig = configOpen && profile !== null
  const valid = config.buckets.length > 0 && config.buckets.every((b) => b.searchFields.length > 0 && b.answerFields.length > 0 && b.conditions.every((r) => r.mode === 'hard' || r.textFields.length > 0))

  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [turns, phase])
  // Always run a saved retriever: the remembered one, else the first. Deleting one falls back the same way.
  if (profiles.data && (profile === null ? profiles.data.length > 0 : !profiles.data.some((item) => item.key === profile.key))) {
    const remembered = readStored(selectedKey)
    selectProfile(profiles.data.find((item) => item.key === remembered) ?? profiles.data[0] ?? null)
  }

  function update(next: RetrievalConfig) {
    setConfig(next); setPrepared(null); setError(''); setTurns([]); setPhase(''); turnToken.current = undefined
  }
  function selectProfile(next: RetrieverProfile | null) {
    active.current?.abort(); active.current = null; setPending(null)
    const nextConfig = next && editableRetrievalConfig(next.config) ? next.config : defaults(catalog)
    setProfile(next); setConfig(nextConfig); setSelectedType(nextConfig.buckets[0]?.entityTypeKey ?? '')
    setName(next?.name ?? ''); setDescription(next?.description ?? ''); setSaveError('')
    setRepairReviewed(false)
    setPrepared(null); setTurns([]); setPhase(''); setError(''); turnToken.current = undefined
    if (next) writeStored(selectedKey, next.key)
  }
  function choose(key: string) {
    const next = profiles.data?.find((item) => item.key === key)
    if (!next || next.key === profile?.key) return
    if (dirty) setPendingSwitch(next); else selectProfile(next)
  }
  async function refreshProfiles() { await client.invalidateQueries({ queryKey: profilesKey }) }
  async function save() {
    if (!profile || busy) return
    setManagementBusy(true); setSaveError('')
    try {
      const next = await saveRetriever(ontologyKey, lensKey, profile.key, { name: name.trim(), description: description.trim() || null, configVersion: 1, config })
      await refreshProfiles(); selectProfile(next)
    } catch (reason) { setSaveError(errorText(reason)) } finally { setManagementBusy(false) }
  }
  /** New starts from the schema suggestion; Save as copy takes the current editor state, unsaved changes included. */
  async function create(newName: string, key: string) {
    const copy = dialog === 'copy'
    setDialogBusy(true); setDialogError('')
    try {
      const next = await importRetriever(ontologyKey, lensKey, { key, name: newName, description: copy ? description.trim() || null : null, configVersion: 1, config: copy ? config : defaults(catalog) })
      await refreshProfiles(); selectProfile(next); setDialog(null); openConfig(true)
    } catch (reason) { setDialogError(errorText(reason)) } finally { setDialogBusy(false) }
  }
  function updateBucket(next: RetrievalBucket) { update({ ...config, buckets: config.buckets.map((b) => b.entityTypeKey === next.entityTypeKey ? next : b) }) }
  function updateCondition(index: number, change: Partial<RetrievalCondition>) {
    if (bucket) updateBucket({ ...bucket, conditions: bucket.conditions.map((c, i) => i === index ? { ...c, ...change } : c) })
  }
  function toggleDiagnostics(next: boolean) { setDiagnostics(next); writeStored(diagnosticsKey, String(next)) }
  function openConfig(next: boolean) { setConfigOpen(next); writeStored(configOpenKey, String(next)) }
  function cancel() { active.current?.abort() }
  async function prepare() {
    if (!valid || execution.mode === 'blocked' || busy || active.current) return
    const controller = new AbortController(); active.current = controller
    setPending('prepare'); setPhase('Preparing search texts and relation context …'); setError('')
    try {
      const result = await prepareSavedRetriever(ontologyKey, lensKey, execution.key, controller.signal)
      if (active.current === controller && !controller.signal.aborted) { setPrepared(result); setPhase('Search index ready') }
    } catch (err) {
      if (active.current === controller) { setError(controller.signal.aborted ? 'Preparation cancelled.' : err instanceof Error ? err.message : 'Preparation failed.'); setPhase('') }
    } finally { if (active.current === controller) { active.current = null; setPending(null) } }
  }
  async function send() {
    const question = input.trim()
    if (!valid || execution.mode === 'blocked' || !question || busy || active.current) return
    const controller = new AbortController(); active.current = controller
    const history = turns.filter((t) => t.status === 'complete').slice(-4).flatMap((t) => [{ role: 'user' as const, content: t.question.slice(0, 2000) }, { role: 'assistant' as const, content: t.reply.slice(0, 2000) }])
    let turn: Turn = { id: crypto.randomUUID(), question, reply: '', status: 'pending', meta: {} }
    let nextToken: string | undefined
    const previous = turns.slice(-9)
    const save = () => { if (active.current === controller) setTurns([...previous, turn]) }
    setPending('chat'); setPhase('Starting retrieval …'); setError(''); setInput(''); setInspected(null); save()
    try {
      const onEvent = (event: RetrievalEvent) => {
        if (active.current !== controller || controller.signal.aborted) return
        switch (event.type) {
          case 'phase': setPhase(`${phaseNames[event.phase] ?? event.phase}${event.status === 'start' ? ' …' : ' completed'}`); break
          case 'delta': turn = { ...turn, reply: turn.reply + event.text }; break
          case 'meta': {
            // The follow-up token arrives in every stream; everything else only when diagnostics were requested.
            const { turnToken: token, ...data } = event
            if (token) nextToken = token
            if (Object.keys(data).some((key) => key !== 'type')) turn = { ...turn, meta: { ...turn.meta, ...data,
              timings: { ...turn.meta.timings, ...data.timings },
              modelIO: data.modelIO ? [...(turn.meta.modelIO ?? []).filter((call) => !data.modelIO?.some((next) => next.phase === call.phase)), ...data.modelIO] : turn.meta.modelIO,
              limitations: [...new Set([...(turn.meta.limitations ?? []), ...(data.limitations ?? [])])],
            } }
            break
          }
          case 'final': turn = { ...turn, reply: event.reply, status: 'complete' }; turnToken.current = nextToken; setPhase('Answer complete'); break
          case 'error': turn = { ...turn, status: 'failed', error: event.error.message }; setPhase('Retrieval failed'); break
        }
        save()
      }
      const body = { message: question, history, turnToken: turnToken.current, diagnostics }
      await chatSavedRetriever(ontologyKey, lensKey, execution.key, body, onEvent, controller.signal)
    } catch (err) {
      if (active.current === controller) { turn = { ...turn, status: 'failed', error: controller.signal.aborted ? 'Cancelled. This incomplete answer will not be used as conversation context.' : err instanceof Error ? err.message : 'Retrieval failed.' }; save(); setPhase('') }
    } finally { if (active.current === controller) { active.current = null; setPending(null) } }
  }

  // Container queries: the layout follows the width this tab really has, not the window width.
  return <div className="@container flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      <RetrieverPicker profiles={profiles.data} profile={profile} disabled={busy} onSelect={choose} onNew={() => { setDialogError(''); setDialog('new') }} />
      <Button size="sm" variant={showConfig ? 'secondary' : 'ghost'} className="h-8 gap-1" disabled={!profile} aria-pressed={showConfig} onClick={() => openConfig(!configOpen)}><Settings2 className="size-3.5" />Configure</Button>
      {profile && <span className={`text-xs ${dirty ? 'text-amber-600' : !profile.validation.valid ? 'text-destructive' : 'text-muted-foreground'}`}>{dirty ? 'Unsaved changes' : !profile.validation.valid ? 'Invalid in this lens' : 'Saved'}</span>}
      {profiles.error && <span role="alert" className="text-xs text-destructive">{errorText(profiles.error)} <button type="button" className="underline" onClick={() => void profiles.refetch()}>Reload</button></span>}
      <div className="ml-auto flex items-center gap-3"><label className="flex cursor-pointer items-center gap-2 text-xs" title="Stream the search plan, scores, timings and model calls with each answer"><Checkbox checked={diagnostics} onCheckedChange={(checked) => toggleDiagnostics(checked === true)} />Show diagnostics</label><Button size="sm" variant="ghost" disabled={busy || !turns.length} onClick={() => { setTurns([]); setPhase(''); turnToken.current = undefined }}>New conversation</Button></div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
    {showConfig && profile && <aside aria-label="Configuration" className="max-h-[45%] w-full shrink-0 overflow-y-auto border-b p-4 @2xl:max-h-none @2xl:w-[320px] @2xl:border-r @2xl:border-b-0 @5xl:w-[380px] @7xl:w-[420px]">
      <div className="mb-3 flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">Configure {profile.name}</h2><p className="mt-1 text-xs text-muted-foreground">What a question searches and which facts the answer may use.</p></div><Button size="icon" variant="ghost" className="size-7 shrink-0" aria-label="Close configuration" title="Close configuration" onClick={() => openConfig(false)}><PanelLeftClose className="size-4" /></Button></div>
      <RetrieverSaveBar dirty={dirty} canSave={valid && !hideEditor && !!name.trim()} busy={busy} onSave={() => void save()} onDiscard={() => selectProfile(profile)} onSaveAsCopy={() => { setDialogError(''); setDialog('copy') }} />
      {saveError && <p role="alert" className="mb-3 whitespace-pre-wrap break-words text-xs text-destructive">{saveError}</p>}
      {!profile.validation.valid && <div role="alert" className="mb-3 space-y-1 text-xs text-destructive"><p className="font-medium">Invalid in the current lens; questions are blocked until it is repaired and saved.</p><ul className="list-disc pl-4">{profile.validation.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {hideEditor && <p role="alert" className="mb-3 text-xs text-destructive">Unsupported configuration version or shape (version {profile.configVersion}). It is preserved under More → Configuration JSON, where you can export it or review it as version 1.</p>}
      <RetrieverDetails key={`${profile.key}:${profile.updatedAt}`} profile={profile} name={name} description={description} disabled={busy} onChange={(nextName, nextDescription) => { setName(nextName); setDescription(nextDescription) }} />
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
        {execution.mode === 'blocked' && !dirty && <p role="alert" className="text-xs text-destructive">{execution.reason}</p>}
        <Button className="w-full" variant="outline" disabled={busy || !valid || execution.mode === 'blocked'} onClick={prepare}>{pending === 'prepare' ? <LoaderCircle className="size-4 animate-spin" /> : prepared ? <Check className="size-4" /> : <Plus className="size-4" />}{prepared ? 'Prepare again' : 'Prepare search index'}</Button>
        <p className="text-xs text-muted-foreground">Preparation does not change database data. Each question checks data freshness again.</p>
        {prepared && <p className="text-xs">Ready: {prepared.entityCount} entities, {prepared.relationCount} relations · {prepared.embeddingRequests} embedding requests, {prepared.cacheHits} texts reused.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="mt-5"><RetrieverMore key={`${profile.key}:${profile.updatedAt}`} ontologyKey={ontologyKey} lensKey={lensKey} profile={profile} config={config} needsRepair={hideEditor} existingKeys={existingKeys} disabled={pending !== null} onBusy={setManagementBusy}
        onCreated={(next) => void refreshProfiles().then(() => selectProfile(next))} onDeleted={() => void refreshProfiles().then(() => selectProfile(null))} onConfig={(next) => { update(next); setRepairReviewed(true) }} /></div>
    </aside>}
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${showConfig ? '@6xl:flex-row' : '@2xl:flex-row'}`}>
    <section className="flex min-h-[440px] min-w-0 flex-1 flex-col">
      <div ref={scroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {profiles.data?.length === 0 && <div className="mx-auto max-w-lg py-12 text-sm text-muted-foreground"><h3 className="mb-2 text-base font-medium text-foreground">No retriever in this lens yet</h3><p>A retriever decides which records a question searches and which facts the answer may use. Create one, adjust it, save it, then ask.</p><Button size="sm" className="mt-4 gap-1" onClick={() => { setDialogError(''); setDialog('new') }}><Plus className="size-3.5" />Create retriever</Button></div>}
        {profile && !turns.length && <div className="mx-auto max-w-lg py-12 text-sm text-muted-foreground"><h3 className="mb-2 text-base font-medium text-foreground">Ask {profile.name}</h3>{profile.description && <p className="mb-3">{profile.description}</p>}<p>Ask about a topic, an exact assignment, or both. Follow-up questions refer to completed answers in this conversation.</p><p className="mt-3">Configure changes what is searched; changes apply once saved.</p></div>}
        {turns.map((turn) => <article key={turn.id} className="mx-auto max-w-3xl space-y-3"><div className="ml-auto max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{turn.question}</div>
          <div className="text-sm">{turn.reply ? <Markdown>{turn.reply}</Markdown> : turn.status === 'pending' ? <span className="text-muted-foreground">Retrieval in progress …</span> : null}
            {turn.error && <p role="alert" className="mt-2 text-destructive">{turn.error}</p>}
            {diagnostics && Object.keys(turn.meta).length > 0 && <Button size="sm" variant={turn.id === inspectedTurn?.id ? 'secondary' : 'ghost'} className="mt-2 h-6 gap-1.5 px-2 text-xs text-muted-foreground" aria-pressed={turn.id === inspectedTurn?.id} onClick={() => setInspected(turn.id)}><Activity className="size-3" />Diagnostics{turn.meta.timings?.total !== undefined && ` · ${(turn.meta.timings.total / 1000).toFixed(1)} s`}</Button>}
          </div></article>)}
      </div>
      <div className="space-y-2 border-t p-4">{profile && execution.mode === 'blocked' && <p className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{execution.reason}</p>}<div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground" role="status">{busy && <LoaderCircle className="size-3 animate-spin" />}{phase}{busy && <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={cancel}><Square className="size-3" />Cancel</Button>}</div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}><Textarea aria-label="Question for the retriever" placeholder="What would you like to find?" value={input} disabled={busy || !profile} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /><Button type="submit" aria-label="Send question" disabled={busy || !valid || execution.mode === 'blocked' || !input.trim()}><SendHorizonal className="size-4" /></Button></form>
        <p className="text-xs text-muted-foreground">Enter sends · Shift+Enter adds a line. Context: last four completed pairs, at most 2000 characters per message. Changing settings starts a new conversation.</p>
      </div>
    </section>
    {diagnostics && <aside aria-label="Diagnostics" className={`flex max-h-[60vh] min-h-[320px] w-full shrink-0 flex-col border-t ${!showConfig ? '@2xl:max-h-none @2xl:w-[320px] @2xl:border-t-0 @2xl:border-l @4xl:w-[400px] @7xl:w-[460px]' : '@6xl:max-h-none @6xl:w-[360px] @6xl:border-t-0 @6xl:border-l @7xl:w-[440px]'}`}>
      <div className="border-b px-4 py-3"><h2 className="text-sm font-medium">Diagnostics</h2><p className="mt-1 text-xs text-muted-foreground">How the selected answer was found. Pick another answer with its Diagnostics button.</p></div>
      {inspectedTurn ? <RetrievalDiagnostics key={inspectedTurn.id} meta={inspectedTurn.meta} question={inspectedTurn.question} config={config} catalog={catalog} />
        : <p className="p-4 text-xs text-muted-foreground">Ask a question. Its plan, ranked results, timings and model calls appear here while it runs.</p>}
    </aside>}
    </div>
    </div>
    {dialog && <NameKeyDialog open title={dialog === 'new' ? 'New retriever' : `Save ${profile?.name ?? ''} as copy`}
      description={dialog === 'new' ? `Starts from a suggestion for this schema and is saved right away; adjust it under Configure.${dirty ? ' Unsaved changes to the current retriever are discarded.' : ''}` : 'Saves the current configuration, unsaved changes included, as a new retriever. The original stays as last saved.'}
      confirmLabel={dialog === 'new' ? 'Create' : 'Save copy'} initialName={dialog === 'copy' && profile ? `${name.trim() || profile.name} copy` : ''} existingKeys={existingKeys}
      busy={dialogBusy} error={dialogError} onCancel={() => setDialog(null)} onConfirm={(newName, key) => void create(newName, key)} />}
    <AlertDialog open={pendingSwitch !== null} onOpenChange={(open) => { if (!open) setPendingSwitch(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>{profile?.name} has unsaved changes. Switching to {pendingSwitch?.name} discards them.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { if (pendingSwitch) selectProfile(pendingSwitch); setPendingSwitch(null) }}>Discard and switch</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

export function RetrievalPrototypeTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const catalog = useQuery({ queryKey: ['retriever-catalog', ontologyKey, lensKey], queryFn: () => retrievalCatalog(ontologyKey, lensKey), retry: false })
  if (catalog.isPending) return <div className="space-y-3 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full" /></div>
  if (catalog.error || !catalog.data) return <div className="p-6 text-sm"><p role="alert">Could not load retriever: {catalog.error instanceof Error ? catalog.error.message : 'No schema available.'}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void catalog.refetch()}>Reload</Button></div>
  return <RetrieverEditor key={`${ontologyKey}/${lensKey}`} ontologyKey={ontologyKey} lensKey={lensKey} catalog={catalog.data} />
}
