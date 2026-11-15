import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Braces, ChevronLeft, Copy, ListTree, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useFeatures, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { Lens, SearchProfile, Representation, SearchCatalogEntry, SearchTreeNode } from '@/api/types'
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
import { NodeCard } from './searchprofiles/NodeCard'
import {
  SEARCH_PROFILE_NEW,
  canonicalTree,
  cleanTree,
  placeErrors,
  resultUnit,
  type Method,
  type PlacedErrors,
  type ResultUnit,
  type StartChoice,
} from './searchprofiles/searchProfileModel'
import { KeyField } from './shared'

const TAB = 'search-profiles'
const PARAM = 'profile'

/**
 * Lens detail → Search profiles: the lens's search profiles (list, delete) and
 * the editor of one (`?profile=<key>`, `?profile=_new` for a draft) — the
 * stored search tree as nested cards, root on top.
 */
export function SearchProfilesTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedKey = searchParams.get(PARAM)
  const [toDelete, setToDelete] = useState<SearchProfile | null>(null)
  // Each save remounts the editor on the saved version.
  const [saves, setSaves] = useState(0)

  // NOTE: modeling search-profile routes are key-addressed, like saved queries.
  const listKey = qk.model(ontologyKey, 'lenses', lens.key, 'search-profiles')
  const profiles = useQuery({
    queryKey: listKey,
    queryFn: () => model.listSearchProfiles(ontologyKey, lens.key),
  })

  const remove = useMutation({
    mutationFn: (key: string) => model.deleteSearchProfile(ontologyKey, lens.key, key),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Search profile deleted')
    },
    onError: toastError,
  })

  const select = (key: string | null) =>
    setSearchParams(key === null ? { tab: TAB } : { tab: TAB, [PARAM]: key }, { replace: true })

  if (profiles.isPending) return <Skeleton className="h-32 rounded-xl" />
  if (profiles.error || !profiles.data) {
    return (
      <div className="text-sm">
        <p role="alert" className="text-destructive">
          Could not load search profiles: {placeErrors(profiles.error).summary.join(' ')}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void profiles.refetch()}>Reload</Button>
      </div>
    )
  }

  // The saved search profile goes into the list before the editor remounts on it; the refetch follows.
  const onSaved = (saved: SearchProfile) => {
    queryClient.setQueryData<SearchProfile[]>(listKey, (list = []) =>
      list.some((s) => s.key === saved.key) ? list.map((s) => (s.key === saved.key ? saved : s)) : [...list, saved])
    setSaves((n) => n + 1)
    invalidateModeling(queryClient)
  }
  const common = {
    ontologyKey, lensKey: lens.key, existingKeys: profiles.data.map((s) => s.key), onClose: () => select(null),
  }
  if (selectedKey === SEARCH_PROFILE_NEW) {
    return <SearchProfilePage key={SEARCH_PROFILE_NEW} {...common} profile={null} onSaved={(saved) => { onSaved(saved); select(saved.key) }} />
  }
  if (selectedKey !== null) {
    const profile = profiles.data.find((s) => s.key === selectedKey)
    if (profile === undefined) {
      return (
        <EmptyState
          icon={ListTree}
          title="Search profile not found"
          description={`This lens has no search profile ${selectedKey}. It may have been deleted.`}
          action={<Button variant="outline" onClick={() => select(null)}>All search profiles</Button>}
        />
      )
    }
    return <SearchProfilePage key={`${profile.key}:${saves}`} {...common} profile={profile} onSaved={onSaved} />
  }

  const list = profiles.data
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">Search profiles</h3>
        <span className="text-[13px] text-muted-foreground">{list.length}</span>
        <Button size="sm" className="ml-auto" onClick={() => select(SEARCH_PROFILE_NEW)}>
          <Plus className="size-3.5" /> New search profile
        </Button>
      </div>

      {list.length === 0 && (
        <EmptyState
          icon={ListTree}
          title="No search profiles"
          description="A search profile stores a search tree under a key; callers run it by key with their query."
          action={
            <Button onClick={() => select(SEARCH_PROFILE_NEW)}>
              <Plus className="size-4" /> New search profile
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
            <AlertDialogTitle>Delete search profile "{toDelete?.key ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The search profile is removed from this lens. This cannot be undone.
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
              Delete search profile
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
          <Label htmlFor="sp-start-limit">Limit</Label>
          <Input
            id="sp-start-limit"
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

interface SearchProfilePageProps {
  ontologyKey: string
  lensKey: string
  existingKeys: string[]
  /** The saved search profile; null for a new one. */
  profile: SearchProfile | null
  onSaved: (profile: SearchProfile) => void
  onClose: () => void
}

/**
 * Draft + Save editor of one search profile. Remount it (React `key`) to
 * re-seed the draft from a newer saved version.
 */
function SearchProfilePage({ ontologyKey, lensKey, existingKeys, profile, onSaved, onClose }: SearchProfilePageProps) {
  const isNew = profile === null
  const catalog = useSearchCatalog(ontologyKey, lensKey).data ?? []
  const entityTypes = useRuntimeSchema(ontologyKey, lensKey).data?.entityTypes.map((t) => t.key) ?? []
  const semanticAvailable = useFeatures().data?.semanticSearch === true

  const baselineTree = useMemo(() => (profile === null ? null : JSON.stringify(profile.tree)), [profile])
  const [name, setName] = useState(profile?.name ?? '')
  const [key, setKey] = useState(profile?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState(profile?.description ?? '')
  const [tree, setTree] = useState<SearchTreeNode | null>(profile?.tree ?? null)
  const [showJson, setShowJson] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<PlacedErrors>({ summary: [], byNode: {} })

  const dirty = isNew
    ? key !== '' || name !== '' || description !== '' || tree !== null
    : name !== profile.name || description !== profile.description || JSON.stringify(tree) !== baselineTree
  const keyError = isNew ? assistantKeyError(key, existingKeys, 'Search profile') : undefined
  const valid = name.trim() !== '' && tree !== null && (!isNew || (isValidLensResourceKey(key) && keyError === undefined))
  const canSave = (dirty || isNew) && valid && !busy
  const title = name.trim() || profile?.name || 'New search profile'
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
      const saved = await model.upsertSearchProfile(ontologyKey, lensKey, key, {
        name: name.trim(),
        description: description.trim(),
        tree: cleanTree(tree),
      })
      toast.success(isNew ? `Search profile "${saved.name}" created` : `Search profile "${saved.name}" saved`)
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
          <ChevronLeft className="size-3.5" /> All search profiles
        </Button>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {profile !== null && <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">{profile.key}</Badge>}
        <span className={`text-xs ${status.className}`}>{status.text}</span>
      </div>

      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (canSave) void save() }}>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave}>{isNew ? 'Create search profile' : 'Save'}</Button>
          {!isNew && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setName(profile.name)
                setDescription(profile.description)
                setTree(profile.tree)
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
              <Label htmlFor="sp-name">Name</Label>
              <Input
                id="sp-name"
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
              id="sp-key"
              lensResource
              value={key}
              disabled={!isNew || busy}
              error={keyError}
              onChange={(value) => { setKeyTouched(true); setKey(value) }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-description">Description</Label>
            <Textarea
              id="sp-description"
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
