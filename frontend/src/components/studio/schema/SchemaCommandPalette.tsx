/**
 * The schema page's command palette (`⌘K` / `Ctrl+K`, or the header's
 * "Commands" button). Every action goes through the same modeling hooks and
 * workspace calls as the graph, the outline and the inspector; each command
 * with a key in the current view shows it as a chip.
 *
 * From the root, a line such as `person -mentors-> intern` or
 * `person mentors intern` creates a relation type, and its unknown
 * endpoints as new entity types first (`quickCreate.ts`). Commands and
 * "Go to" entries are listed above it, so "switch to classic" runs the
 * command. The content mounts only while open: every open starts at the
 * root with an empty input.
 */

import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Box,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  LayoutGrid,
  ListPlus,
  Moon,
  PanelRight,
  PanelTop,
  Plus,
  Sparkles,
  Sun,
  Trash2,
  Waypoints,
  Workflow,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import type { DataType } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { allCollapsedOf, toggleAllCollapsed, toggleCollapsed, useCollapsed } from '../graph/graphStore'
import { useRequestDelete, type TypeRef } from '../modeling/deleteContext'
import { useCreateEntityType, useCreateProperty, useCreateRelationType } from '../modeling/mutations'
import { missingEnds, parseQuickRelation, type QuickRelation } from '../modeling/quickCreate'
import { dataTypesFor, deriveKey, humanize, keyProblem, keyProblemAmong } from '../modeling/schemaKeys'
import { findTypeByKey, useModelSchema } from '../modeling/useModelSchema'
import type { SchemaSelection } from './schemaUrl'
import { useSchemaWorkspace } from './workspaceContext'

type Page =
  | { id: 'root' }
  | { id: 'new-entity' }
  | { id: 'new-relation' }
  | { id: 'pick-owner' }
  | { id: 'add-property'; owner: Owner }

/** A type that gets a property, with its display name for the labels. */
type Owner = TypeRef & { name: string }

const PLACEHOLDER: Record<Page['id'], string> = {
  root: 'Type a command, a type to go to, or  person -mentors-> intern',
  'new-entity': 'Display name of the new entity type…',
  'new-relation': 'person -mentors-> intern   or   person mentors intern',
  'pick-owner': 'Add a property to which type?',
  'add-property': 'Property name, optionally “Name : type”',
}

/** Every whitespace-separated token of the query occurs in the text (case-insensitive). */
const matchAll = (query: string, text: string) => {
  const hay = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token))
}

const selectionOf = (type: TypeRef): SchemaSelection => ({ kind: type.kind, key: type.key })

export function SchemaCommandPalette() {
  const { paletteOpen, setPaletteOpen } = useSchemaWorkspace()

  // ⌘K / Ctrl+K toggles the palette, also while typing. An effect event, so
  // the listener always sees the latest open state.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'k') return
    e.preventDefault()
    if (!e.repeat) setPaletteOpen(!paletteOpen)
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      title="Schema commands"
      description="Create, find and change entity types, relation types and properties"
      className="sm:max-w-xl"
    >
      {paletteOpen && (
        <Command shouldFilter={false} loop>
          <PaletteBody close={() => setPaletteOpen(false)} />
        </Command>
      )}
    </CommandDialog>
  )
}

function PaletteBody({ close }: { close: () => void }) {
  const ws = useSchemaWorkspace()
  const { ontologyKey, view, selection, select } = ws
  const schema = useModelSchema(ontologyKey)
  const { entityTypes, relationTypes } = schema
  const { create: createEntityType } = useCreateEntityType(ontologyKey)
  const { create: createRelationType } = useCreateRelationType(ontologyKey)
  const requestDelete = useRequestDelete()
  const collapsed = useCollapsed(ontologyKey)
  const { resolvedTheme, setTheme } = useTheme()
  const [page, setPageState] = useState<Page>({ id: 'root' })
  const [query, setQuery] = useState('')

  const setPage = (next: Page) => {
    setPageState(next)
    setQuery('')
  }
  const graph = view === 'graph'
  /** The key's chip, where the key works: graph-only keys are not shown in Classic. */
  const graphKey = (key: string) => (graph ? key : undefined)

  const selectedType = selection === null ? undefined : findTypeByKey(schema, selection.kind, selection.key)
  const selected: Owner | null =
    selection === null || selectedType === undefined
      ? null
      : {
          kind: selection.kind,
          key: selection.key,
          id: 'entityTypeId' in selectedType ? selectedType.entityTypeId : selectedType.relationTypeId,
          name: selectedType.displayName,
        }
  const entityIds = entityTypes.map((t) => t.entityTypeId)
  const allCollapsed = allCollapsedOf(collapsed, entityIds)
  const owners = [
    ...entityTypes.map((t) => ({
      ref: { kind: 'entity-types' as const, id: t.entityTypeId, key: t.key },
      name: t.displayName,
    })),
    ...relationTypes.map((r) => ({
      ref: { kind: 'relation-types' as const, id: r.relationTypeId, key: r.key },
      name: r.displayName,
    })),
  ]

  const quick = page.id === 'root' || page.id === 'new-relation' ? parseQuickRelation(query, entityTypes) : null
  const relationKeys = relationTypes.map((r) => r.key)

  /** Run, then close; for actions that need nothing else. */
  const run = (action: () => void) => () => {
    close()
    action()
  }
  const go = (sel: SchemaSelection) => {
    close()
    select(sel, { reveal: true })
  }

  // The missing entity types first (placed in free spots by the graph), then
  // the relation type, which is selected and revealed. A failure is toasted
  // by the hook; types created before it stay.
  const runQuick = async (q: QuickRelation) => {
    close()
    try {
      for (const end of missingEnds(q)) {
        await createEntityType({ key: end.key, displayName: humanize(end.token) })
      }
      const created = await createRelationType({
        key: q.key,
        displayName: q.displayName,
        sourceEntityTypeKey: q.source.key,
        targetEntityTypeKey: q.target.key,
      })
      select({ kind: 'relation-types', key: created.key }, { reveal: true })
    } catch {
      // Toasted by the create hook.
    }
  }

  const createEntity = async (key: string, displayName: string) => {
    close()
    try {
      const created = await createEntityType({ key, displayName })
      select({ kind: 'entity-types', key: created.key }, { reveal: true })
    } catch {
      // Toasted by the create hook.
    }
  }

  const actions: Item[] = [
    { id: 'new-entity', label: 'New entity type…', icon: <Box />, shortcut: graphKey('N'), run: () => setPage({ id: 'new-entity' }) },
    { id: 'new-relation', label: 'New relation type…', icon: <Workflow />, run: () => setPage({ id: 'new-relation' }) },
    ...(selected !== null
      ? [
          {
            id: 'add-property-selected',
            label: `Add property to ${selected.name}…`,
            icon: <ListPlus />,
            run: () => setPage({ id: 'add-property', owner: selected }),
          },
        ]
      : []),
    { id: 'add-property', label: 'Add property to…', icon: <ListPlus />, run: () => setPage({ id: 'pick-owner' }) },
    ...(graph
      ? [
          {
            id: 'focus',
            label: ws.focusMode ? 'Exit focus' : 'Focus on the selection and its neighbours',
            icon: <Crosshair />,
            shortcut: 'F',
            run: run(ws.toggleFocus),
          },
        ]
      : []),
    {
      id: 'switch-view',
      label: graph ? 'Switch to Classic view' : 'Switch to Graph view',
      icon: graph ? <PanelTop /> : <Waypoints />,
      shortcut: 'V',
      run: run(() => ws.switchView(graph ? 'classic' : 'graph')),
    },
    ...(graph
      ? [
          {
            id: 'toggle-all-properties',
            label: allCollapsed ? 'Show all properties' : 'Hide all properties',
            icon: allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />,
            shortcut: 'H',
            run: run(() => toggleAllCollapsed(ontologyKey, entityIds)),
          },
        ]
      : []),
    ...(graph && selected !== null && selected.kind === 'entity-types'
      ? [
          {
            id: 'toggle-selected-properties',
            label: `${collapsed[selected.id] === true ? 'Show' : 'Hide'} properties of ${selected.name}`,
            icon: collapsed[selected.id] === true ? <ChevronsUpDown /> : <ChevronsDownUp />,
            shortcut: '⇧H',
            run: run(() => toggleCollapsed(ontologyKey, selected.id)),
          },
        ]
      : []),
    ...(graph ? [{ id: 'tidy', label: 'Tidy layout', icon: <LayoutGrid />, run: run(ws.requestTidy) }] : []),
    ...(selected !== null
      ? [
          {
            id: 'delete',
            label: `Delete ${selected.name}…`,
            search: `delete remove ${selected.key} ${selected.name}`,
            icon: <Trash2 />,
            shortcut: graphKey('Del'),
            run: run(() => requestDelete({ what: 'type', kind: selected.kind, id: selected.id })),
          },
        ]
      : []),
    {
      id: 'theme',
      label: `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`,
      search: 'theme dark light mode',
      icon: resolvedTheme === 'dark' ? <Sun /> : <Moon />,
      run: run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')),
    },
  ]

  const goTo: Item[] = [
    ...entityTypes.map((t) => ({
      id: `go-entity-${t.entityTypeId}`,
      label: `Go to ${t.displayName}`,
      search: `go to ${t.key} ${t.displayName}`,
      icon: <TypeDot typeKey={t.key} className="mx-1" />,
      hint: t.key,
      run: () => go({ kind: 'entity-types', key: t.key }),
    })),
    ...relationTypes.map((r) => ({
      id: `go-relation-${r.relationTypeId}`,
      label: `Go to ${r.displayName}`,
      search: `go to ${r.key} ${r.displayName} ${r.sourceEntityTypeKey} ${r.targetEntityTypeKey}`,
      icon: <Workflow />,
      hint: `${r.key} · ${r.sourceEntityTypeKey} → ${r.targetEntityTypeKey}`,
      run: () => go({ kind: 'relation-types', key: r.key }),
    })),
  ]

  return (
    <>
      {page.id !== 'root' && (
        <button
          type="button"
          className="mx-2 mt-1 flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setPage({ id: 'root' })}
        >
          <ChevronLeft className="size-3" /> Back <span className="opacity-60">(Backspace)</span>
        </button>
      )}
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={page.id === 'add-property' ? `${PLACEHOLDER['add-property']} — on ${page.owner.name}` : PLACEHOLDER[page.id]}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && query === '' && page.id !== 'root') {
            e.preventDefault()
            setPage({ id: 'root' })
          }
        }}
      />
      <CommandList className="max-h-96">
        {page.id === 'root' && (
          <>
            <Group heading="Actions" query={query} items={actions} />
            <Group heading="Go to" query={query} items={goTo} />
            {/* Below Actions and Go to, so "switch to classic" runs the command, not a quick-create. */}
            {quick !== null && <QuickGroup quick={quick} relationKeys={relationKeys} onRun={runQuick} />}
            {query.trim() !== '' && (
              <Group
                heading="Add property"
                query={query}
                items={owners.map((o) => ({
                  id: `add-${o.ref.id}`,
                  label: `Add property to ${o.name}…`,
                  search: `add property ${o.ref.key} ${o.name}`,
                  icon: <ListPlus />,
                  run: () => setPage({ id: 'add-property', owner: { ...o.ref, name: o.name } }),
                }))}
              />
            )}
          </>
        )}

        {page.id === 'new-entity' && (
          <NewEntityItems name={query} taken={entityTypes.map((t) => t.key)} onCreate={createEntity} />
        )}

        {page.id === 'new-relation' &&
          (quick !== null ? (
            <QuickGroup quick={quick} relationKeys={relationKeys} onRun={runQuick} />
          ) : (
            <div className="grid gap-2 p-3 text-[12px] text-muted-foreground">
              <p>
                Write <span className="font-mono text-foreground">source -name-&gt; target</span> or{' '}
                <span className="font-mono text-foreground">source name target</span>. Unknown endpoints become new
                entity types.
              </p>
              <p className="flex flex-wrap gap-1.5">
                {entityTypes.map((t) => (
                  <span key={t.key} className="flex items-center gap-1 rounded border px-1.5 font-mono text-[11px]">
                    <TypeDot typeKey={t.key} className="size-1.5" /> {t.key}
                  </span>
                ))}
              </p>
            </div>
          ))}

        {page.id === 'pick-owner' && (
          <Group
            heading="Owner type"
            query={query}
            items={owners.map((o) => ({
              id: `owner-${o.ref.id}`,
              label: o.name,
              search: `${o.ref.key} ${o.name}`,
              icon: o.ref.kind === 'entity-types' ? <TypeDot typeKey={o.ref.key} className="mx-1" /> : <Workflow />,
              hint: o.ref.key,
              run: () => setPage({ id: 'add-property', owner: { ...o.ref, name: o.name } }),
            }))}
          />
        )}

        {page.id === 'add-property' && (
          <AddPropertyItems
            owner={page.owner}
            input={query}
            taken={(schema.properties[page.owner.id] ?? []).map((p) => p.key)}
            close={close}
          />
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>↵ run</span>
        <span>↑↓ move</span>
        <span>⌫ back</span>
        <span className="ml-auto">Esc close</span>
      </div>
    </>
  )
}

/* --------------------------------- pieces --------------------------------- */

/** The item's key, as a chip on the right. */
function Shortcut({ keys }: { keys: string }) {
  return (
    <CommandShortcut>
      <kbd className="rounded border bg-muted px-1.5 py-px font-mono text-[10.5px] tracking-normal">{keys}</kbd>
    </CommandShortcut>
  )
}

interface Item {
  id: string
  label: string
  /** Matched against the query instead of the label. */
  search?: string
  icon?: ReactNode
  hint?: string
  shortcut?: string
  run: () => void
}

/** The items whose text contains every token of the query; nothing when none does. */
function Group({ heading, items, query }: { heading: string; items: Item[]; query: string }) {
  const shown = items.filter((i) => matchAll(query, i.search ?? i.label))
  if (shown.length === 0) return null
  return (
    <CommandGroup heading={heading}>
      {shown.map((i) => (
        <CommandItem key={i.id} value={i.id} onSelect={i.run}>
          {i.icon}
          <span className="truncate">{i.label}</span>
          {i.hint !== undefined && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">{i.hint}</span>
          )}
          {i.shortcut !== undefined && <Shortcut keys={i.shortcut} />}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function QuickGroup({
  quick,
  relationKeys,
  onRun,
}: {
  quick: QuickRelation
  relationKeys: string[]
  onRun: (quick: QuickRelation) => void
}) {
  const missing = missingEnds(quick)
  const relationProblem = keyProblemAmong(quick.key, relationKeys)
  const entityProblem = missing.map((e) => keyProblem(e.key)).find((p) => p !== null) ?? null
  const disabled = relationProblem !== null || entityProblem !== null
  return (
    <CommandGroup heading="Quick create">
      <CommandItem value="quick-create" disabled={disabled} onSelect={() => !disabled && onRun(quick)}>
        <Sparkles className="text-primary" />
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          {missing.length > 0 ? (
            <span className="shrink-0">
              Create <span className="font-mono text-[12px]">{missing.map((e) => e.key).join(', ')}</span> and
              relation
            </span>
          ) : (
            <span className="shrink-0">Create relation</span>
          )}
          <span className="flex min-w-0 items-center gap-1 overflow-hidden rounded bg-muted px-1.5 font-mono text-[11.5px]">
            {quick.source.existing !== null && <TypeDot typeKey={quick.source.key} className="size-1.5" />}
            {quick.source.key}
            <span className="text-primary">-{quick.key}-&gt;</span>
            {quick.target.existing !== null && <TypeDot typeKey={quick.target.key} className="size-1.5" />}
            {quick.target.key}
          </span>
        </span>
        {!disabled && <Shortcut keys="↵" />}
      </CommandItem>
      <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
        {relationProblem !== null
          ? `Relation key: ${relationProblem}`
          : entityProblem !== null
            ? `Entity type key: ${entityProblem}`
            : missing.length > 0
              ? `Not found: ${missing.map((e) => e.token).join(', ')} — will be created as new entity ${missing.length === 1 ? 'type' : 'types'} first.`
              : `“${quick.displayName}” (${quick.key}) from ${quick.source.key} to ${quick.target.key}. Endpoints are permanent.`}
      </p>
    </CommandGroup>
  )
}

function NewEntityItems({
  name,
  taken,
  onCreate,
}: {
  name: string
  taken: string[]
  onCreate: (key: string, displayName: string) => void
}) {
  const displayName = name.trim()
  const key = deriveKey(displayName)
  const problem = displayName === '' ? 'Type a display name.' : keyProblemAmong(key, taken)
  return (
    <CommandGroup heading="New entity type">
      <CommandItem
        value="create-entity"
        disabled={problem !== null}
        onSelect={() => problem === null && onCreate(key, displayName)}
      >
        <Plus />
        <span>Create entity type</span>
        {displayName !== '' && <span className="truncate font-medium">“{displayName}”</span>}
        {key !== '' && <span className="truncate font-mono text-[11px] text-muted-foreground">{key}</span>}
        {problem === null && <Shortcut keys="↵" />}
      </CommandItem>
      <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
        {problem ?? 'The key is derived from the name and permanent once created. A name property is added automatically.'}
      </p>
    </CommandGroup>
  )
}

/**
 * Adds a property through `useCreateProperty`, the inspector form's hook.
 * Its toasts and cascade dialog do not depend on the palette staying open.
 */
function AddPropertyItems({
  owner,
  input,
  taken,
  close,
}: {
  owner: Owner
  input: string
  taken: string[]
  close: () => void
}) {
  const { ontologyKey, select, requestAddProperty } = useSchemaWorkspace()
  const { create } = useCreateProperty(ontologyKey, owner.kind, owner.id)
  const typed = /^(.*?)\s*:\s*(\w*)$/.exec(input)
  const displayName = (typed?.[1] ?? input).trim()
  const typeFilter = (typed?.[2] ?? '').toLowerCase()
  const key = deriveKey(displayName)
  const problem = displayName === '' ? null : keyProblemAmong(key, taken)
  const types = dataTypesFor(owner.kind).filter((t) => t.startsWith(typeFilter))

  const add = (dataType: DataType) => {
    close()
    select(selectionOf(owner), { reveal: true })
    create({ key, displayName, dataType, required: false })
  }

  return (
    <>
      {displayName !== '' && (
        <CommandGroup heading={`Add “${displayName}” to ${owner.name}`}>
          {problem !== null ? (
            <p className="px-2 py-1.5 text-[12px] text-destructive">{problem}</p>
          ) : types.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No data type starts with “{typeFilter}”.</p>
          ) : (
            types.map((t, i) => (
              <CommandItem key={t} value={`type-${t}`} onSelect={() => add(t)}>
                <ListPlus />
                <span className="font-mono text-[12px]">{key}</span>
                <ArrowRight className="size-3 text-muted-foreground" />
                <span className="rounded bg-secondary px-1.5 font-mono text-[11px]">{t}</span>
                {i === 0 && <Shortcut keys="↵" />}
              </CommandItem>
            ))
          )}
        </CommandGroup>
      )}
      <CommandGroup heading="More">
        <CommandItem
          value="open-form"
          onSelect={() => {
            close()
            requestAddProperty(selectionOf(owner))
          }}
        >
          <PanelRight />
          Open the full property form (required, default, description)…
        </CommandItem>
      </CommandGroup>
    </>
  )
}
