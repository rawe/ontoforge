import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, ChevronLeft, Copy, ListTree, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { Lens, NamedSearch, Representation, SearchCatalogEntry, SearchTreeNode } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { EmptyState } from '@/components/EmptyState'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ASSISTANT_STATUS_TEXT, assistantKeyError, assistantStatus } from './assistants/assistantModel'
import { useAssistantLeaveGuard } from './assistants/useAssistantLeaveGuard'
import { deriveKey, invalidateModeling, isValidLensResourceKey, toastError } from './lib'
import { NodeCard } from './namedsearches/NodeCard'
import {
  NAMED_SEARCH_NEW,
  canonicalTree,
  cleanTree,
  placeErrors,
  resultUnit,
  type Method,
  type PlacedErrors,
  type ResultUnit,
  type StartChoice,
} from './namedsearches/namedSearchModel'
import { KeyField } from './shared'

const TAB = 'named-searches'
const PARAM = 'search'

/**
 * Lens detail → Named searches: the lens's named searches (list, delete) and
 * the editor of one (`?search=<key>`, `?search=_new` for a draft) — the
 * stored search tree as nested cards, root on top.
 */
export function NamedSearchesTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  const [toDelete, setToDelete] = useState<NamedSearch | null>(null)
  // Each save remounts the editor on the saved version.
  const [saves, setSaves] = useState(0)

  // NOTE: modeling named-search routes are key-addressed, like saved queries.
  const listKey = qk.model(ontologyKey, 'lenses', lens.key, 'named-searches')
  const searches = useQuery({
    queryKey: listKey,
    queryFn: () => model.listNamedSearches(ontologyKey, lens.key),
  })

  const remove = useMutation({
    mutationFn: (key: string) => model.deleteNamedSearch(ontologyKey, lens.key, key),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Named search deleted')
    },
    onError: toastError,
  })

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })

  if (searches.isPending) return <Skeleton className="h-32 rounded-xl" />
  if (searches.error || !searches.data) {
    return (
      <div className="text-sm">
        <p role="alert" className="text-destructive">
          Could not load named searches: {placeErrors(searches.error).summary.join(' ')}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void searches.refetch()}>Reload</Button>
      </div>
    )
  }

  // The saved search goes into the list before the editor remounts on it; the refetch follows.
  const onSaved = (saved: NamedSearch) => {
    queryClient.setQueryData<NamedSearch[]>(listKey, (list = []) =>
      list.some((s) => s.key === saved.key) ? list.map((s) => (s.key === saved.key ? saved : s)) : [...list, saved])
    setSaves((n) => n + 1)
    invalidateModeling(queryClient)
  }
  const common = {
    ontologyKey, lensKey: lens.key, existingKeys: searches.data.map((s) => s.key), onClose: () => select(null),
  }
  if (selectedKey === NAMED_SEARCH_NEW) {
    return <NamedSearchPage key={NAMED_SEARCH_NEW} {...common} search={null} onSaved={(saved) => { onSaved(saved); select(saved.key) }} />
  }
  if (selectedKey !== null) {
    const search = searches.data.find((s) => s.key === selectedKey)
    if (search === undefined) {
      return (
        <EmptyState
          icon={ListTree}
          title="Named search not found"
          description={`This lens has no named search ${selectedKey}. It may have been deleted.`}
          action={<Button variant="outline" onClick={() => select(null)}>All named searches</Button>}
        />
      )
    }
    return <NamedSearchPage key={`${search.key}:${saves}`} {...common} search={search} onSaved={onSaved} />
  }

  const list = searches.data
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">Named searches</h3>
        <span className="text-[13px] text-muted-foreground">{list.length}</span>
        <Button size="sm" className="ml-auto" onClick={() => select(NAMED_SEARCH_NEW)}>
          <Plus className="size-3.5" /> New named search
        </Button>
      </div>

      {list.length === 0 && (
        <EmptyState
          icon={ListTree}
          title="No named searches"
          description="A named search stores a search tree under a key; callers run it by key with their query."
          action={
            <Button onClick={() => select(NAMED_SEARCH_NEW)}>
              <Plus className="size-4" /> New named search
            </Button>
          }
        />
      )}

      {list.length > 0 && (
        <div className="space-y-2">
          {list.map((s) => {
            const unit = resultUnit(s.tree)
            return (
              <div key={s.key} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                <ListTree className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{s.key}</span>
                    {unit !== null && <Badge variant="secondary" className="text-[10px]">{unit}</Badge>}
                  </div>
                  {s.description !== '' && (
                    <p className="truncate text-[12px] text-muted-foreground">{s.description}</p>
                  )}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.key}`} onClick={() => select(s.key)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${s.key}`} onClick={() => setToDelete(s)}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete named search "{toDelete?.key ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The named search is removed from this lens. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete !== null) remove.mutate(toDelete.key)
              }}
            >
              Delete named search
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ------------------------------- start choice ------------------------------- */

/** The start of a new tree: result unit, indices, methods, limit → the canonical tree. */
function StartChoiceSection({
  indices,
  semanticAvailable,
  disabled,
  onWrite,
}: {
  indices: readonly SearchCatalogEntry[]
  semanticAvailable: boolean
  disabled: boolean
  onWrite: (tree: SearchTreeNode) => void
}) {
  const [choice, setChoice] = useState<StartChoice>({
    unit: 'entities',
    indices: [],
    methods: ['keyword', 'semantic'],
    limit: 10,
  })
  // Semantic stays chosen while the features load; without it, it does not count.
  const methods = choice.methods.filter((m) => m !== 'semantic' || semanticAvailable)
  const modes = Object.fromEntries(indices.map((i): [string, Representation[]] => [i.key, i.modes]))
  const tree = canonicalTree({ ...choice, methods }, modes)
  const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item))

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-[13px] font-semibold">Start</h3>
        <p className="text-xs text-muted-foreground">
          Choose what it searches; this writes a tree — one search per index and method, each searching for{' '}
          <code className="font-mono">$query</code> — that you then edit.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label>Result</Label>
        <RadioGroup
          value={choice.unit}
          onValueChange={(unit) => setChoice({ ...choice, unit: unit as ResultUnit })}
          className="flex flex-wrap gap-4"
          disabled={disabled}
        >
          {(['entities', 'passages'] as const).map((unit) => (
            <label key={unit} className="flex items-center gap-2 text-[13px]">
              <RadioGroupItem value={unit} /> {unit}
            </label>
          ))}
        </RadioGroup>
      </div>
      <div className="grid gap-1.5">
        <Label>Indices</Label>
        <div className="max-h-56 overflow-y-auto rounded-lg border p-1">
          {indices.length === 0 && <p className="p-2 text-xs text-muted-foreground">This lens has no searchable index.</p>}
          {indices.map((i) => (
            <label key={i.key} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50">
              <Checkbox
                checked={choice.indices.includes(i.key)}
                disabled={disabled}
                onCheckedChange={(on) => setChoice({ ...choice, indices: toggle(choice.indices, i.key, on === true) })}
              />
              <TypeDot typeKey={i.entityType} />
              <span className="truncate">{i.name}</span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">{i.key}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">{i.modes.join(' · ')}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="grid gap-1.5">
          <Label>Methods</Label>
          <div className="flex items-center gap-4 text-[13px]">
            {(['keyword', 'semantic'] as const).map((method: Method) => (
              <label key={method} className="flex items-center gap-2">
                <Checkbox
                  checked={methods.includes(method)}
                  disabled={disabled || (method === 'semantic' && !semanticAvailable)}
                  onCheckedChange={(on) => setChoice({ ...choice, methods: toggle(choice.methods, method, on === true) })}
                />
                {method}
              </label>
            ))}
          </div>
        </div>
        <div className="grid w-28 gap-1.5">
          <Label htmlFor="ns-start-limit">Limit</Label>
          <Input
            id="ns-start-limit"
            type="number"
            min={1}
            max={100}
            value={Number.isFinite(choice.limit) ? choice.limit : ''}
            disabled={disabled}
            onChange={(e) => setChoice({ ...choice, limit: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
            className="h-8"
          />
        </div>
        <Button type="button" size="sm" disabled={disabled || tree === null} onClick={() => tree !== null && onWrite(tree)}>
          Write tree
        </Button>
      </div>
    </section>
  )
}

/* ---------------------------------- editor ---------------------------------- */

interface NamedSearchPageProps {
  ontologyKey: string
  lensKey: string
  existingKeys: string[]
  /** The saved search; null for a new one. */
  search: NamedSearch | null
  onSaved: (search: NamedSearch) => void
  onClose: () => void
}

/**
 * Draft + Save editor of one named search. Remount it (React `key`) to
 * re-seed the draft from a newer saved version.
 */
function NamedSearchPage({ ontologyKey, lensKey, existingKeys, search, onSaved, onClose }: NamedSearchPageProps) {
  const isNew = search === null
  const catalog = useSearchCatalog(ontologyKey, lensKey).data ?? []
  const entityTypes = useRuntimeSchema(ontologyKey, lensKey).data?.entityTypes.map((t) => t.key) ?? []
  const semanticAvailable = useFeatures().data?.semanticSearch === true

  const baselineTree = useMemo(() => (search === null ? null : JSON.stringify(search.tree)), [search])
  const [name, setName] = useState(search?.name ?? '')
  const [key, setKey] = useState(search?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState(search?.description ?? '')
  const [tree, setTree] = useState<SearchTreeNode | null>(search?.tree ?? null)
  const [showJson, setShowJson] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<PlacedErrors>({ summary: [], byNode: {} })

  const dirty = isNew
    ? key !== '' || name !== '' || description !== '' || tree !== null
    : name !== search.name || description !== search.description || JSON.stringify(tree) !== baselineTree
  const keyError = isNew ? assistantKeyError(key, existingKeys, 'Named search') : undefined
  const valid = name.trim() !== '' && tree !== null && (!isNew || (isValidLensResourceKey(key) && keyError === undefined))
  const canSave = (dirty || isNew) && valid && !busy
  const title = name.trim() || search?.name || 'New named search'
  const status = ASSISTANT_STATUS_TEXT[assistantStatus({ isNew, dirty, invalid: false })]
  const { leave, dialog } = useAssistantLeaveGuard(dirty, title)
  const json = tree === null ? '' : JSON.stringify(cleanTree(tree), null, 2)

  const clearErrors = () => setErrors({ summary: [], byNode: {} })
  const editTree = (next: SearchTreeNode | null) => {
    setTree(next)
    clearErrors()
  }

  async function save() {
    if (tree === null) return
    setBusy(true)
    clearErrors()
    try {
      const saved = await model.upsertNamedSearch(ontologyKey, lensKey, key, {
        name: name.trim(),
        description: description.trim(),
        tree: cleanTree(tree),
      })
      toast.success(isNew ? `Named search "${saved.name}" created` : `Named search "${saved.name}" saved`)
      if (isNew) leave(() => onSaved(saved))
      else onSaved(saved)
    } catch (error) {
      setErrors(placeErrors(error))
    } finally {
      setBusy(false)
    }
  }

  const defaults = {
    index: catalog[0]?.key ?? '',
    entityType: entityTypes[0] ?? '',
    unit: (tree === null ? null : resultUnit(tree)) ?? 'entities',
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-xs text-muted-foreground" onClick={onClose}>
          <ChevronLeft className="size-3.5" /> All named searches
        </Button>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {search !== null && <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">{search.key}</Badge>}
        <span className={`text-xs ${status.className}`}>{status.text}</span>
      </div>

      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) void save() }}>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave}>{isNew ? 'Create named search' : 'Save'}</Button>
          {!isNew && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setName(search.name)
                setDescription(search.description)
                setTree(search.tree)
                clearErrors()
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
        {errors.summary.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <p className="font-medium text-destructive">Not saved:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {errors.summary.map((line, i) => <li key={i} className="whitespace-pre-wrap break-words">{line}</li>)}
            </ul>
          </div>
        )}

        <section className="grid gap-3 rounded-xl border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ns-name">Name</Label>
              <Input
                id="ns-name"
                value={name}
                disabled={busy}
                autoFocus={isNew}
                onChange={(e) => {
                  setName(e.target.value)
                  clearErrors()
                  if (isNew && !keyTouched) setKey(deriveKey(e.target.value))
                }}
              />
            </div>
            <KeyField
              id="ns-key"
              lensResource
              value={key}
              disabled={!isNew || busy}
              error={keyError}
              onChange={(value) => { setKeyTouched(true); setKey(value) }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ns-description">Description</Label>
            <Textarea
              id="ns-description"
              rows={2}
              value={description}
              disabled={busy}
              onChange={(e) => { setDescription(e.target.value); clearErrors() }}
            />
            <p className="text-xs text-muted-foreground">What it finds; shown to those who run it.</p>
          </div>
        </section>

        {tree === null ? (
          <StartChoiceSection indices={catalog} semanticAvailable={semanticAvailable} disabled={busy} onWrite={editTree} />
        ) : (
          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold">Search tree</h3>
              <span className="text-xs text-muted-foreground">The root on top; each node's inputs below it.</span>
              <span className="ml-auto flex gap-1.5">
                <Button type="button" variant={showJson ? 'secondary' : 'outline'} size="xs" onClick={() => setShowJson((s) => !s)}>
                  <Braces className="size-3" /> JSON
                </Button>
                <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => editTree(null)}>
                  <RotateCcw className="size-3" /> Start over
                </Button>
              </span>
            </div>
            {showJson ? (
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="absolute top-2 right-2"
                  onClick={() => void navigator.clipboard.writeText(json).then(() => toast.success('Copied'))}
                >
                  <Copy className="size-3" /> Copy
                </Button>
                <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px]">{json}</pre>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-min">
                  <NodeCard
                    path=""
                    editing={{
                      tree,
                      indices: catalog,
                      entityTypes,
                      defaults,
                      errors: errors.byNode,
                      disabled: busy,
                      onTree: editTree,
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        )}
      </form>
      {dialog}
    </div>
  )
}
