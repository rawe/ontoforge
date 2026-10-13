import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, FileUp } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures, useRetrievers, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import { deleteRetriever, importRetriever, saveRetriever, type Retriever } from '@/api/retrievers'
import type { Lens, RuntimeSchema, SearchCatalogEntry, ValidationError } from '@/api/types'
import { RetrieverChat } from '@/components/assistants/retrievers/RetrieverChat'
import { RetrieverConfigEditor } from '@/components/assistants/retrievers/RetrieverConfigEditor'
import { RetrieverRetrieve } from '@/components/assistants/retrievers/RetrieverRetrieve'
import { ImportDialog, NameKeyDialog, RetrieverMore } from '@/components/assistants/retrievers/RetrieverManagement'
import { errorText } from '@/components/assistants/retrievers/errorText'
import {
  retrieverExecution, asIssues, draftOf, draftProblems, isSupportedRetriever, sameDraft, toInput, type RetrieverDraft,
} from '@/components/assistants/retrievers/retrieverModel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { AssistantActionBar } from './assistants/AssistantActionBar'
import { AssistantCard, AssistantValidityBadges, AssistantWarningsBadge } from './assistants/AssistantCard'
import { AssistantDefaultPage, AssistantEditorPage } from './assistants/AssistantEditorPage'
import { AssistantIdentitySection } from './assistants/AssistantIdentitySection'
import { AssistantList, AssistantLoadError, AssistantLoading, AssistantNotFound } from './assistants/AssistantList'
import { AssistantTestPanel } from './assistants/AssistantTestPanel'
import {
  ASSISTANT_DEFAULT, ASSISTANT_NEW, assistantErrorLines, assistantKeyError, assistantStatus,
} from './assistants/assistantModel'
import { useAssistantLeaveGuard } from './assistants/useAssistantLeaveGuard'
import { isValidLensResourceKey } from './lib'
import { ValidationPanel } from './ValidationPanel'

const TAB = 'retriever-agents'
const PARAM = 'retriever'

/**
 * Lens detail → Retrievers: the lens's retrievers (list, with the built-in
 * Default), the editor of one (`?retriever=<key>`, `?retriever=_new` for a
 * draft, `?retriever=_default` for the Default's read-only page) and its test panel.
 */
export function RetrieversTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const features = useFeatures().data
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  const [importing, setImporting] = useState(false)
  const retrievers = useRetrievers(ontologyKey, lens.key)
  const catalog = useSearchCatalog(ontologyKey, lens.key)
  const schema = useRuntimeSchema(ontologyKey, lens.key)
  const queryClient = useQueryClient()

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })
  // The Workbench's runtime list follows the modeling list.
  const refresh = () => Promise.all([qk.retrievers(ontologyKey, lens.key), qk.assistants(ontologyKey, lens.key, 'retrievers')]
    .map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  if (retrievers.isPending || catalog.isPending || schema.isPending) return <AssistantLoading />
  if (retrievers.error || catalog.error || schema.error || !retrievers.data || !catalog.data || !schema.data) {
    return (
      <AssistantLoadError
        kind="retrievers"
        error={retrievers.error ?? catalog.error ?? schema.error}
        onReload={() => { void retrievers.refetch(); void catalog.refetch(); void schema.refetch() }}
      />
    )
  }

  const aiEnabled = features?.ai !== false
  const existingKeys = retrievers.data.map((r) => r.key)
  if (selectedKey === ASSISTANT_DEFAULT) {
    return (
      <AssistantDefaultPage
        kind="retrievers"
        onBack={() => select(null)}
        onNew={() => select(ASSISTANT_NEW)}
        test={
          <RetrieverTestPanel
            ontologyKey={ontologyKey}
            lensKey={lens.key}
            aiEnabled={aiEnabled}
            catalog={catalog.data}
            schema={schema.data}
            retrieverKey={ASSISTANT_DEFAULT}
            name="Default"
            description={null}
            blockedReason={null}
            hints={{
              chat: 'Ask the built-in default and inspect how each answer was found.',
              retrieve: 'Ask the built-in default for the entities it finds, without an answer.',
            }}
          />
        }
      />
    )
  }

  const common = {
    ontologyKey, lensKey: lens.key, existingKeys, catalog: catalog.data, schema: schema.data, aiEnabled, onClose: () => select(null),
  }
  if (selectedKey === ASSISTANT_NEW) {
    return <RetrieverPage key={ASSISTANT_NEW} {...common} retriever={null} onSaved={(saved) => void refresh().then(() => select(saved.key))} />
  }
  if (selectedKey !== null) {
    const retriever = retrievers.data.find((r) => r.key === selectedKey)
    if (retriever === undefined) return <AssistantNotFound kind="retrievers" assistantKey={selectedKey} onBack={() => select(null)} />
    return (
      <RetrieverPage
        key={`${retriever.key}:${retriever.updatedAt}`}
        {...common}
        retriever={retriever}
        onSaved={(saved) => {
          queryClient.setQueryData<Retriever[]>(qk.retrievers(ontologyKey, lens.key), (list) => list?.map((r) => (r.key === saved.key ? saved : r)))
          void refresh()
        }}
        onCopied={(copy) => void refresh().then(() => select(copy.key))}
        onDeleted={() => {
          queryClient.setQueryData<Retriever[]>(qk.retrievers(ontologyKey, lens.key), (list) => list?.filter((r) => r.key !== retriever.key))
          select(null)
          void refresh()
        }}
      />
    )
  }

  return (
    <>
      <AssistantList
        kind="retrievers"
        count={retrievers.data.length}
        extras={<Button size="sm" variant="outline" onClick={() => setImporting(true)}><FileUp className="size-3.5" /> Import</Button>}
        emptyText="Create one, choose the indices it searches, save it and test it here."
        onNew={() => select(ASSISTANT_NEW)}
        onOpenDefault={() => select(ASSISTANT_DEFAULT)}
      >
        {retrievers.data.map((retriever) => (
          <AssistantCard
            key={retriever.key}
            name={retriever.name}
            assistantKey={retriever.key}
            badges={isSupportedRetriever(retriever)
              ? <AssistantValidityBadges valid={retriever.validation.valid} warnings={retriever.validation.warnings.length} />
              : <><Badge variant="destructive">unsupported</Badge><AssistantWarningsBadge warnings={retriever.validation.warnings.length} /></>}
            description={retriever.description}
            summary={isSupportedRetriever(retriever) ? searchesLine(retriever, catalog.data) : undefined}
            onOpen={() => select(retriever.key)}
          />
        ))}
      </AssistantList>
      <ImportDialog
        open={importing}
        ontologyKey={ontologyKey}
        lensKey={lens.key}
        existingKeys={existingKeys}
        onClose={() => setImporting(false)}
        onImported={(retriever) => {
          setImporting(false)
          toast.success(`Retriever "${retriever.name}" imported`)
          void refresh().then(() => select(retriever.key))
        }}
      />
    </>
  )
}

/** The card's summary: the indices a supported retriever searches and how many filters it has. */
function searchesLine(retriever: Retriever, catalog: SearchCatalogEntry[]): string {
  const names = retriever.config.indices.map((ref) => catalog.find((c) => c.key === ref.index)?.name ?? ref.index)
  const filters = retriever.config.filters.length
  return `${names.length ? `Searches ${names.join(', ')}` : 'No index'} · ${filters} filter${filters === 1 ? '' : 's'}`
}

type TestMode = 'chat' | 'retrieve'

interface RetrieverTestPanelProps {
  ontologyKey: string
  lensKey: string
  aiEnabled: boolean
  catalog: SearchCatalogEntry[]
  schema: RuntimeSchema
  /** The saved retriever's key (or `_default`); null while new. */
  retrieverKey: string | null
  name: string
  description: string | null
  blockedReason: string | null
  /** The header sentence per mode. */
  hints: Record<TestMode, string>
  /** Remounts the chat and the retrieve when the saved version changes. */
  savedVersion?: string
}

/** The Test panel of a retriever: Chat or Retrieve against the saved version, the mode remembered in the browser. */
function RetrieverTestPanel({
  ontologyKey, lensKey, aiEnabled, catalog, schema, retrieverKey, name, description, blockedReason, hints, savedVersion,
}: RetrieverTestPanelProps) {
  const [mode, setMode] = useState<TestMode>(() => (readString(storageKeys.retrieverTestMode) === 'retrieve' ? 'retrieve' : 'chat'))
  const choose = (next: TestMode) => { setMode(next); writeString(storageKeys.retrieverTestMode, next) }
  return (
    <AssistantTestPanel
      kind="retrievers"
      aiEnabled={aiEnabled}
      hint={hints[mode]}
      extras={
        <div role="radiogroup" aria-label="Test mode" className="inline-flex rounded-md border p-0.5 text-xs">
          {(['chat', 'retrieve'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => choose(option)}
              className={cn('rounded px-2 py-0.5', mode === option ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              {option === 'chat' ? 'Chat' : 'Retrieve'}
            </button>
          ))}
        </div>
      }
    >
      {(actions) => mode === 'retrieve'
        ? (
          <RetrieverRetrieve
            key={savedVersion}
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            agentKey={retrieverKey}
            blockedReason={blockedReason}
            catalog={catalog}
            schema={schema}
          />
        )
        : (
          <RetrieverChat
            key={savedVersion}
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            retrieverKey={retrieverKey}
            name={name}
            description={description}
            blockedReason={blockedReason}
            diagnostics="always"
            remember={false}
            catalog={catalog}
            schema={schema}
            actions={actions}
          />
        )}
    </AssistantTestPanel>
  )
}

interface RetrieverPageProps {
  ontologyKey: string
  lensKey: string
  existingKeys: string[]
  catalog: SearchCatalogEntry[]
  schema: RuntimeSchema
  aiEnabled: boolean
  /** The saved retriever; null for a new one. */
  retriever: Retriever | null
  onSaved: (retriever: Retriever) => void
  onCopied?: (retriever: Retriever) => void
  onDeleted?: () => void
  onClose: () => void
}

/**
 * Draft + Save editor of one retriever with its test panel. Remount it
 * (React `key`) to re-seed the draft from a newer saved version.
 */
function RetrieverPage({
  ontologyKey, lensKey, existingKeys, catalog, schema, aiEnabled, retriever, onSaved, onCopied, onDeleted, onClose,
}: RetrieverPageProps) {
  const isNew = retriever === null
  const baseline = useMemo(() => draftOf(retriever), [retriever])
  const [draft, setDraft] = useState<RetrieverDraft>(baseline)
  const [key, setKey] = useState(retriever?.key ?? '')
  const [repairApplied, setRepairApplied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [failed, setFailed] = useState<'save' | 'delete'>('save')
  const [saveIssues, setSaveIssues] = useState<ValidationError[]>([])
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyError, setCopyError] = useState('')

  const unsupported = retriever !== null && !isSupportedRetriever(retriever)
  const showEditor = !unsupported || repairApplied
  const dirty = !sameDraft(draft, baseline) || repairApplied || (isNew && key !== '')
  const problems = draftProblems(draft.config, catalog, schema)
  const issues = [...saveIssues, ...problems.filter((p) => !saveIssues.some((s) => s.path === p.path))]
  // Whether the draft could be stored at all — by Save, or as a copy.
  const storable = showEditor && problems.length === 0 && draft.name.trim() !== '' && !busy
  const keyValid = !isNew || (isValidLensResourceKey(key) && assistantKeyError(key, existingKeys, 'Retriever') === undefined)
  const canSave = (dirty || isNew) && storable && keyValid
  const execution = retrieverExecution(retriever, dirty)
  const title = draft.name.trim() || retriever?.name || 'New retriever'
  const { leave, dialog } = useAssistantLeaveGuard(dirty, title)

  const edit = (patch: Partial<RetrieverDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaveIssues([])
    setSaveErrors([])
  }
  const discard = () => {
    setDraft(baseline)
    setRepairApplied(false)
    setSaveIssues([])
    setSaveErrors([])
  }

  async function save() {
    setBusy(true)
    setSaveErrors([])
    setSaveIssues([])
    try {
      if (isNew) {
        // Create-only: a taken key is refused, never replaced.
        const created = await importRetriever(ontologyKey, lensKey, { key, ...toInput(draft) })
        toast.success(`Retriever "${created.name}" created`)
        leave(() => onSaved(created))
      } else {
        const saved = await saveRetriever(ontologyKey, lensKey, key, toInput(draft))
        toast.success(`Retriever "${saved.name}" saved`)
        onSaved(saved)
      }
    } catch (error) {
      setFailed('save')
      if (error instanceof ApiError && error.fieldErrors !== undefined) {
        setSaveIssues(Object.entries(error.fieldErrors).map(([path, message]) => ({ path, message })))
      }
      setSaveErrors(assistantErrorLines(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveAsCopy(name: string, copyKey: string) {
    setBusy(true)
    setCopyError('')
    try {
      const copy = await importRetriever(ontologyKey, lensKey, { key: copyKey, ...toInput({ ...draft, name }) })
      toast.success(`Saved as "${copy.name}"`)
      setCopyOpen(false)
      leave(() => onCopied?.(copy))
    } catch (error) {
      setCopyError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (retriever === null) return
    setBusy(true)
    try {
      await deleteRetriever(ontologyKey, lensKey, retriever.key)
      toast.success(`Retriever "${retriever.name}" deleted`)
      leave(() => onDeleted?.())
    } catch (error) {
      setFailed('delete')
      setSaveErrors(assistantErrorLines(error))
      setBusy(false)
    }
  }

  return (
    <AssistantEditorPage
      kind="retrievers"
      title={title}
      assistantKey={retriever?.key ?? null}
      status={assistantStatus({ isNew, dirty, invalid: retriever !== null && !retriever.validation.valid })}
      onBack={onClose}
      test={
        <RetrieverTestPanel
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          aiEnabled={aiEnabled}
          catalog={catalog}
          schema={schema}
          retrieverKey={retriever?.key ?? null}
          name={retriever?.name ?? title}
          description={retriever?.description ?? null}
          blockedReason={execution.mode === 'blocked' ? execution.reason : null}
          hints={{
            chat: 'Ask the saved version and inspect how each answer was found. Saving starts a new conversation.',
            retrieve: 'Ask the saved version for the entities it finds, without an answer. Saving clears the result.',
          }}
          savedVersion={retriever ? `${retriever.key}:${retriever.updatedAt}` : ASSISTANT_NEW}
        />
      }
    >
      <div className="grid gap-4">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) void save() }}>
          <AssistantActionBar
            kind="retrievers"
            isNew={isNew}
            dirty={dirty}
            canSave={canSave}
            busy={busy}
            name={retriever?.name ?? ''}
            errors={saveErrors}
          failed={failed}
            extras={!isNew && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!storable}
                title="Save the current configuration as a new retriever; this one stays as saved"
                onClick={() => { setCopyError(''); setCopyOpen(true) }}
              >
                <Copy className="size-3.5" /> Save as copy
              </Button>
            )}
            onDiscard={discard}
            onDelete={() => void remove()}
          />
          {retriever && (!retriever.validation.valid || retriever.validation.warnings.length > 0) && (
            <ValidationPanel result={{
              valid: retriever.validation.valid,
              errors: asIssues(retriever.validation.errors),
              warnings: asIssues(retriever.validation.warnings),
            }} />
          )}
          {unsupported && !repairApplied && (
            <p role="alert" className="text-xs text-destructive">
              Unsupported configuration version or shape (version {retriever.configVersion}). It is preserved under More → Configuration JSON,
              where you can export it or apply a version 2 configuration.
            </p>
          )}
          <AssistantIdentitySection
            kind="retrievers"
            isNew={isNew}
            name={draft.name}
            assistantKey={key}
            description={draft.description}
            existingKeys={existingKeys}
            disabled={busy}
            namePlaceholder="Person skills"
            descriptionHint="What this retriever answers. Stores configuration only — no conversations or vectors."
            onName={(name) => edit({ name })}
            onKey={setKey}
            onDescription={(description) => edit({ description })}
          />
          {showEditor && (
            <RetrieverConfigEditor
              ontologyKey={ontologyKey}
              config={draft.config}
              onChange={(config) => edit({ config })}
              catalog={catalog}
              schema={schema}
              disabled={busy}
              issues={issues}
            />
          )}
        </form>
        {retriever && (
          <RetrieverMore
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            agent={retriever}
            config={draft.config}
            unsupported={unsupported && !repairApplied}
            disabled={busy}
            onBusy={setBusy}
            onMoved={() => leave(() => onDeleted?.())}
            onConfig={(config) => { edit({ config }); if (unsupported) setRepairApplied(true) }}
          />
        )}
      </div>
      {copyOpen && retriever && (
        <NameKeyDialog
          open
          title={`Save ${retriever.name} as copy`}
          description="Saves the current configuration, unsaved changes included, as a new retriever. The original stays as last saved."
          confirmLabel="Save copy"
          initialName={`${draft.name.trim() || retriever.name} copy`}
          existingKeys={existingKeys}
          busy={busy}
          error={copyError}
          onCancel={() => setCopyOpen(false)}
          onConfirm={(name, copyKey) => void saveAsCopy(name, copyKey)}
        />
      )}
      {dialog}
    </AssistantEditorPage>
  )
}
