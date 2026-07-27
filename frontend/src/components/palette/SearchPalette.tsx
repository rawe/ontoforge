import { Command as CommandPrimitive } from 'cmdk'
import {
  Clock,
  FileText,
  LayoutDashboard,
  Loader2,
  Moon,
  Search,
  Shapes,
  Sparkles,
  SquareTerminal,
  Waypoints,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  useMemo,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeatures, useRuntimeSchema } from '@/api/hooks'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { displayLabel } from '@/lib/displayLabel'
import { readRecents, type RecentEntity } from '@/lib/recents'
import { cn } from '@/lib/utils'
import {
  useDebouncedValue,
  useEntitySearch,
  useSavedQuerySearch,
  type EntitySearchResult,
} from './usePaletteSearch'

/* --------------------------------- helpers ---------------------------------- */

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

function StatusRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-8 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  )
}

/** Similarity bar — feed it the raw cosine (`matchedVia.similarity`), never
 * the RRF fusion `score` (ordering only, tiny values). */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5" aria-label={`Score ${pct}%`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary/60"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-7 text-right font-mono text-[10px] text-muted-foreground">
        {pct}%
      </span>
    </span>
  )
}

type Mode = 'entities' | 'types' | 'queries' | 'actions'

interface PaletteAction {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  run: () => void
  /** Extra terms the `>` filter should match. */
  keywords: string
}

const ENTITY_VALUE_RE = /^(?:entity|recent):([^:]+):(.+)$/

/* --------------------------------- palette ---------------------------------- */

interface SearchPaletteProps {
  ontologyKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Cmd+K palette: cross-type (semantic) entity search by default, `#` to scope
 * to one entity type, `?` for saved queries, `>` for navigation/actions.
 * Enter opens an entity's detail page; Cmd+Enter focuses it in the Explorer.
 *
 * The stateful content only mounts while the dialog is open, so every open
 * starts with a fresh input, scope and recents snapshot.
 */
export function SearchPalette({ ontologyKey, open, onOpenChange }: SearchPaletteProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search entities, saved queries and actions"
      className="top-[18%] sm:max-w-xl"
    >
      {open && <PaletteContent ontologyKey={ontologyKey} onOpenChange={onOpenChange} />}
    </CommandDialog>
  )
}

function PaletteContent({
  ontologyKey,
  onOpenChange,
}: Omit<SearchPaletteProps, 'open'>) {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const { data: features } = useFeatures()
  const schema = useRuntimeSchema(ontologyKey)

  const [input, setInput] = useState('')
  const [scopedType, setScopedType] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [recents] = useState<RecentEntity[]>(() => readRecents(ontologyKey))

  const base = `/w/${ontologyKey}`
  const semantic = features?.semanticSearch === true
  const entityTypes = useMemo(() => schema.data?.entityTypes ?? [], [schema.data])
  const typeName = (key: string) =>
    entityTypes.find((t) => t.key === key)?.displayName ?? key

  /* ------------------------------ mode parsing ------------------------------ */

  let mode: Mode = 'entities'
  let q = input.trim()
  if (scopedType === null && input.startsWith('>')) {
    mode = 'actions'
    q = input.slice(1).trim()
  } else if (scopedType === null && input.startsWith('?')) {
    mode = 'queries'
    q = input.slice(1).trim()
  } else if (scopedType === null && input.startsWith('#')) {
    mode = 'types'
    q = input.slice(1).trim()
  }

  const debouncedQ = useDebouncedValue(q, 250)
  // Gate on the live value too, so stale results don't linger for an input
  // that no longer qualifies (e.g. after clearing to below 2 chars).
  const entitySearchEnabled =
    mode === 'entities' &&
    features !== undefined &&
    entityTypes.length > 0 &&
    (scopedType !== null || (q.length >= 2 && debouncedQ.length >= 2))

  const entitySearch = useEntitySearch({
    ontologyKey,
    q: mode === 'entities' ? debouncedQ : '',
    typeKey: scopedType ?? undefined,
    semantic,
    allTypeKeys: entityTypes.map((t) => t.key),
    enabled: entitySearchEnabled,
  })

  const savedQuerySearch = useSavedQuerySearch(
    ontologyKey,
    mode === 'queries' ? debouncedQ : '',
    semantic,
    mode === 'queries',
  )

  /* -------------------------------- grouping -------------------------------- */

  const groups = useMemo(() => {
    const map = new Map<string, EntitySearchResult[]>()
    for (const result of entitySearch.data ?? []) {
      const key = result.entity._entityTypeKey
      const list = map.get(key)
      if (list === undefined) map.set(key, [result])
      else list.push(result)
    }
    return [...map.entries()]
  }, [entitySearch.data])

  /* --------------------------------- actions --------------------------------- */

  const close = () => onOpenChange(false)
  const go = (to: string) => {
    close()
    navigate(to)
  }

  const actions: PaletteAction[] = [
    {
      id: 'home',
      label: 'Go to Home',
      icon: LayoutDashboard,
      run: () => go(base),
      keywords: 'dashboard overview',
    },
    {
      id: 'explore',
      label: 'Go to Explore',
      icon: Waypoints,
      run: () => go(`${base}/explore`),
      keywords: 'canvas graph',
    },
    {
      id: 'query',
      label: 'Go to Query',
      icon: SquareTerminal,
      run: () => go(`${base}/query`),
      keywords: 'oql query console',
    },
    ...(features?.ai !== false
      ? [
          {
            id: 'ai',
            label: 'Go to AI',
            icon: Sparkles,
            run: () => go(`${base}/ai`),
            keywords: 'assistant chat',
          } satisfies PaletteAction,
        ]
      : []),
    {
      id: 'studio',
      label: 'Open Studio',
      icon: Shapes,
      run: () => go('/studio'),
      keywords: 'schema modeling',
    },
    {
      id: 'theme',
      label: 'Toggle theme',
      icon: Moon,
      run: () => {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
        close()
      },
      keywords: 'dark light mode',
    },
  ]

  const filteredActions = actions.filter(
    (a) =>
      q === '' || `${a.label} ${a.keywords}`.toLowerCase().includes(q.toLowerCase()),
  )

  const filteredTypes = entityTypes.filter(
    (t) =>
      q === '' ||
      t.displayName.toLowerCase().includes(q.toLowerCase()) ||
      t.key.includes(q.toLowerCase()),
  )

  /* -------------------------------- keyboard -------------------------------- */

  const handleCommandKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      const match = ENTITY_VALUE_RE.exec(selected)
      if (match !== null) {
        e.preventDefault()
        e.stopPropagation()
        go(`${base}/explore?focus=${match[1]}:${match[2]}`)
      }
    }
  }

  const handleInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Backspace' && input === '' && scopedType !== null) {
      e.preventDefault()
      setScopedType(null)
    }
  }

  /* ------------------------------ result renders ----------------------------- */

  const entityItem = (result: EntitySearchResult, valuePrefix: 'entity' | 'recent') => {
    const { entity, score, matchedVia } = result
    // Display similarity comes from matchedVia (raw cosine); the top-level
    // score is an RRF fusion value and only meaningful for ordering.
    const similarity = matchedVia?.similarity ?? score
    const documentMatch =
      matchedVia?.source === 'document' && matchedVia.propertyKey !== undefined
        ? matchedVia
        : undefined
    return (
      <CommandItem
        key={`${valuePrefix}:${entity._id}`}
        value={`${valuePrefix}:${entity._entityTypeKey}:${entity._id}`}
        onSelect={() => go(`${base}/e/${entity._entityTypeKey}/${entity._id}`)}
        className={documentMatch !== undefined ? 'flex-col items-stretch gap-1' : undefined}
      >
        <span className="flex min-w-0 items-center gap-2">
          {valuePrefix === 'recent' && (
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <TypeChip
            typeKey={entity._entityTypeKey}
            displayName={typeName(entity._entityTypeKey)}
            size="sm"
          />
          <span className="min-w-0 flex-1 truncate">{displayLabel(entity)}</span>
          {similarity !== undefined && <ScoreBar score={similarity} />}
        </span>
        {documentMatch !== undefined && (
          <span className="flex min-w-0 items-center gap-1.5 pl-0.5">
            <span className="inline-flex shrink-0 items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              <FileText className="size-2.5" aria-hidden />
              matched in {documentMatch.propertyKey}
            </span>
            {documentMatch.snippet !== undefined && (
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {documentMatch.snippet}
              </span>
            )}
          </span>
        )}
      </CommandItem>
    )
  }

  const searching = entitySearch.isFetching || q !== debouncedQ

  // cmdk only auto-selects on input changes, so results that arrive later
  // (debounce + fetch) can leave nothing highlighted. Selection is therefore
  // controlled, adjusted during render to the first item when stale.
  const itemValues: string[] =
    mode === 'actions'
      ? filteredActions.map((a) => `action:${a.id}`)
      : mode === 'types'
        ? filteredTypes.map((t) => `type:${t.key}`)
        : mode === 'queries'
          ? (savedQuerySearch.data ?? []).map((sq) => `query:${sq.key}`)
          : !entitySearchEnabled
            ? q === ''
              ? recents.map((r) => `recent:${r.typeKey}:${r.id}`)
              : []
            : (entitySearch.data ?? []).map(
                (r) => `entity:${r.entity._entityTypeKey}:${r.entity._id}`,
              )
  if (itemValues.length > 0 && !itemValues.includes(selected)) {
    setSelected(itemValues[0]!)
  } else if (itemValues.length === 0 && selected !== '') {
    setSelected('')
  }

  let listContent: ReactNode
  if (mode === 'actions') {
    listContent =
      filteredActions.length === 0 ? (
        <StatusRow>No matching action.</StatusRow>
      ) : (
        <CommandGroup heading="Actions">
          {filteredActions.map((a) => (
            <CommandItem key={a.id} value={`action:${a.id}`} onSelect={a.run}>
              <a.icon className="size-4 text-muted-foreground" />
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
      )
  } else if (mode === 'types') {
    listContent =
      filteredTypes.length === 0 ? (
        <StatusRow>No matching entity type.</StatusRow>
      ) : (
        <CommandGroup heading="Search within a type">
          {filteredTypes.map((t) => (
            <CommandItem
              key={t.key}
              value={`type:${t.key}`}
              onSelect={() => {
                setScopedType(t.key)
                setInput('')
                setSelected('')
              }}
            >
              <TypeDot typeKey={t.key} />
              <span className="min-w-0 flex-1 truncate">{t.displayName}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{t.key}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )
  } else if (mode === 'queries') {
    const queries = savedQuerySearch.data ?? []
    listContent = savedQuerySearch.isPending ? (
      <StatusRow>
        <Loader2 className="size-4 animate-spin" /> Searching saved queries…
      </StatusRow>
    ) : queries.length === 0 ? (
      <StatusRow>
        {debouncedQ === ''
          ? 'No saved queries in this ontology.'
          : `No saved query matches “${debouncedQ}”.`}
      </StatusRow>
    ) : (
      <CommandGroup heading="Saved queries">
        {queries.map((sq) => (
          <CommandItem
            key={sq.key}
            value={`query:${sq.key}`}
            onSelect={() => go(`${base}/query?run=${encodeURIComponent(sq.key)}`)}
          >
            <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {sq.name}
              {sq.description !== null && sq.description !== '' && (
                <span className="ml-1.5 text-muted-foreground">— {sq.description}</span>
              )}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">{sq.key}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    )
  } else if (!entitySearchEnabled) {
    // Entities mode, but not enough input to search yet → recents / hint.
    listContent =
      q === '' && recents.length > 0 ? (
        <CommandGroup heading="Recent">
          {recents.map((r) =>
            entityItem(
              {
                entity: {
                  _id: r.id,
                  _entityTypeKey: r.typeKey,
                  _createdAt: '',
                  _updatedAt: '',
                  name: r.label,
                },
              },
              'recent',
            ),
          )}
        </CommandGroup>
      ) : (
        <StatusRow>
          {q === ''
            ? 'Type at least 2 characters to search.'
            : 'Keep typing — search starts at 2 characters.'}
        </StatusRow>
      )
  } else if (groups.length === 0) {
    listContent = searching ? (
      <StatusRow>
        <Loader2 className="size-4 animate-spin" /> Searching…
      </StatusRow>
    ) : (
      <StatusRow>
        No {scopedType !== null ? typeName(scopedType) : 'entity'} matches
        {debouncedQ !== '' ? ` “${debouncedQ}”` : ''}.
      </StatusRow>
    )
  } else {
    listContent = groups.map(([typeKey, results]) => (
      <CommandGroup key={typeKey} heading={typeName(typeKey)}>
        {results.map((r) => entityItem(r, 'entity'))}
      </CommandGroup>
    ))
  }

  const placeholder =
    scopedType !== null
      ? `Search ${typeName(scopedType)}…`
      : 'Search entities…'

  return (
    <Command
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      onKeyDown={handleCommandKeyDown}
    >
        <div className="flex items-center gap-2 border-b px-3">
          {searching && entitySearchEnabled ? (
            <Loader2 className="size-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <Search className="size-4 shrink-0 opacity-50" />
          )}
          {scopedType !== null && (
            <TypeChip
              typeKey={scopedType}
              displayName={typeName(scopedType)}
              size="sm"
            />
          )}
          <CommandPrimitive.Input
            data-slot="command-input"
            autoFocus
            value={input}
            onValueChange={setInput}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Kbd>esc</Kbd>
        </div>
        <CommandList className="max-h-80">{listContent}</CommandList>
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⌘↵</Kbd> explore
          </span>
          {scopedType !== null ? (
            <span className="ml-auto flex items-center gap-1">
              <Kbd>⌫</Kbd> unscope
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-2.5">
              <span className="flex items-center gap-1">
                <Kbd>#</Kbd> types
              </span>
              <span className="flex items-center gap-1">
                <Kbd>?</Kbd> queries
              </span>
              <span className="flex items-center gap-1">
                <Kbd>&gt;</Kbd> actions
              </span>
            </span>
          )}
        </div>
    </Command>
  )
}
