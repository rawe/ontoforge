import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { IndexKind, IndexState, Representation } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { Checkbox } from '@/components/ui/checkbox'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import { emptyScopeText, scopeSummary, type ScopeField, type SearchMode } from './searchModel'

/** One thing the scope can name: a type, an index or a document. */
export interface ScopeChoice {
  key: string
  label: string
  /** The entity type it belongs to — its colour, and its group. */
  typeKey: string
  /** The group heading; none lists the choice ungrouped. */
  group?: string
  /** An index's description, a custom one's shown under its name. */
  description?: string
  index?: { kind: IndexKind; modes: Representation[]; status: IndexState }
}

const KIND_LABEL: Record<IndexKind, string> = { default: 'fields', passage: 'passages', custom: 'custom' }

/** What an index row says beside its name: its kind, a missing method, a state that is not ready.
 * Without semantic search every index ranks by keyword only, so that goes unsaid. */
function IndexTags({ index, semanticAvailable }: { index: NonNullable<ScopeChoice['index']>; semanticAvailable: boolean }) {
  const oneMode =
    index.modes.length === 0
      ? 'no method'
      : index.modes.length === 1 && (semanticAvailable || index.modes[0] === 'semantic')
        ? `${index.modes[0]} only`
        : null
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground">
      {index.status !== 'ready' && (
        <span className="text-amber-700 dark:text-amber-400">{index.status}</span>
      )}
      {oneMode !== null && <span>{oneMode}</span>}
      <span className="rounded border px-1 py-px">{KIND_LABEL[index.kind]}</span>
    </span>
  )
}

/**
 * The scope's list for one field: a filter over the choices, a checkbox per
 * choice — indices and documents grouped by their type — the chosen ones as
 * removable chips above, and what an empty choice searches below. Scales to
 * many types and indices; the list scrolls within its own box.
 */
export function ScopePicker({
  field,
  mode,
  choices,
  chosen,
  onChange,
  semanticAvailable,
}: {
  field: ScopeField
  mode: SearchMode
  semanticAvailable: boolean
  choices: readonly ScopeChoice[]
  chosen: readonly string[]
  onChange: (keys: string[]) => void
}) {
  const [text, setText] = useState('')
  const needle = text.trim().toLowerCase()
  const shown = useMemo(
    () =>
      needle === ''
        ? choices
        : choices.filter((c) =>
            [c.label, c.key, c.group ?? '', c.description ?? ''].some((s) => s.toLowerCase().includes(needle)),
          ),
    [choices, needle],
  )
  const groups = useMemo(() => {
    const byGroup = new Map<string, ScopeChoice[]>()
    for (const c of shown) byGroup.set(c.group ?? '', [...(byGroup.get(c.group ?? '') ?? []), c])
    return [...byGroup.entries()]
  }, [shown])
  const chosenSet = new Set(chosen)
  const byKey = new Map(choices.map((c) => [c.key, c]))
  const toggle = (key: string) =>
    onChange(chosenSet.has(key) ? chosen.filter((k) => k !== key) : [...chosen, key])
  const shownKeys = shown.map((c) => c.key)
  const allShownChosen = shownKeys.length > 0 && shownKeys.every((k) => chosenSet.has(k))

  if (choices.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing to choose in this lens.</p>
  }

  return (
    <div className="space-y-2">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chosen.map((key) => {
            const choice = byKey.get(key)
            const color = getTypeColor(choice?.typeKey ?? key)
            return (
              <span
                key={key}
                className={cn(
                  'inline-flex max-w-full items-center gap-1 rounded-md border py-px pr-0.5 pl-1.5 text-[11px] font-medium',
                  color.chip,
                )}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', color.dot)} aria-hidden />
                <span className="truncate">
                  {choice?.group !== undefined ? `${choice.group} · ${choice.label}` : (choice?.label ?? key)}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="rounded-sm p-0.5 opacity-70 hover:opacity-100"
                  aria-label={`Remove ${choice?.label ?? key}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        {choices.length > 6 && (
          <div className="flex items-center gap-2 border-b px-2.5 focus-within:bg-muted/40 focus-within:ring-2 focus-within:ring-ring/50 focus-within:ring-inset">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Find among ${choices.length} ${field}…`}
              aria-label={`Find ${field}`}
              className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
            />
            {text !== '' && (
              <button
                type="button"
                onClick={() => setText('')}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear the find text"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="max-h-64 overflow-y-auto py-1" role="group" aria-label={`Choose ${field}`}>
          {groups.map(([group, items]) => (
            <div key={group}>
              {group !== '' && (
                <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-card px-2.5 pt-1.5 pb-0.5 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                  <TypeDot typeKey={items[0].typeKey} className="size-1.5" />
                  {group}
                </div>
              )}
              {items.map((c) => (
                <label
                  key={c.key}
                  title={c.description ?? c.key}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 px-2.5 py-1 text-[12.5px] hover:bg-muted/60',
                    group !== '' && 'pl-5',
                  )}
                >
                  <Checkbox
                    checked={chosenSet.has(c.key)}
                    onCheckedChange={() => toggle(c.key)}
                    className="mt-0.5"
                  />
                  {group === '' && <TypeDot typeKey={c.typeKey} className="mt-1.5" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate">{c.label}</span>
                      {c.index !== undefined && <IndexTags index={c.index} semanticAvailable={semanticAvailable} />}
                    </span>
                    {c.index?.kind === 'custom' && c.description !== undefined && (
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">{c.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {shown.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Nothing matches “{text.trim()}”.</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t bg-muted/30 px-2.5 py-1 text-[11px]">
          <span className="min-w-0 flex-1 truncate font-medium">
            {scopeSummary(field, chosen.length, choices.length)}
          </span>
          {!allShownChosen && shown.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([...new Set([...chosen, ...shownKeys])])}
              className="text-muted-foreground hover:text-foreground"
            >
              {needle === '' ? 'Choose all' : 'Choose shown'}
            </button>
          )}
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {chosen.length === 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">{emptyScopeText(field, mode)}</p>
      )}
    </div>
  )
}
