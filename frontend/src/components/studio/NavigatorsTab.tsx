import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { Link, useBlocker, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures, useNavigators, useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { deleteNavigator, saveNavigator, type Navigator } from '@/api/navigators'
import { qk } from '@/api/queryKeys'
import type { Lens, RuntimeSchema } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { AssistantExplainerButton } from '@/components/assistants/explainers/AssistantExplainer'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { NavigatorChat } from '@/components/assistants/navigators/NavigatorChat'
import { NavigatorEditor } from '@/components/assistants/navigators/NavigatorEditor'
import { configLine, draftOf, draftProblems, sameDraft, toWrite, type NavigatorDraft } from '@/components/assistants/navigators/navigatorDraft'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { deriveKey, isValidLensResourceKey } from './lib'
import { KeyField } from './shared'
import { ValidationPanel } from './ValidationPanel'

const TAB = 'navigators'
const PARAM = 'navigator'
const NEW = 'new'
const KEY_MAX = 64

/** A failed request as lines: the server's reasons (`details.errors`) when it gives them, else its message. */
function errorLines(error: unknown): string[] {
  const errors = error instanceof ApiError ? error.details?.errors : undefined
  if (Array.isArray(errors) && errors.length > 0 && errors.every((e) => typeof e === 'string')) return errors
  return [error instanceof Error ? error.message : 'The request failed.']
}

/**
 * Lens detail → Navigators: the lens's navigators (list, with the built-in
 * Default), the editor of one (`?navigator=<key>`, `?navigator=new` for a
 * draft) and its test chat.
 */
export function NavigatorsTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const features = useFeatures().data
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  const navigators = useNavigators(ontologyKey, lens.key)
  const schema = useRuntimeSchema(ontologyKey, lens.key)
  const queryClient = useQueryClient()

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })
  // The Workbench's runtime list follows the modeling list.
  const refresh = () => Promise.all([qk.navigators(ontologyKey, lens.key), qk.assistants(ontologyKey, lens.key, 'navigators')]
    .map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  if (navigators.isPending || schema.isPending) {
    return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 rounded-xl" /></div>
  }
  if (navigators.error || schema.error || !navigators.data || !schema.data) {
    return (
      <div className="text-sm">
        <p role="alert" className="text-destructive">Could not load navigators: {errorLines(navigators.error ?? schema.error).join(' ')}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { void navigators.refetch(); void schema.refetch() }}>Reload</Button>
      </div>
    )
  }

  const common = {
    ontologyKey, lensKey: lens.key, schema: schema.data, aiEnabled: features?.ai !== false,
    existingKeys: navigators.data.map((n) => n.key), onClose: () => select(null),
  }
  if (selectedKey === NEW) {
    return <NavigatorPage key={NEW} {...common} navigator={null} onSaved={(saved) => void refresh().then(() => select(saved.key))} />
  }
  if (selectedKey !== null) {
    const navigator = navigators.data.find((n) => n.key === selectedKey)
    if (navigator === undefined) {
      return (
        <EmptyState
          icon={ASSISTANT_KINDS.navigators.icon}
          title="Navigator not found"
          description={`This lens has no navigator ${selectedKey}. It may have been deleted.`}
          action={<Button variant="outline" onClick={() => select(null)}>All navigators</Button>}
        />
      )
    }
    return (
      <NavigatorPage
        key={`${navigator.key}:${navigator.updatedAt}`}
        {...common}
        navigator={navigator}
        onSaved={(saved) => {
          queryClient.setQueryData<Navigator[]>(qk.navigators(ontologyKey, lens.key), (list) => list?.map((n) => (n.key === saved.key ? saved : n)))
          void refresh()
        }}
        onDeleted={() => void refresh().then(() => select(null))}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="max-w-2xl flex-1 text-[13px] text-muted-foreground">
          Navigators answer questions about how things are connected: they find the entities a question names, follow their
          relations a few hops outward and answer only from the entities they found, citing each one. Chat with them in the
          Workbench (Assistants → Navigators).
        </p>
        <div className="flex gap-2">
          <AssistantExplainerButton kind="navigators" labeled />
          <Button size="sm" onClick={() => select(NEW)}><Plus className="size-3.5" /> New navigator</Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-dashed p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">Default</span>
            <Badge variant="outline" className="font-mono text-[11px]">_default</Badge>
            <Badge variant="secondary">built in</Badge>
            <Link
              to={`/o/${ontologyKey}/w/${lens.key}/ai?tab=navigator&assistant=_default`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Try it <ExternalLink className="size-3" />
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Every lens has it, derived from the lens: it may follow every relation type and start from every entity type the
            lens shows. It is not stored and cannot be edited; create a navigator to narrow it down.
          </p>
        </div>
        {navigators.data.map((navigator) => <NavigatorCard key={navigator.key} navigator={navigator} onOpen={() => select(navigator.key)} />)}
      </div>
    </div>
  )
}

function NavigatorCard({ navigator, onOpen }: { navigator: Navigator; onOpen: () => void }) {
  const { validation } = navigator
  return (
    <button type="button" onClick={onOpen} className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{navigator.name}</span>
        <Badge variant="outline" className="font-mono text-[11px]">{navigator.key}</Badge>
        {!validation.valid ? <Badge variant="destructive">invalid</Badge>
          : <Badge variant="outline" className="border-(--tc-emerald-border) text-(--tc-emerald)">valid</Badge>}
        {validation.warnings.length > 0 && (
          <Badge variant="outline" className="border-(--tc-amber-border) text-(--tc-amber)">
            {validation.warnings.length} warning{validation.warnings.length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      {navigator.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{navigator.description}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{configLine(navigator)}</p>
    </button>
  )
}

interface NavigatorPageProps {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  aiEnabled: boolean
  existingKeys: string[]
  /** The saved navigator; null for a new one. */
  navigator: Navigator | null
  onSaved: (navigator: Navigator) => void
  onDeleted?: () => void
  onClose: () => void
}

/**
 * Draft + Save editor of one navigator with its test chat. Remount it
 * (React `key`) to re-seed the draft from a newer saved version.
 */
function NavigatorPage({ ontologyKey, lensKey, schema, aiEnabled, existingKeys, navigator, onSaved, onDeleted, onClose }: NavigatorPageProps) {
  const isNew = navigator === null
  const baseline = useMemo(() => draftOf(navigator), [navigator])
  const [draft, setDraft] = useState<NavigatorDraft>(baseline)
  const [key, setKey] = useState(navigator?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveErrors, setSaveErrors] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The test chat's "New conversation" goes into the Test header.
  const [chatActions, setChatActions] = useState<HTMLElement | null>(null)

  const dirty = !sameDraft(draft, baseline) || (isNew && key !== '')
  const problems = draftProblems(draft)
  const keyError = !isNew ? undefined
    : existingKeys.includes(key) ? 'A navigator with this key exists already.'
      : key.length > KEY_MAX ? `At most ${KEY_MAX} characters.` : undefined
  const keyValid = !isNew || (isValidLensResourceKey(key) && keyError === undefined)
  const canSave = (dirty || isNew) && Object.keys(problems).length === 0 && keyValid && !busy
  const blockedReason = navigator === null ? 'Save this navigator to test it.'
    : dirty ? 'Unsaved changes. Save them to test; questions use the saved configuration.'
      : !navigator.validation.valid ? 'This navigator is invalid in the current lens. Repair and save it before asking.'
        : null

  /* --------------------------- leave protection --------------------------- */
  const leaving = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !leaving.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  const leave = (run: () => void) => { leaving.current = true; run() }

  const edit = (patch: Partial<NavigatorDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaveErrors([])
  }

  async function save() {
    setBusy(true)
    setSaveErrors([])
    try {
      const saved = await saveNavigator(ontologyKey, lensKey, key, toWrite(draft))
      toast.success(isNew ? `Navigator "${saved.name}" created` : 'Navigator saved')
      if (isNew) leave(() => onSaved(saved))
      else onSaved(saved)
    } catch (error) {
      setSaveErrors(errorLines(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (navigator === null) return
    setBusy(true)
    try {
      await deleteNavigator(ontologyKey, lensKey, navigator.key)
      toast.success(`Navigator "${navigator.name}" deleted`)
      leave(() => onDeleted?.())
    } catch (error) {
      setSaveErrors(errorLines(error))
      setBusy(false)
    }
  }

  const title = draft.name.trim() || navigator?.name || 'New navigator'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-xs text-muted-foreground" onClick={onClose}>
          <ChevronLeft className="size-3.5" /> All navigators
        </Button>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <AssistantExplainerButton kind="navigators" className="-ml-1.5" />
        {!isNew && <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">{key}</Badge>}
        <span className={`text-xs ${isNew || dirty ? 'text-(--tc-amber)' : !navigator.validation.valid ? 'text-destructive' : 'text-muted-foreground'}`}>
          {isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : !navigator.validation.valid ? 'Invalid in this lens' : 'Saved'}
        </span>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form className="grid min-w-0 gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) void save() }}>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!canSave}>{isNew ? 'Create navigator' : 'Save'}</Button>
            {!isNew && <Button type="button" size="sm" variant="ghost" disabled={!dirty || busy} onClick={() => { setDraft(baseline); setSaveErrors([]) }}>Discard changes</Button>}
            {!isNew && (
              <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
          </div>
          {saveErrors.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
              <p className="font-medium text-destructive">Not saved:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{saveErrors.map((line, i) => <li key={i}>{line}</li>)}</ul>
            </div>
          )}
          {navigator && (!navigator.validation.valid || navigator.validation.warnings.length > 0) && (
            <ValidationPanel result={{
              valid: navigator.validation.valid,
              errors: navigator.validation.errors.map((message) => ({ path: '', message })),
              warnings: navigator.validation.warnings.map((message) => ({ path: '', message })),
            }} />
          )}

          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="navigator-name">Name</Label>
              <Input
                id="navigator-name"
                value={draft.name}
                disabled={busy}
                autoFocus={isNew}
                placeholder="Team explorer"
                onChange={(e) => {
                  edit({ name: e.target.value })
                  if (isNew && !keyTouched) setKey(deriveKey(e.target.value))
                }}
              />
              {problems.name !== undefined && draft.name !== '' && <p className="text-xs text-destructive">{problems.name}</p>}
            </div>
            <KeyField
              id="navigator-key"
              lensResource
              value={key}
              disabled={!isNew || busy}
              error={keyError}
              onChange={(value) => { setKeyTouched(true); setKey(value) }}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="navigator-description">Description</Label>
              <Textarea id="navigator-description" rows={2} value={draft.description} disabled={busy} onChange={(e) => edit({ description: e.target.value })} />
              {problems.description !== undefined
                ? <p className="text-xs text-destructive">{problems.description}</p>
                : <p className="text-xs text-muted-foreground">What this navigator is for; shown in the Workbench.</p>}
            </div>
          </section>

          <NavigatorEditor draft={draft} onChange={edit} schema={schema} problems={problems} disabled={busy} />
        </form>

        <section aria-label="Test" className="flex h-[85dvh] min-h-[640px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card xl:sticky xl:top-4">
          <div className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold">Test</h3>
              <div ref={setChatActions} className="flex items-center" />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Ask the saved version and watch its steps and evidence. Saving starts a new conversation.</p>
          </div>
          {!aiEnabled
            ? <p className="p-4 text-xs text-muted-foreground">This server has no AI provider configured; navigators cannot answer here.</p>
            : <NavigatorChat
                key={navigator ? `${navigator.key}:${navigator.updatedAt}` : NEW}
                ontologyKey={ontologyKey}
                lensKey={lensKey}
                navigatorKey={navigator?.key ?? null}
                name={navigator?.name ?? title}
                description={navigator?.description ?? null}
                blockedReason={blockedReason}
                remember={false}
                actions={chatActions}
              />}
        </section>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete navigator "{navigator?.name ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>It is removed from this lens. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>Delete navigator</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>{title} has unsaved changes. Leaving discards them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>Discard and leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
