/**
 * The schema page's outline, in both views: entity types and relation types
 * (source → target), each expandable to its properties, with a search box
 * that filters the list (and highlights matches on the graph). Clicking a
 * type selects and reveals it; clicking a property also opens and flashes its
 * row in the inspector or on the classic page. `/` focuses the search from
 * anywhere on the page. Collapses to a thin rail, stored per ontology.
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  ArrowRight,
  Box,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Tag,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { PropertyDefinition } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { Button } from '@/components/ui/button'
import { isPlainKey, isTyping, overlayOpen } from '@/lib/shortcuts'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { searchSchema } from '../modeling/search'
import { useModelSchema, type TypeKind } from '../modeling/useModelSchema'
import type { SchemaSelection } from './schemaUrl'
import { useSchemaWorkspace, type PropertyRequest } from './workspaceContext'

/** The outline row of a type (`data-outline`, and the expanded set). */
const rowId = (sel: SchemaSelection) => `${sel.kind}:${sel.key}`

export function Outline() {
  const { ontologyKey } = useSchemaWorkspace()
  const storageKey = storageKeys.schemaOutline(ontologyKey)
  const [collapsed, setCollapsedState] = useState(() => readString(storageKey) === 'collapsed')
  // The search box takes focus when the panel opens from `/` or the rail's search button.
  const [focusSearch, setFocusSearch] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const setCollapsed = (next: boolean) => {
    setCollapsedState(next)
    writeString(storageKey, next ? 'collapsed' : 'expanded')
  }
  const openSearch = () => {
    if (!collapsed) {
      searchRef.current?.focus()
      return
    }
    setFocusSearch(true)
    setCollapsed(false)
  }

  // `/` from either view, also while the outline is collapsed.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== '/' || e.repeat || !isPlainKey(e)) return
    if (e.defaultPrevented || isTyping(e) || overlayOpen(e)) return
    e.preventDefault()
    openSearch()
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center gap-1 border-r bg-card/30 py-2" aria-label="Outline">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show outline"
          title="Show outline"
          onClick={() => {
            setFocusSearch(false)
            setCollapsed(false)
          }}
        >
          <PanelLeftOpen />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Search (/)" title="Search (/)" onClick={openSearch}>
          <Search />
        </Button>
      </aside>
    )
  }
  return <OutlinePanel searchRef={searchRef} autoFocusSearch={focusSearch} onCollapse={() => setCollapsed(true)} />
}

function OutlinePanel({
  searchRef,
  autoFocusSearch,
  onCollapse,
}: {
  searchRef: RefObject<HTMLInputElement | null>
  autoFocusSearch: boolean
  onCollapse: () => void
}) {
  const { ontologyKey, selection, select, propertyRequest, search, setSearch } = useSchemaWorkspace()
  const { entityTypes, relationTypes, properties } = useModelSchema(ontologyKey)
  const matches = useMemo(
    () => searchSchema({ entityTypes, relationTypes, properties }, search),
    [entityTypes, relationTypes, properties, search],
  )
  const shownEntities = matches.active ? entityTypes.filter((t) => matches.entityIds.has(t.entityTypeId)) : entityTypes
  const shownRelations = matches.active
    ? relationTypes.filter((r) => matches.relationIds.has(r.relationTypeId))
    : relationTypes

  // A property opened anywhere (a node's row, the address) expands its owner here.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [seenRequest, setSeenRequest] = useState<PropertyRequest | null>(null)
  if (propertyRequest !== seenRequest) {
    setSeenRequest(propertyRequest)
    const owner = propertyRequest === null || selection === null ? null : rowId(selection)
    if (owner !== null && !expanded.has(owner)) setExpanded(new Set(expanded).add(owner))
  }
  const toggle = (id: string) => {
    const next = new Set(expanded)
    if (!next.delete(id)) next.add(id)
    setExpanded(next)
  }

  // Keep the selected row in view; the selection may come from the graph or the address.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selection === null) return
    listRef.current
      ?.querySelector(`[data-outline="${CSS.escape(rowId(selection))}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  const selectType = (sel: SchemaSelection, propertyKey?: string) => select(sel, { reveal: true, propertyKey })
  const isSelected = (sel: SchemaSelection) => selection !== null && rowId(selection) === rowId(sel)

  const jumpToFirst = () => {
    const et = shownEntities[0]
    const rt = shownRelations[0]
    if (et !== undefined) selectType({ kind: 'entity-types', key: et.key })
    else if (rt !== undefined) selectType({ kind: 'relation-types', key: rt.key })
  }

  const item = (kind: TypeKind, key: string, ownerId: string, nameProperty: string | undefined, label: ReactNode) => {
    const sel = { kind, key }
    const id = rowId(sel)
    const props = properties[ownerId]
    const selected = isSelected(sel)
    return (
      <TypeItem
        key={id}
        id={id}
        selected={selected}
        open={expanded.has(id) || (matches.active && (props ?? []).some((p) => matches.propertyIds.has(p.propertyId)))}
        onToggle={() => toggle(id)}
        onSelect={() => selectType(sel)}
        properties={props}
        nameProperty={nameProperty}
        matches={matches.propertyIds}
        activeProperty={selected ? propertyRequest?.propertyKey : undefined}
        onSelectProperty={(propertyKey) => selectType(sel, propertyKey)}
        twoLine={kind === 'relation-types'}
      >
        {label}
      </TypeItem>
    )
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card/30 2xl:w-64" aria-label="Outline">
      <div className="flex items-center gap-1 border-b p-2">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            autoFocus={autoFocusSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Clears the search only; the graph's Esc must not see it.
                e.stopPropagation()
                setSearch('')
                e.currentTarget.blur()
              } else if (e.key === 'Enter') {
                jumpToFirst()
              }
            }}
            placeholder="Search…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
            aria-label="Search types and properties"
          />
          {search !== '' ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="rounded border px-1 font-mono text-[10px] text-muted-foreground">/</kbd>
          )}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Hide outline" title="Hide outline" onClick={onCollapse}>
          <PanelLeftClose />
        </Button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
        <SectionHeading icon={Box} label="Entity types" count={shownEntities.length} />
        <ul className="px-1.5">
          {shownEntities.map((t) =>
            item(
              'entity-types',
              t.key,
              t.entityTypeId,
              t.nameProperty,
              <>
                <TypeDot typeKey={t.key} />
                <span className="truncate font-medium">{t.displayName}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">{t.key}</span>
              </>,
            ),
          )}
        </ul>

        <SectionHeading icon={Workflow} label="Relation types" count={shownRelations.length} className="mt-3" />
        <ul className="px-1.5">
          {shownRelations.map((r) =>
            item(
              'relation-types',
              r.key,
              r.relationTypeId,
              undefined,
              <span className="grid min-w-0 gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">{r.displayName}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{r.key}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                  <TypeDot typeKey={r.sourceEntityTypeKey} className="size-1.5" />
                  <span className="truncate">{r.sourceEntityTypeKey}</span>
                  <ArrowRight className="size-2.5 shrink-0" />
                  <TypeDot typeKey={r.targetEntityTypeKey} className="size-1.5" />
                  <span className="truncate">{r.targetEntityTypeKey}</span>
                </span>
              </span>,
            ),
          )}
        </ul>
        {matches.active && shownEntities.length === 0 && shownRelations.length === 0 && (
          <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">No match for “{search.trim()}”.</p>
        )}
      </div>
    </aside>
  )
}

function TypeItem({
  id,
  selected,
  open,
  onToggle,
  onSelect,
  properties,
  nameProperty,
  matches,
  activeProperty,
  onSelectProperty,
  twoLine,
  children,
}: {
  id: string
  selected: boolean
  open: boolean
  onToggle: () => void
  onSelect: () => void
  /** `undefined` while the list loads. */
  properties: PropertyDefinition[] | undefined
  /** The entity type's name property; listed first. */
  nameProperty: string | undefined
  /** Property ids that match the search. */
  matches: ReadonlySet<string>
  /** Key of the property opened in the address, when this type is selected. */
  activeProperty: string | undefined
  onSelectProperty: (propertyKey: string) => void
  twoLine: boolean
  children: ReactNode
}) {
  const sorted = [...(properties ?? [])].sort((a, b) =>
    a.key === nameProperty ? -1 : b.key === nameProperty ? 1 : a.key.localeCompare(b.key),
  )
  return (
    <li>
      <div
        data-outline={id}
        role="button"
        tabIndex={0}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md pr-1.5 pl-0.5 text-[12.5px] outline-none hover:bg-muted/60 focus-visible:bg-muted/60',
          twoLine ? 'py-1' : 'h-7',
          selected && 'bg-sidebar-accent text-foreground hover:bg-sidebar-accent',
        )}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect()
        }}
      >
        <button
          type="button"
          aria-label={open ? 'Hide properties' : 'Show properties'}
          aria-expanded={open}
          className={cn(
            'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted',
            twoLine && 'mt-px self-start',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
        {children}
        <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground/70">{properties?.length ?? ''}</span>
      </div>
      {open && (
        <ul className="mb-1 ml-[11px] border-l pl-2">
          {properties !== undefined && sorted.length === 0 && (
            <li className="px-1.5 py-1 text-[11px] text-muted-foreground/70 italic">No properties</li>
          )}
          {sorted.map((p) => (
            <li
              key={p.propertyId}
              role="button"
              tabIndex={0}
              className={cn(
                'flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[11.5px] outline-none hover:bg-muted/60 focus-visible:bg-muted/60',
                matches.has(p.propertyId) && 'bg-(--tc-amber-bg)',
                activeProperty === p.key && 'bg-sidebar-accent hover:bg-sidebar-accent',
              )}
              onClick={() => onSelectProperty(p.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectProperty(p.key)
              }}
            >
              <span className="truncate font-mono">{p.key}</span>
              {p.key === nameProperty && <Tag className="size-2.5 shrink-0 text-primary" aria-label="Name property" />}
              {p.required && (
                <span className="text-(--tc-rose)" title="Required">
                  *
                </span>
              )}
              <span className="ml-auto pl-2 font-mono text-[10px] text-muted-foreground">{p.dataType}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function SectionHeading({
  icon: Icon,
  label,
  count,
  className,
}: {
  icon: LucideIcon
  label: string
  count: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1.5 px-3 pt-1 pb-1', className)}>
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
      <span className="text-[10.5px] text-muted-foreground/70">{count}</span>
    </div>
  )
}
