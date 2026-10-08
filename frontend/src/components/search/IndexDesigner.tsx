import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Trash2, X } from 'lucide-react'
import { Link, useBlocker, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import * as model from '@/api/model'
import {
  searchKeys,
  useIndexSchema,
  useSearchIndexPreview,
  useSearchIndices,
} from '@/api/searchIndexHooks'
import type {
  OutlinePart,
  SearchIndexDefinition,
  SearchIndexRecord,
  SearchIndexRelationGroup,
  ValidationError,
} from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { CascadeDialog } from '@/components/studio/CascadeDialog'
import { ValidationPanel } from '@/components/studio/ValidationPanel'
import {
  deriveKey,
  invalidateModeling,
  isValidKey,
  leaveAfterDelete,
  toastError,
} from '@/components/studio/lib'
import { KeyField } from '@/components/studio/shared'
import { useCascade } from '@/components/studio/useCascade'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { EntryPreview, type LeftOut } from './EntryPreview'
import {
  groupPlaceholders,
  insertAt,
  notSelected,
  outlinePart,
  ownerLineCounts,
  partTypes,
  selfPlaceholders,
} from './entryOutline'
import { IndexSaveBar, IndexStatusBlock } from './IndexPanels'
import {
  MAX_INDEX_FIELDS,
  MAX_RELATION_GROUPS,
  countFields,
  draftProblems,
  emptyDraft,
  groupValue,
  headerMode,
  isTextProperty,
  issuesAt,
  newRelationGroup,
  ownFieldOptions,
  relationGroupOptions,
  sameDefinition,
  selectedDocument,
  toDefinition,
  toPreviewInput,
  toggleKey,
  withEntityType,
  type HeaderMode,
  type IndexSchema,
  type IndexSchemaEntityType,
  type IndexSchemaProperty,
  type RelationGroupOption,
} from './searchIndexModel'
import { KindBadge } from './shared'

const MAX_KEY_LENGTH = 64
/** `/studio/search/new` is the designer's own address, so `new` cannot be an index key here. */
const RESERVED_KEYS = new Set(['new'])

/** The value, settled for `ms` (compared by JSON). */
function useDebounced<T>(value: T, ms: number): T {
  const json = JSON.stringify(value)
  const [settled, setSettled] = useState(json)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(json), ms)
    return () => clearTimeout(timer)
  }, [json, ms])
  return useMemo(() => JSON.parse(settled) as T, [settled])
}

/**
 * The issues to show: the server's (save errors, preview) and the client's
 * own checks for paths the server reported nothing on — the server words
 * the same problem its own way.
 */
function mergeIssues(client: ValidationError[], server: ValidationError[]): ValidationError[] {
  const seen = new Set<string>()
  const serverPaths = new Set(server.map((i) => i.path))
  return [...server, ...client.filter((i) => !serverPaths.has(i.path))].filter((i) => {
    const id = `${i.path}\n${i.message}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

interface IndexDesignerProps {
  ontologyKey: string
  /** The saved custom index; null for a new one. */
  saved: SearchIndexRecord | null
  /** Pre-selected entity type of a new index. */
  initialEntityType?: string
}

/**
 * Designer of one custom search index: draft + Save with the cost preview
 * in the save bar, validation next to the fields, status and rebuild.
 * Remount it (React `key`) to re-seed the draft from a newer saved version.
 */
export function IndexDesigner({ ontologyKey, saved, initialEntityType }: IndexDesignerProps) {
  const isNew = saved === null
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const listPath = `/o/${ontologyKey}/studio/search`
  const schema = useIndexSchema(ontologyKey)
  const existing = useSearchIndices(ontologyKey).data

  const baseline = useMemo(
    () => saved?.definition ?? emptyDraft(initialEntityType ?? ''),
    [saved, initialEntityType],
  )
  const [draft, setDraft] = useState<SearchIndexDefinition>(baseline)
  const [headerChoice, setHeaderChoice] = useState<HeaderMode>(headerMode(baseline.header))
  const [keyTouched, setKeyTouched] = useState(false)
  const [saveIssues, setSaveIssues] = useState<ValidationError[]>([])
  const [keyConflict, setKeyConflict] = useState<string | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { cascade, guard, clear } = useCascade()

  const edit = (patch: Partial<SearchIndexDefinition>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaveIssues([])
  }
  const discard = () => {
    setDraft(baseline)
    setHeaderChoice(headerMode(baseline.header))
    setKeyTouched(false)
    setSaveIssues([])
    setKeyConflict(undefined)
  }

  const dirty = !sameDefinition(draft, baseline)
  const previewInput = draft.entityType === '' ? null : toPreviewInput(draft)
  const settledInput = useDebounced(previewInput, 400)
  const preview = useSearchIndexPreview(ontologyKey, settledInput)

  /* ------------------------------- key checks ------------------------------- */
  const key = draft.key.trim()
  const keyTaken = isNew && existing?.some((r) => r.key === key) === true
  const keyMessage = !isNew
    ? undefined
    : (keyConflict ??
      (keyTaken
        ? 'An index with this key exists.'
        : RESERVED_KEYS.has(key)
          ? `"${key}" is reserved — choose another key.`
          : key.length > MAX_KEY_LENGTH
            ? `At most ${MAX_KEY_LENGTH} characters.`
            : undefined))
  const keyOk = !isNew || (key !== '' && isValidKey(key) && keyMessage === undefined)

  // The preview (issues and estimate) counts only while it answers the current draft.
  const previewCurrent =
    !preview.isPlaceholderData && JSON.stringify(settledInput) === JSON.stringify(previewInput)
  const previewIssues = previewCurrent ? (preview.data?.issues ?? []) : []
  // The outline keeps showing while a newer draft is composed, dimmed.
  const outline = previewInput === null ? null : (preview.data?.outline ?? null)
  const outlineStale = !previewCurrent || preview.isFetching
  // Key problems are client-only (the key field shows them too); the panel lists them with the rest.
  const keyProblem: ValidationError[] =
    isNew && key !== '' && !isValidKey(key)
      ? [{ path: 'key', message: 'Lowercase letters, digits and underscores only; must start with a letter.' }]
      : keyMessage !== undefined
        ? [{ path: 'key', message: keyMessage }]
        : []
  const problems = draftProblems(draft)
  // A blank new draft shows no issues yet; once edited, everything open is listed.
  const issues =
    isNew && !dirty
      ? []
      : mergeIssues([...keyProblem, ...problems], [...saveIssues, ...previewIssues])
  const canSave = keyOk && problems.length === 0 && schema !== undefined

  /* ----------------------------- leave protection --------------------------- */
  const leaving = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  )
  const leave = (to: string) => {
    leaving.current = true
    void navigate(to, { replace: isNew })
  }

  /* -------------------------------- mutations ------------------------------- */
  const save = useMutation({
    mutationFn: () => {
      const definition = toDefinition(draft)
      return isNew
        ? model.createSearchIndex(ontologyKey, definition)
        : model.updateSearchIndex(ontologyKey, definition)
    },
    onSuccess: (record) => {
      queryClient.setQueryData(searchKeys.index(ontologyKey, record.key), record)
      invalidateModeling(queryClient)
      toast.success(isNew ? `Index "${record.definition.name}" created` : 'Index saved')
      if (isNew) leave(`${listPath}/${encodeURIComponent(record.key)}`)
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors
        if (fields !== undefined) {
          setSaveIssues(Object.entries(fields).map(([path, message]) => ({ path, message })))
        }
        if (isNew && error.code === 'RESOURCE_CONFLICT') setKeyConflict(error.message)
      }
      toastError(error)
    },
  })

  const remove = useMutation({
    mutationFn: (cascadeFlag: boolean) =>
      model.deleteSearchIndex(ontologyKey, saved!.key, cascadeFlag),
    onSuccess: () => {
      leaving.current = true
      toast.success('Index deleted')
      leaveAfterDelete(navigate, listPath, queryClient)
    },
    onError: (error) => {
      if (guard(error, () => remove.mutate(true))) return
      toastError(error)
    },
  })

  /* --------------------------------- schema --------------------------------- */
  const root = schema?.entityTypes.find((t) => t.key === draft.entityType)
  const options = schema !== undefined && root !== undefined ? relationGroupOptions(schema, root.key) : []
  const usedGroups = new Set(draft.relations.map(groupValue))
  const freeOptions = options.filter((o) => !usedGroups.has(groupValue(o)))
  const fieldCount = countFields(draft)
  const atLimit = fieldCount >= MAX_INDEX_FIELDS

  const setGroup = (i: number, group: SearchIndexRelationGroup) =>
    edit({ relations: draft.relations.map((g, j) => (j === i ? group : g)) })

  const selfPart = outlinePart(outline, 'self')
  const passagePart = outlinePart(outline, 'passage')
  const documentKey = root === undefined ? null : selectedDocument(draft.fields, root)
  const headerApplies = draft.relations.length > 0 || documentKey !== null
  const ownerLines = root === undefined ? undefined : ownerLineCounts(draft.header, root)
  const hasOwnText =
    root?.properties.some((p) => isTextProperty(p) && draft.fields.includes(p.key)) === true
  const documentName = root?.properties.find((p) => p.key === documentKey)?.displayName
  const ownLeftOut: LeftOut[] =
    root === undefined
      ? []
      : notSelected(root.properties, draft.fields).map((p) => ({
          key: p.key,
          label: p.displayName,
          disabledReason: atLimit ? `At most ${MAX_INDEX_FIELDS} fields` : undefined,
          onAdd: () => edit({ fields: toggleKey(draft.fields, p.key, true) }),
        }))

  const title = draft.name.trim() !== '' ? draft.name.trim() : isNew ? 'New index' : saved.key

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to={listPath}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Search
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          <KindBadge kind="custom" />
          {!isNew && (
            <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">
              {saved.key}
            </Badge>
          )}
          {!isNew && (
            <div className="ml-auto">
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </div>
          )}
        </div>
      </header>

      <div className="grid items-start gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 gap-4">
          <Section title="Name and description">
            <div className="grid gap-1.5">
              <Label htmlFor="index-name">Name</Label>
              <Input
                id="index-name"
                value={draft.name}
                placeholder="People by employment"
                onChange={(e) => {
                  const name = e.target.value
                  edit(isNew && !keyTouched ? { name, key: deriveKey(name) } : { name })
                }}
              />
              <IssueList issues={issuesAt(issues, 'name')} />
            </div>
            <KeyField
              id="index-key"
              value={draft.key}
              disabled={!isNew}
              error={keyMessage ?? issuesAt(issues, 'key')[0]?.message}
              onChange={(value) => {
                setKeyTouched(true)
                setKeyConflict(undefined)
                edit({ key: value })
              }}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="index-description">Description</Label>
              <Textarea
                id="index-description"
                rows={3}
                value={draft.description}
                placeholder="People with their roles at companies and since when. Use for questions about who works where."
                onChange={(e) => edit({ description: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Written for agents: what this index finds and when to use it. Agents choose
                indices by this text.
              </p>
              <IssueList issues={issuesAt(issues, 'description')} />
            </div>
          </Section>

          <Section
            title="Entity type"
            description="Every hit is an entity of this type. Changing it clears fields, header and relation groups."
          >
            {schema === undefined ? (
              <Skeleton className="h-8 w-64" />
            ) : (
              <Select
                value={draft.entityType === '' ? undefined : draft.entityType}
                onValueChange={(v) => {
                  setDraft((d) => withEntityType(d, v))
                  setHeaderChoice('name')
                  setSaveIssues([])
                }}
              >
                <SelectTrigger className="w-72" aria-label="Entity type">
                  <SelectValue placeholder="Choose an entity type…" />
                </SelectTrigger>
                <SelectContent>
                  {schema.entityTypes.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      <TypeDot typeKey={t.key} />
                      {t.displayName}
                      <span className="font-mono text-[11px] text-muted-foreground">{t.key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {draft.entityType !== '' && schema !== undefined && root === undefined && (
              <p className="text-xs text-destructive">
                Entity type <code>{draft.entityType}</code> no longer exists.
              </p>
            )}
            <IssueList issues={issuesAt(issues, 'entityType')} />
          </Section>

          {root !== undefined && schema !== undefined && (
            <>
              <Section
                title="Own fields"
                meta={
                  <span className={cn('text-[12px] text-muted-foreground', fieldCount > MAX_INDEX_FIELDS && 'text-destructive')}>
                    {fieldCount}/{MAX_INDEX_FIELDS} fields in this index
                  </span>
                }
                description="Rendered as labelled lines in the entity's own entry. Text and scalar properties; one document property at most — the index then also finds the entity by passages of that document."
              >
                <FieldChecklist
                  idPrefix="own"
                  properties={ownFieldOptions(root)}
                  selected={draft.fields}
                  emptyText="This entity type has no properties an index can read."
                  disabledReason={(p, checked) => {
                    if (checked) return undefined
                    if (atLimit) return `At most ${MAX_INDEX_FIELDS} fields`
                    const doc = selectedDocument(draft.fields, root)
                    if (p.dataType === 'document' && doc !== null) return 'One document field at most'
                    return undefined
                  }}
                  onToggle={(k, on) => edit({ fields: toggleKey(draft.fields, k, on) })}
                />
                <IssueList issues={issuesAt(issues, 'fields')} />
                {draft.semantic.enabled && hasOwnText && (
                  <SemanticTextChoice
                    id="semantic-template"
                    template={draft.semantic.template}
                    labelledHint={`The type's name, then each field as “Label: value”.`}
                    placeholder="{name} — {bio}"
                    placeholders={selfPlaceholders(draft, root)}
                    onChange={(template) => edit({ semantic: { ...draft.semantic, template } })}
                  />
                )}
                {outline !== null && (
                  <EntryPreview
                    part={selfPart}
                    types={selfPart && partTypes(schema, root.key, selfPart)}
                    caption={<>One own entry per {root.displayName}</>}
                    semantic={draft.semantic.enabled}
                    keyword={draft.keyword.enabled}
                    stale={outlineStale}
                    emptyText={ownEntryAbsence(root.displayName, draft.relations.length > 0, documentKey !== null)}
                    leftOut={[{ title: root.displayName, fields: ownLeftOut }]}
                  />
                )}
                {outline !== null && documentKey !== null && (
                  <EntryPreview
                    part={passagePart}
                    types={passagePart && partTypes(schema, root.key, passagePart)}
                    caption={
                      <>
                        One passage entry per chunk of {documentName ?? documentKey} — the owner
                        line, then the chunk
                      </>
                    }
                    semantic={draft.semantic.enabled}
                    keyword={draft.keyword.enabled}
                    stale={outlineStale}
                    ownerLines={ownerLines}
                  />
                )}
              </Section>

              <Section
                title="Owner line (header)"
                marker
                dimmed={!headerApplies}
                description="Says whose an entry is: it starts every entry that is not the entity's own — each relation entry and each passage. Its fields do not count toward the limit."
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="text-muted-foreground">Applies to</span>
                  {draft.relations.length > 0 && (
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {draft.relations.length === 1 ? '1 relation group' : `${draft.relations.length} relation groups`}
                    </Badge>
                  )}
                  {documentKey !== null && (
                    <Badge variant="outline" className="text-[11px] font-normal">
                      passages of {documentName ?? documentKey}
                    </Badge>
                  )}
                  {!headerApplies && (
                    <span className="text-muted-foreground">
                      nothing yet — add a relation group or a document field
                    </span>
                  )}
                  <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground line-through decoration-muted-foreground/60">
                    the own entry
                  </Badge>
                </div>
                <RadioGroup
                  value={headerChoice}
                  onValueChange={(v) => {
                    const mode = v as HeaderMode
                    setHeaderChoice(mode)
                    edit({
                      header:
                        mode === 'name' ? null : mode === 'none' ? [] : (draft.header ?? []).length > 0 ? draft.header : [root.nameProperty],
                    })
                  }}
                  className="gap-1.5"
                >
                  <label className="flex items-center gap-2 text-[13px]">
                    <RadioGroupItem value="name" />
                    Name property
                    <code className="text-xs text-muted-foreground">{root.nameProperty}</code>
                  </label>
                  <label className="flex items-center gap-2 text-[13px]">
                    <RadioGroupItem value="fields" />
                    Chosen fields
                  </label>
                  <label className="flex items-center gap-2 text-[13px]">
                    <RadioGroupItem value="none" />
                    None
                  </label>
                </RadioGroup>
                {headerChoice === 'fields' && (
                  <div className="ml-6">
                    <FieldChecklist
                      idPrefix="header"
                      properties={root.properties.filter(isTextProperty)}
                      selected={draft.header ?? []}
                      emptyText="No text properties."
                      onToggle={(k, on) => edit({ header: toggleKey(draft.header ?? [], k, on) })}
                    />
                    {(draft.header ?? []).length === 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No field chosen — entries get no header.
                      </p>
                    )}
                  </div>
                )}
                <IssueList issues={issuesAt(issues, 'header')} />
              </Section>

              <Section
                title="Relation groups"
                meta={
                  <span className="text-[12px] text-muted-foreground">
                    {draft.relations.length}/{MAX_RELATION_GROUPS}
                  </span>
                }
                description="One entry per relation instance: the owner line, the group's name, the relation's fields and the fields of the entity on the other end. Relations are never combined into one entry. A group's name — the relation's by default — tells agents what the group holds."
              >
                {draft.relations.map((g, i) => (
                  <RelationGroupCard
                    key={i}
                    index={i}
                    group={g}
                    draft={draft}
                    root={root}
                    part={outlinePart(outline, 'relation', i)}
                    showPreview={outline !== null}
                    stale={outlineStale}
                    ownerLines={ownerLines}
                    schema={schema}
                    options={options}
                    used={usedGroups}
                    atLimit={atLimit}
                    issues={issuesAt(issues, `relations.${i}`)}
                    onChange={(next) => setGroup(i, next)}
                    onRemove={() => edit({ relations: draft.relations.filter((_, j) => j !== i) })}
                  />
                ))}
                {options.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No relation type connects {root.displayName}.
                  </p>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    disabled={draft.relations.length >= MAX_RELATION_GROUPS || freeOptions.length === 0}
                    onClick={() => edit({ relations: [...draft.relations, newRelationGroup(freeOptions[0]!)] })}
                  >
                    <Plus className="size-3.5" /> Add relation group
                  </Button>
                )}
                <IssueList issues={issues.filter((i) => i.path === 'relations')} />
              </Section>

              <Section
                title="Search modes"
                description="Semantic search finds by meaning (needs an embedding provider); keyword search finds by words, stemmed in the ontology's keyword languages. How an entry's semantic text is written is chosen beside its preview."
              >
                <label className="flex items-center gap-3 text-[13px]">
                  <Switch
                    checked={draft.semantic.enabled}
                    onCheckedChange={(on) => edit({ semantic: { ...draft.semantic, enabled: on } })}
                  />
                  Semantic
                </label>
                <label className="flex items-center gap-3 text-[13px]">
                  <Switch
                    checked={draft.keyword.enabled}
                    onCheckedChange={(on) => edit({ keyword: { enabled: on } })}
                  />
                  Keyword
                </label>
                <IssueList issues={[...issuesAt(issues, 'semantic'), ...issuesAt(issues, 'keyword')]} />
              </Section>
            </>
          )}
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-6">
          <IndexSaveBar
            isNew={isNew}
            dirty={dirty}
            canSave={canSave}
            busy={save.isPending}
            previewRequested={previewInput !== null}
            blocked={problems.length > 0}
            preview={previewCurrent ? preview.data : undefined}
            previewFetching={preview.isFetching}
            fieldCount={fieldCount}
            groupCount={draft.relations.length}
            onSave={() => save.mutate()}
            onDiscard={discard}
          />
          {issues.length > 0 && (
            <ValidationPanel result={{ valid: false, errors: issues }} />
          )}
          {!isNew && <IndexStatusBlock ontologyKey={ontologyKey} record={saved} />}
        </aside>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{saved?.definition.name ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The index and its entries are removed; search and retriever agents can no
              longer use it. Lenses that include it are listed before anything changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate(false)}>
              Delete index
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This index has changes that are not saved. Leaving discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CascadeDialog cascade={cascade} onClose={clear} />
    </div>
  )
}

/* ------------------------------- building blocks ------------------------------ */

/** Why a draft has no own entry, and what still finds the entity. */
function ownEntryAbsence(typeName: string, groups: boolean, passages: boolean): string {
  const kinds = [groups && 'relation', passages && 'passage'].filter(Boolean).join(' and ')
  return kinds === ''
    ? 'No own entry: no own text field is selected.'
    : `No own entry: no own text field is selected, so a ${typeName} is found only through its ${kinds} entries.`
}

function Section({
  title,
  description,
  meta,
  marker = false,
  dimmed = false,
  children,
}: {
  title: string
  description?: string
  meta?: ReactNode
  /** The owner line's mark — the rule that marks its lines in the previews. */
  marker?: boolean
  /** Shown faded: the section applies to nothing yet. */
  dimmed?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn('grid gap-3 rounded-xl border bg-card p-4 transition-opacity', dimmed && 'opacity-60')}>
      <div>
        <div className="flex items-center gap-2">
          {marker && <span className="h-3.5 w-0.5 rounded-full bg-primary/35" aria-hidden />}
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {meta !== undefined && <span className="ml-auto">{meta}</span>}
        </div>
        {description !== undefined && (
          <p className="mt-0.5 max-w-2xl text-[12px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function IssueList({ issues }: { issues: ValidationError[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="space-y-0.5">
      {issues.map((i) => (
        <li key={`${i.path}\n${i.message}`} className="text-xs text-destructive">
          {i.message}
        </li>
      ))}
    </ul>
  )
}

function FieldChecklist({
  idPrefix,
  properties,
  selected,
  emptyText,
  disabledReason,
  onToggle,
}: {
  idPrefix: string
  properties: IndexSchemaProperty[]
  selected: readonly string[]
  emptyText: string
  /** Why an option cannot be toggled now, or undefined when it can. */
  disabledReason?: (p: IndexSchemaProperty, checked: boolean) => string | undefined
  onToggle: (key: string, on: boolean) => void
}) {
  const known = new Set(properties.map((p) => p.key))
  const missing = selected.filter((k) => !known.has(k))
  if (properties.length === 0 && missing.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{emptyText}</p>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-1">
      {properties.map((p) => {
        const checked = selected.includes(p.key)
        const reason = disabledReason?.(p, checked)
        return (
          <label
            key={p.key}
            htmlFor={`${idPrefix}-${p.key}`}
            className={cn('flex min-w-0 items-center gap-2 text-[13px]', reason !== undefined && 'opacity-60')}
            title={reason}
          >
            <Checkbox
              id={`${idPrefix}-${p.key}`}
              checked={checked}
              disabled={reason !== undefined}
              onCheckedChange={(on) => onToggle(p.key, on === true)}
            />
            <span className="truncate">{p.displayName}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{p.key}</span>
            {p.dataType !== 'string' && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {p.dataType}
              </Badge>
            )}
          </label>
        )
      })}
      {/* Fields the schema no longer has: shown so they can be removed. */}
      {missing.map((k) => (
        <label key={k} className="flex items-center gap-2 text-[13px] text-destructive">
          <Checkbox checked onCheckedChange={() => onToggle(k, false)} />
          <span className="font-mono text-[11px]">{k}</span>
          <span className="text-xs">(no longer in the schema)</span>
        </label>
      ))}
    </div>
  )
}

function optionLabel(option: RelationGroupOption, schema: IndexSchema) {
  const other =
    schema.entityTypes.find((t) => t.key === option.otherEnd)?.displayName ?? option.otherEnd
  return option.direction === 'outgoing'
    ? `${option.displayName} → ${other}`
    : `${option.displayName} ← ${other}`
}

function RelationGroupCard({
  index,
  group,
  draft,
  root,
  part,
  showPreview,
  stale,
  ownerLines,
  schema,
  options,
  used,
  atLimit,
  issues,
  onChange,
  onRemove,
}: {
  index: number
  group: SearchIndexRelationGroup
  draft: SearchIndexDefinition
  root: IndexSchemaEntityType
  part: OutlinePart | undefined
  showPreview: boolean
  stale: boolean
  ownerLines: { semantic: number; keyword: number } | undefined
  schema: IndexSchema
  options: RelationGroupOption[]
  used: Set<string>
  atLimit: boolean
  issues: ValidationError[]
  onChange: (group: SearchIndexRelationGroup) => void
  onRemove: () => void
}) {
  const value = groupValue(group)
  const option = options.find((o) => groupValue(o) === value)
  const relationType = schema.relationTypes.find((r) => r.key === group.relationType)
  const target =
    option === undefined ? undefined : schema.entityTypes.find((t) => t.key === option.otherEnd)
  const targetFields = target === undefined ? [] : (group.target[target.key] ?? [])
  const limitReason = (_: IndexSchemaProperty, checked: boolean) =>
    !checked && atLimit ? `At most ${MAX_INDEX_FIELDS} fields` : undefined

  const relationName = relationType?.displayName ?? group.relationType
  const relationProps = (relationType?.properties ?? []).filter(isTextProperty)
  const targetProps = (target?.properties ?? []).filter(isTextProperty)
  const limit = atLimit ? `At most ${MAX_INDEX_FIELDS} fields` : undefined
  const warnings: ReactNode[] = []
  if (group.fields.length === 0 && relationProps.length > 0) {
    warnings.push(
      <>
        None of the relation's own properties ({relationProps.map((p) => p.displayName).join(', ')})
        is in these entries — a search cannot match on them.
      </>,
    )
  }
  if (target !== undefined && targetFields.length === 0 && targetProps.length > 0) {
    warnings.push(
      <>
        The {target.displayName} at the other end is not mentioned, not even by name — a search
        cannot match on it.
      </>,
    )
  }
  const leftOut = [
    {
      title: relationName,
      fields: notSelected(relationProps, group.fields).map((p) => ({
        key: p.key,
        label: p.displayName,
        disabledReason: limit,
        onAdd: () => onChange({ ...group, fields: toggleKey(group.fields, p.key, true) }),
      })),
    },
    ...(target === undefined
      ? []
      : [
          {
            title: target.displayName,
            fields: notSelected(targetProps, targetFields).map((p) => ({
              key: p.key,
              label: p.displayName,
              disabledReason: limit,
              onAdd: () =>
                onChange({ ...group, target: { [target.key]: toggleKey(targetFields, p.key, true) } }),
            })),
          },
        ]),
  ]

  return (
    <div
      className={cn(
        'grid gap-3 rounded-lg border bg-muted/20 p-3',
        issues.length > 0 && 'border-destructive/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12px] font-medium text-muted-foreground">Group {index + 1}</span>
        <Select
          value={option === undefined ? undefined : value}
          onValueChange={(v) => {
            const next = options.find((o) => groupValue(o) === v)
            if (next !== undefined && v !== value) onChange(newRelationGroup(next))
          }}
        >
          <SelectTrigger size="sm" className="min-w-56" aria-label={`Relation of group ${index + 1}`}>
            <SelectValue placeholder={`${group.relationType} (${group.direction}) — unavailable`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => {
              const v = groupValue(o)
              return (
                <SelectItem key={v} value={v} disabled={v !== value && used.has(v)}>
                  {optionLabel(o, schema)}
                  <span className="text-[11px] text-muted-foreground">{o.direction}</span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {option !== undefined && (
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            Name
            <Input
              id={`g${index}-label`}
              className="h-8 w-56"
              value={group.label ?? ''}
              placeholder={relationType?.displayName ?? 'Name'}
              title="Names the group for agents choosing what to search, and heads its labelled lines. Empty: the relation's name."
              onChange={(e) => onChange({ ...group, label: e.target.value })}
            />
          </label>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={`Remove group ${index + 1}`}
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {option === undefined ? (
        <p className="text-xs text-destructive">
          Relation type <code>{group.relationType}</code> does not connect this entity type in
          direction {group.direction} — choose another relation or remove the group.
        </p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">
              Relation fields{' '}
              <span className="font-normal text-muted-foreground">
                · {relationType?.displayName ?? group.relationType}
              </span>
            </span>
            <FieldChecklist
              idPrefix={`g${index}-rel`}
              properties={(relationType?.properties ?? []).filter(isTextProperty)}
              selected={group.fields}
              emptyText="This relation type has no text properties."
              disabledReason={limitReason}
              onToggle={(k, on) => onChange({ ...group, fields: toggleKey(group.fields, k, on) })}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium">
              Target fields
              <TypeDot typeKey={option.otherEnd} />
              <span className="font-normal text-muted-foreground">
                {target?.displayName ?? option.otherEnd}
              </span>
            </span>
            <FieldChecklist
              idPrefix={`g${index}-target`}
              properties={(target?.properties ?? []).filter(isTextProperty)}
              selected={targetFields}
              emptyText="The target type has no text properties."
              disabledReason={limitReason}
              onToggle={(k, on) =>
                onChange({
                  ...group,
                  target: { [option.otherEnd]: toggleKey(targetFields, k, on) },
                })
              }
            />
          </div>
          {draft.semantic.enabled && (
            <SemanticTextChoice
              id={`g${index}-template`}
              template={group.template}
              labelledHint={`The owner line, the group's name, then each field as “Label: value”.`}
              placeholder="{name} is {role} at {target.name}, since {since}."
              placeholders={groupPlaceholders(draft, root, group)}
              onChange={(template) => onChange({ ...group, template })}
            />
          )}
          {showPreview && (
            <EntryPreview
              part={part}
              types={part && partTypes(schema, root.key, part)}
              caption={
                <>
                  One entry per {relationName} relation of a {root.displayName} — never two
                  relations in one entry
                </>
              }
              semantic={draft.semantic.enabled}
              keyword={draft.keyword.enabled}
              stale={stale}
              warnings={warnings}
              leftOut={leftOut}
              ownerLines={ownerLines}
            />
          )}
        </>
      )}
      <IssueList issues={issues} />
    </div>
  )
}

/**
 * How an entry's semantic text is written: labelled lines from the schema,
 * or a template of the modeler's own. A template set aside by switching
 * to labelled lines comes back when switching again, until the designer
 * is left or saved.
 */
function SemanticTextChoice({
  id,
  template,
  labelledHint,
  placeholder,
  placeholders,
  onChange,
}: {
  id: string
  /** Null: labelled lines; a string, even empty: template mode. */
  template: string | null
  labelledHint: string
  placeholder: string
  placeholders: string[]
  onChange: (template: string | null) => void
}) {
  const [setAside, setSetAside] = useState(template ?? '')
  const mode = template === null ? 'labelled' : 'template'
  const choose = (next: 'labelled' | 'template') => {
    if (next === mode) return
    if (next === 'labelled') {
      setSetAside(template ?? '')
      onChange(null)
    } else {
      onChange(setAside)
    }
  }
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium">Semantic text</span>
        <div role="radiogroup" aria-label="How the semantic text is written" className="inline-flex rounded-md border p-0.5 text-xs">
          {(['labelled', 'template'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => choose(m)}
              className={cn(
                'rounded px-2 py-0.5 transition-colors',
                mode === m ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'labelled' ? 'Labelled lines' : 'Template'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mode === 'labelled'
            ? labelledHint
            : 'Your text replaces the labelled lines — no owner line or name is added in front.'}
        </span>
      </div>
      {mode === 'template' && (
        <div className="grid gap-1">
          <TemplateField
            id={id}
            rows={2}
            value={template ?? ''}
            placeholder={placeholder}
            placeholders={placeholders}
            onChange={onChange}
          />
          <p className="text-xs text-muted-foreground">
            A placeholder without a value drops its clause — the text up to the next{' '}
            <code>,</code> <code>;</code> <code>.</code> or line break. Until the template is
            written, the labelled lines are embedded.
          </p>
        </div>
      )}
    </div>
  )
}

/** A template textarea with the placeholders it can resolve, inserted at the cursor on click. */
function TemplateField({
  id,
  rows,
  value,
  placeholder,
  placeholders,
  onChange,
}: {
  id: string
  rows: number
  value: string
  placeholder: string
  placeholders: string[]
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const insert = (token: string) => {
    const area = ref.current
    const start = area?.selectionStart ?? value.length
    const end = area?.selectionEnd ?? value.length
    onChange(insertAt(value, token, start, end))
    requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <div className="grid gap-1">
      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        className="min-h-8 font-mono text-xs"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {placeholders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Insert</span>
          {placeholders.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => insert(token)}
              className="rounded border px-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {token}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
