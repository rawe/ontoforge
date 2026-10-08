import type { ReactNode } from 'react'
import { AlertTriangle, FileText, Info, Plus } from 'lucide-react'
import type { OutlinePart } from '@/api/types'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import {
  fieldNames,
  outlineLines,
  type FieldOwner,
  type OutlineSegment,
  type PartTypes,
} from './entryOutline'

/** A property left out of the entry, with the edit that adds it. */
export interface LeftOut {
  key: string
  label: string
  /** Why it cannot be added now, or undefined when it can. */
  disabledReason?: string
  onAdd: () => void
}

interface EntryPreviewProps {
  /** The composed part; undefined while it is being composed or when it composes nothing. */
  part: OutlinePart | undefined
  types: PartTypes | undefined
  /** How many such entries an entity has, in words. */
  caption: ReactNode
  semantic: boolean
  keyword: boolean
  /** The outline answers an older draft. */
  stale: boolean
  /** Shown instead of the texts when there is no part. */
  emptyText?: ReactNode
  /** Warnings about what the entry misses. */
  warnings?: ReactNode[]
  leftOut?: { title: string; fields: LeftOut[] }[]
  /** The leading lines that are the owner line (header), marked; a template's text has none. */
  ownerLines?: { semantic: number; keyword: number }
}

/**
 * What one kind of entry holds, composed by the server from the schema:
 * the semantic text that is embedded beside the keyword text that is
 * matched by words — fields as chips coloured by the type that owns them.
 */
export function EntryPreview({
  part,
  types,
  caption,
  semantic,
  keyword,
  stale,
  emptyText,
  warnings = [],
  leftOut = [],
  ownerLines,
}: EntryPreviewProps) {
  const templateNotes: ReactNode[] = []
  if (part !== undefined && semantic) {
    if (part.template === 'fallback') {
      templateNotes.push(
        'The template renders nothing — every clause holds a placeholder without a value — so the labelled lines shown are embedded instead.',
      )
    }
    for (const placeholder of part.unresolved) {
      templateNotes.push(
        <>
          <code className="font-mono">{`{${placeholder}}`}</code> names no field this entry reads — its
          clause is always dropped.
        </>,
      )
    }
  }
  const notes = [...warnings, ...templateNotes]
  // Fields a rendered template leaves out are still in the keyword text.
  const infos: ReactNode[] = []
  if (part !== undefined && types !== undefined && semantic && part.template === 'rendered') {
    const named = new Set(fieldTokens(part.semanticText))
    const skipped = fieldTokens(part.keywordText).filter((t) => !named.has(t))
    if (skipped.length > 0) {
      const list = skipped
        .map((t) => {
          const [owner, key] = t.split('.') as [FieldOwner, string]
          const n = fieldNames(types, owner, key)
          return `${n.owner} · ${n.field}`
        })
        .join(', ')
      infos.push(
        keyword
          ? `${list}: not in the template, so matched by keyword only — never by meaning.`
          : `${list}: read, but neither in the template nor in a keyword text — no search matches on it.`,
      )
    }
  }
  const shownLeftOut = leftOut.filter((g) => g.fields.length > 0)

  return (
    <div
      className={cn(
        '@container grid gap-2.5 rounded-lg border border-dashed bg-background/60 p-3 transition-opacity',
        stale && 'opacity-60',
      )}
      aria-busy={stale}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Entry preview
        </span>
        <span className="text-[12px] text-muted-foreground">{caption}</span>
        {part !== undefined && semantic && part.template === 'rendered' && (
          <span className="ml-auto rounded border px-1.5 py-px text-[10px] text-muted-foreground">
            semantic text from template
          </span>
        )}
      </div>

      {part === undefined ? (
        <p className="text-[12px] text-muted-foreground">{emptyText ?? 'Composing…'}</p>
      ) : (
        <div className={cn('grid gap-2', semantic && keyword && '@lg:grid-cols-[3fr_2fr]')}>
          {semantic && (
            <TextColumn
              title="Semantic"
              hint="embedded as one vector — found by meaning"
              text={part.semanticText}
              types={types}
              qualified={part.template === 'rendered'}
              ownerLines={part.template === 'rendered' ? 0 : (ownerLines?.semantic ?? 0)}
            />
          )}
          {keyword && (
            <TextColumn
              title="Keyword"
              hint="values only, no labels — found by words"
              text={part.keywordText}
              types={types}
              qualified
              ownerLines={ownerLines?.keyword ?? 0}
            />
          )}
        </div>
      )}

      {notes.length > 0 && (
        <ul className="grid gap-1">
          {notes.map((note, i) => (
            <li
              key={i}
              className="flex gap-1.5 rounded-md border border-(--tc-amber-border) bg-(--tc-amber-bg) px-2 py-1 text-[12px]"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--tc-amber)" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {infos.map((info, i) => (
        <p key={i} className="flex gap-1.5 text-[12px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{info}</span>
        </p>
      ))}

      {shownLeftOut.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-muted-foreground">Not in this entry:</span>
          {shownLeftOut.map((group) => (
            <span key={group.title} className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-muted-foreground">{group.title}</span>
              {group.fields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  disabled={f.disabledReason !== undefined}
                  title={f.disabledReason ?? `Add ${f.label} to this entry`}
                  onClick={f.onAdd}
                  className="inline-flex items-center gap-0.5 rounded border border-dashed px-1.5 py-px text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Plus className="size-3" />
                  {f.label}
                </button>
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function TextColumn({
  title,
  hint,
  text,
  types,
  qualified = false,
  ownerLines = 0,
}: {
  title: string
  hint: string
  text: string
  types: PartTypes | undefined
  /** Name the owning type on each field — keyword and template text have no labels to tell. */
  qualified?: boolean
  /** How many leading lines are the owner line (header). */
  ownerLines?: number
}) {
  const lines = outlineLines(text)
  const renderLine = (line: OutlineSegment[], i: number, tagged = false) => (
    <div key={i} className="flex min-h-5 flex-wrap items-center gap-y-0.5">
      {line.map((segment, j) => (
        <Segment key={j} segment={segment} types={types} qualified={qualified} />
      ))}
      {tagged && (
        <span className="ml-auto pl-2 font-sans text-[10px] text-muted-foreground" title="Set under “Owner line (header)”">
          owner line
        </span>
      )}
    </div>
  )
  return (
    <div className="min-w-0 rounded-md border bg-card">
      <div className="flex items-baseline gap-1.5 border-b px-2.5 py-1">
        <span className="text-[11px] font-medium">{title}</span>
        <span className="truncate text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="grid gap-1 px-2.5 py-2 font-mono text-[12px] leading-5">
        {ownerLines > 0 && (
          <div className="-ml-2.5 grid gap-1 border-l-2 border-primary/35 pl-2">
            {lines.slice(0, ownerLines).map((line, i) => renderLine(line, i, i === 0))}
          </div>
        )}
        {lines.slice(ownerLines).map((line, i) => renderLine(line, i + ownerLines))}
      </div>
    </div>
  )
}

function Segment({
  segment,
  types,
  qualified,
}: {
  segment: OutlineSegment
  types: PartTypes | undefined
  qualified: boolean
}) {
  if (segment.kind === 'text') return <span className="whitespace-pre-wrap">{segment.text}</span>
  if (segment.kind === 'passage') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-dashed px-1.5 font-sans text-[11px] text-muted-foreground">
        <FileText className="size-3" /> one chunk of the document
      </span>
    )
  }
  const names = types === undefined ? { field: segment.key, owner: segment.owner } : fieldNames(types, segment.owner, segment.key)
  return (
    <span
      className={cn('mx-px inline-flex items-center gap-1 rounded border px-1.5 font-sans text-[11px]', chipClass(segment.owner, types))}
      title={`${names.owner} · ${names.field} (${segment.key}) — its value goes here`}
    >
      {qualified && <span className="opacity-70">{names.owner} ·</span>}
      {names.field}
    </span>
  )
}

/** Root and target fields take their type's colour; relation fields the primary tint. */
function chipClass(owner: FieldOwner, types: PartTypes | undefined): string {
  if (owner === 'relation') return 'border-primary/30 bg-primary/10 text-primary'
  const key = owner === 'root' ? types?.root?.key : types?.target?.key
  return key === undefined ? 'bg-muted' : getTypeColor(key).chip
}

/** The `owner.key` of every field token in an outline text. */
function fieldTokens(text: string): string[] {
  return outlineLines(text)
    .flat()
    .flatMap((s) => (s.kind === 'field' ? [`${s.owner}.${s.key}`] : []))
}
