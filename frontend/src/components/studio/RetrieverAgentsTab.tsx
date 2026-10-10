import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BotMessageSquare, ChevronLeft, FileUp, Plus, SearchX } from 'lucide-react'
import { useBlocker, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures, useRetrieverAgents, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import { importRetrieverAgent, saveRetrieverAgent, type RetrieverAgent } from '@/api/retrieverAgents'
import type { Lens, RuntimeSchema, SearchCatalogEntry, ValidationError } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { RetrieverAgentChat } from '@/components/retrieverAgent/RetrieverAgentChat'
import { RetrieverAgentConfigEditor } from '@/components/retrieverAgent/RetrieverAgentConfigEditor'
import { RetrieverAgentRetrieve } from '@/components/retrieverAgent/RetrieverAgentRetrieve'
import { ImportDialog, NameKeyDialog, RetrieverAgentMore, RetrieverAgentSaveBar } from '@/components/retrieverAgent/RetrieverAgentManagement'
import { errorText } from '@/components/retrieverAgent/errorText'
import {
  agentExecution, asIssues, draftOf, draftProblems, emptyConfig, isSupportedAgent, sameDraft, toInput, type AgentDraft,
} from '@/components/retrieverAgent/retrieverAgentModel'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { ValidationPanel } from './ValidationPanel'

const TAB = 'retriever-agents'

/**
 * Lens detail → Retriever agents: the lens's agents (list), the editor of
 * one (`?agent=<key>`) and its test panel. A new agent is a draft until
 * its first Save.
 */
export function RetrieverAgentsTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const features = useFeatures().data
  const supported = features?.searchIndices === true
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get('agent')
  const [creating, setCreating] = useState<{ name: string; key: string } | null>(null)
  const [dialog, setDialog] = useState<'new' | 'import' | null>(null)
  const agents = useRetrieverAgents(ontologyKey, lens.key, supported)
  const catalog = useSearchCatalog(ontologyKey, lens.key, supported)
  const schema = useRuntimeSchema(ontologyKey, lens.key)
  const queryClient = useQueryClient()
  const existingKeys = agents.data?.map((a) => a.key) ?? []

  const select = (key: string | null) => {
    setCreating(null)
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, agent: key }, { replace: true })
  }
  // The Workbench's runtime list follows the modeling list.
  const refresh = () => Promise.all([qk.retrieverAgents(ontologyKey, lens.key), qk.assistants(ontologyKey, lens.key, 'retrievers')]
    .map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  if (features?.searchIndices === false) {
    return <EmptyState icon={SearchX} title="Retriever agents are not available" description="Retriever agents answer over search indices, which this server's storage adapter does not support." />
  }
  if (agents.isPending || catalog.isPending || schema.isPending) {
    return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 rounded-xl" /></div>
  }
  const loadError = agents.error ?? catalog.error ?? schema.error
  if (loadError || !agents.data || !catalog.data || !schema.data) {
    return <div className="text-sm"><p role="alert" className="text-destructive">Could not load retriever agents: {errorText(loadError)}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => { void agents.refetch(); void catalog.refetch(); void schema.refetch() }}>Reload</Button></div>
  }

  const common = { ontologyKey, lensKey: lens.key, existingKeys, catalog: catalog.data, schema: schema.data, aiEnabled: features?.ai !== false }
  if (creating !== null) {
    return <AgentEditor key={`new:${creating.key}`} {...common} agent={null} identity={creating}
      onSaved={(saved) => void refresh().then(() => select(saved.key))} onClose={() => select(null)} />
  }
  if (selectedKey !== null) {
    const agent = agents.data.find((a) => a.key === selectedKey)
    if (agent === undefined) {
      return <EmptyState icon={BotMessageSquare} title="Retriever agent not found" description={`This lens has no retriever agent ${selectedKey}. It may have been deleted or moved.`}
        action={<Button variant="outline" onClick={() => select(null)}>All retriever agents</Button>} />
    }
    return <AgentEditor key={`${agent.key}:${agent.updatedAt}`} {...common} agent={agent} identity={null}
      onSaved={(saved) => { queryClient.setQueryData<RetrieverAgent[]>(qk.retrieverAgents(ontologyKey, lens.key), (list) => list?.map((a) => (a.key === saved.key ? saved : a))); void refresh() }}
      onCopied={(copy) => void refresh().then(() => select(copy.key))}
      onDeleted={() => void refresh().then(() => select(null))} onClose={() => select(null)} />
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start gap-3">
      <p className="max-w-2xl flex-1 text-[13px] text-muted-foreground">Retriever agents answer questions over this lens's search indices: a planner picks indices, relation groups and filters per question, an answer model writes the reply from the found entities. Chat with them in the Workbench (AI → Retriever).</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setDialog('import')}><FileUp className="size-3.5" /> Import</Button>
        <Button size="sm" onClick={() => setDialog('new')}><Plus className="size-3.5" /> New retriever agent</Button>
      </div>
    </div>
    {agents.data.length === 0 ? <EmptyState icon={BotMessageSquare} title="No retriever agents yet" description="Create one, choose the indices it searches, save it and test it here." />
      : <div className="grid gap-3 lg:grid-cols-2">{agents.data.map((agent) => <AgentCard key={agent.key} agent={agent} catalog={catalog.data} onOpen={() => select(agent.key)} />)}</div>}
    {dialog === 'new' && <NameKeyDialog open title="New retriever agent" description="Name and key; then choose its indices and save it." confirmLabel="Continue"
      initialName="" existingKeys={existingKeys} busy={false} error="" onCancel={() => setDialog(null)} onConfirm={(name, key) => { setDialog(null); setCreating({ name, key }) }} />}
    <ImportDialog open={dialog === 'import'} ontologyKey={ontologyKey} lensKey={lens.key} existingKeys={existingKeys} onClose={() => setDialog(null)}
      onImported={(agent) => { setDialog(null); toast.success(`Retriever agent "${agent.name}" imported`); void refresh().then(() => select(agent.key)) }} />
  </div>
}

function AgentCard({ agent, catalog, onOpen }: { agent: RetrieverAgent; catalog: SearchCatalogEntry[]; onOpen: () => void }) {
  const supported = isSupportedAgent(agent)
  const names = supported ? agent.config.indices.map((ref) => catalog.find((c) => c.key === ref.index)?.name ?? ref.index) : []
  return <button type="button" onClick={onOpen} className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold">{agent.name}</span>
      <Badge variant="outline" className="font-mono text-[11px]">{agent.key}</Badge>
      {!supported ? <Badge variant="destructive">unsupported</Badge> : !agent.validation.valid ? <Badge variant="destructive">invalid</Badge>
        : <Badge variant="outline" className="border-(--tc-emerald-border) text-(--tc-emerald)">valid</Badge>}
      {agent.validation.warnings.length > 0 && <Badge variant="outline" className="border-(--tc-amber-border) text-(--tc-amber)">{agent.validation.warnings.length} warning{agent.validation.warnings.length === 1 ? '' : 's'}</Badge>}
    </div>
    {agent.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>}
    {supported && <p className="mt-2 text-xs text-muted-foreground">{names.length ? `Searches ${names.join(', ')}` : 'No index'} · {agent.config.filters.length} filter{agent.config.filters.length === 1 ? '' : 's'}</p>}
  </button>
}

interface AgentEditorProps {
  ontologyKey: string
  lensKey: string
  existingKeys: string[]
  catalog: SearchCatalogEntry[]
  schema: RuntimeSchema
  aiEnabled: boolean
  /** The saved agent; null for a new one (then `identity` names it). */
  agent: RetrieverAgent | null
  identity: { name: string; key: string } | null
  onSaved: (agent: RetrieverAgent) => void
  onCopied?: (agent: RetrieverAgent) => void
  onDeleted?: () => void
  onClose: () => void
}

/**
 * Draft + Save editor of one retriever agent with its test panel. Remount
 * it (React `key`) to re-seed the draft from a newer saved version.
 */
function AgentEditor({ ontologyKey, lensKey, existingKeys, catalog, schema, aiEnabled, agent, identity, onSaved, onCopied, onDeleted, onClose }: AgentEditorProps) {
  const isNew = agent === null
  const key = agent?.key ?? identity?.key ?? ''
  const baseline = useMemo<AgentDraft>(() => (agent ? draftOf(agent) : { name: identity?.name ?? '', description: '', config: emptyConfig() }), [agent, identity])
  const [draft, setDraft] = useState(baseline)
  const [repairApplied, setRepairApplied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveIssues, setSaveIssues] = useState<ValidationError[]>([])
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyError, setCopyError] = useState('')
  const unsupported = agent !== null && !isSupportedAgent(agent)
  const showEditor = !unsupported || repairApplied
  const dirty = !sameDraft(draft, baseline) || repairApplied
  const problems = draftProblems(draft.config, catalog, schema)
  const issues = [...saveIssues, ...problems.filter((p) => !saveIssues.some((s) => s.path === p.path))]
  const canSave = showEditor && problems.length === 0 && draft.name.trim() !== ''
  const execution = agentExecution(agent, dirty)
  // The test panel's mode, remembered beside the diagnostics preference.
  const [testMode, setTestMode] = useState<'chat' | 'retrieve'>(() => (readString(storageKeys.retrieverTestMode) === 'retrieve' ? 'retrieve' : 'chat'))
  const chooseTestMode = (mode: 'chat' | 'retrieve') => { setTestMode(mode); writeString(storageKeys.retrieverTestMode, mode) }

  /* --------------------------- leave protection --------------------------- */
  // Tabs, the agent list and other pages are navigations; unsaved drafts ask first.
  const leaving = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !leaving.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  const leave = (run: () => void) => { leaving.current = true; run() }
  // Back to the list is no navigation for a new draft, so it asks here too.
  const [confirmClose, setConfirmClose] = useState(false)
  const close = () => (dirty ? setConfirmClose(true) : onClose())

  const edit = (patch: Partial<AgentDraft>) => { setDraft((d) => ({ ...d, ...patch })); setSaveIssues([]); setSaveError('') }
  const discard = () => { setDraft(baseline); setRepairApplied(false); setSaveIssues([]); setSaveError('') }

  async function save() {
    setBusy(true); setSaveError(''); setSaveIssues([])
    try {
      if (isNew) {
        const created = await importRetrieverAgent(ontologyKey, lensKey, { key, ...toInput(draft) })
        toast.success(`Retriever agent "${created.name}" created`)
        leave(() => onSaved(created))
      } else {
        const saved = await saveRetrieverAgent(ontologyKey, lensKey, key, toInput(draft))
        toast.success('Retriever agent saved')
        onSaved(saved)
      }
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors !== undefined) setSaveIssues(Object.entries(error.fieldErrors).map(([path, message]) => ({ path, message })))
      setSaveError(errorText(error))
    } finally { setBusy(false) }
  }
  async function saveAsCopy(name: string, copyKey: string) {
    setBusy(true); setCopyError('')
    try {
      const copy = await importRetrieverAgent(ontologyKey, lensKey, { key: copyKey, ...toInput({ ...draft, name }) })
      toast.success(`Saved as "${copy.name}"`)
      setCopyOpen(false)
      leave(() => onCopied?.(copy))
    } catch (error) { setCopyError(errorText(error)) } finally { setBusy(false) }
  }

  const title = draft.name.trim() || agent?.name || key
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-xs text-muted-foreground" onClick={close}><ChevronLeft className="size-3.5" /> All retriever agents</Button>
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">{key}</Badge>
      <span className={`text-xs ${isNew || dirty ? 'text-(--tc-amber)' : agent && !agent.validation.valid ? 'text-destructive' : 'text-muted-foreground'}`}>
        {isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : !agent.validation.valid ? 'Invalid in this lens' : 'Saved'}</span>
    </div>

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="grid min-w-0 gap-4">
        <RetrieverAgentSaveBar isNew={isNew} dirty={dirty} canSave={canSave} busy={busy} onSave={() => void save()} onDiscard={discard} onSaveAsCopy={() => { setCopyError(''); setCopyOpen(true) }} />
        {saveError && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">{saveError}</p>}
        {agent && (!agent.validation.valid || agent.validation.warnings.length > 0) &&
          <ValidationPanel result={{ valid: agent.validation.valid, errors: asIssues(agent.validation.errors), warnings: asIssues(agent.validation.warnings) }} />}
        {unsupported && !repairApplied && <p role="alert" className="text-xs text-destructive">Unsupported configuration version or shape (version {agent.configVersion}). It is preserved under More → Configuration JSON, where you can export it or apply a version 2 configuration.</p>}

        <section className="grid gap-3 rounded-xl border bg-card p-4">
          <div className="grid gap-1.5"><Label htmlFor="agent-name">Name</Label><Input id="agent-name" value={draft.name} disabled={busy} onChange={(e) => edit({ name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="agent-description">Description</Label><Textarea id="agent-description" rows={2} value={draft.description} disabled={busy} onChange={(e) => edit({ description: e.target.value })} />
            <p className="text-xs text-muted-foreground">What this agent answers. Stores configuration only — no conversations or vectors.</p></div>
        </section>

        {showEditor && <RetrieverAgentConfigEditor ontologyKey={ontologyKey} config={draft.config} onChange={(config) => edit({ config })} catalog={catalog} schema={schema} disabled={busy} issues={issues} />}

        {agent && <RetrieverAgentMore ontologyKey={ontologyKey} lensKey={lensKey} agent={agent} config={draft.config} unsupported={unsupported && !repairApplied} disabled={busy} onBusy={setBusy}
          onDeleted={() => leave(() => onDeleted?.())} onConfig={(config) => { edit({ config }); if (unsupported) setRepairApplied(true) }} />}
      </div>

      <section aria-label="Test" className="flex h-[85dvh] min-h-[640px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card xl:sticky xl:top-4">
        <div className="border-b px-4 py-3"><div className="flex items-center justify-between gap-3"><h3 className="text-[13px] font-semibold">Test</h3>
          <div role="radiogroup" aria-label="Test mode" className="inline-flex rounded-md border p-0.5 text-xs">
            {(['chat', 'retrieve'] as const).map((mode) => <button key={mode} type="button" role="radio" aria-checked={testMode === mode} onClick={() => chooseTestMode(mode)}
              className={cn('rounded px-2 py-0.5', testMode === mode ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}>{mode === 'chat' ? 'Chat' : 'Retrieve'}</button>)}
          </div></div>
          <p className="mt-0.5 text-xs text-muted-foreground">{testMode === 'chat'
            ? 'Ask the saved version and inspect how each answer was found. Saving starts a new conversation.'
            : 'Ask the saved version for the entities it finds, without an answer. Saving clears the result.'}</p></div>
        {!aiEnabled ? <p className="p-4 text-xs text-muted-foreground">This server has no AI provider configured; retriever agents cannot answer here.</p>
          : testMode === 'retrieve' ? <RetrieverAgentRetrieve key={agent ? `${agent.key}:${agent.updatedAt}` : 'new'} ontologyKey={ontologyKey} lensKey={lensKey}
            agentKey={agent?.key ?? null} blockedReason={execution.mode === 'blocked' ? execution.reason : null}
            catalog={catalog} schema={schema} />
          : <RetrieverAgentChat key={agent ? `${agent.key}:${agent.updatedAt}` : 'new'} ontologyKey={ontologyKey} lensKey={lensKey}
            agentKey={agent?.key ?? null} blockedReason={execution.mode === 'blocked' ? execution.reason : null} diagnostics
            config={agent && isSupportedAgent(agent) ? agent.config : null} catalog={catalog} schema={schema}
            intro={<div className="mx-auto max-w-md py-8 text-sm text-muted-foreground">{agent === null ? 'Save this retriever agent to test it.' : <><h4 className="mb-2 text-base font-medium text-foreground">Ask {agent.name}</h4><p>Ask about a topic, an exact value, or both. Follow-up questions refer to completed answers in this conversation.</p></>}</div>} />}
      </section>
    </div>

    {copyOpen && agent && <NameKeyDialog open title={`Save ${agent.name} as copy`} description="Saves the current configuration, unsaved changes included, as a new retriever agent. The original stays as last saved."
      confirmLabel="Save copy" initialName={`${draft.name.trim() || agent.name} copy`} existingKeys={existingKeys} busy={busy} error={copyError}
      onCancel={() => setCopyOpen(false)} onConfirm={(name, copyKey) => void saveAsCopy(name, copyKey)} />}
    <AlertDialog open={blocker.state === 'blocked' || confirmClose}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>{title} has unsaved changes. Leaving discards them.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel onClick={() => { setConfirmClose(false); blocker.reset?.() }}>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { if (confirmClose) { setConfirmClose(false); leave(onClose) } else blocker.proceed?.() }}>Discard and leave</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
