import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { valueChange, type DiffFold, type DiffItem, type DiffPart, type DiffValue } from '@/lib/valueDiff'

const REMOVED_BG = 'bg-[color-mix(in_oklab,var(--tc-rose)_18%,transparent)]'
const ADDED_BG = 'bg-[color-mix(in_oklab,var(--tc-emerald)_22%,transparent)]'
const STRUCK = 'line-through decoration-(--tc-rose)'
const REMOVED = cn('rounded-[3px]', REMOVED_BG, STRUCK)
const ADDED = cn('rounded-[3px] no-underline', ADDED_BG)

/**
 * One value's change from `before` to `after`: a long or multi-line text as
 * a word diff (removed struck through, added highlighted) with long
 * unchanged stretches folded to a line count, a list as its
 * items kept, removed and added, a short text as before → after, none as
 * empty. Only inline elements, so it fits inside a button or a paragraph;
 * screen readers hear where each change starts and ends.
 */
export function ValueDiff({ before, after, className }: { before: DiffValue; after: DiffValue; className?: string }) {
  const change = valueChange(before, after)
  return (
    <span data-slot="value-diff" data-kind={change.kind} className={cn('block text-xs leading-relaxed', className)}>
      {change.kind === 'text' && <TextDiff parts={change.parts} />}
      {change.kind === 'short' && (
        <span className="flex flex-wrap items-baseline gap-1.5">
          {change.before === '' ? <Empty /> : <del className={cn(REMOVED, 'whitespace-pre-wrap break-words px-0.5')}><Said what="removed">{change.before}</Said></del>}
          <ArrowRight aria-hidden className="size-3 shrink-0 self-center text-muted-foreground" />
          <span className="sr-only">changed to</span>
          {change.after === '' ? <Empty /> : <ins className={cn(ADDED, 'whitespace-pre-wrap break-words px-0.5')}><Said what="added">{change.after}</Said></ins>}
        </span>
      )}
      {change.kind === 'list' && <Items items={change.items} />}
      {change.kind === 'mixed' && (
        <span className="grid gap-1.5">
          <Side label="Before" value={change.before} kind="removed" />
          <Side label="After" value={change.after} kind="added" />
        </span>
      )}
    </span>
  )
}

function TextDiff({ parts }: { parts: Array<DiffPart | DiffFold> }) {
  if (parts.length === 0) return <Empty />
  return (
    <span className="block whitespace-pre-wrap break-words">
      {parts.map((part, i) => (
        part.kind === 'fold' ? (
          <span key={i} className="my-1 block rounded-sm bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            <span aria-hidden>⋯ </span>{part.lines} unchanged {part.lines === 1 ? 'line' : 'lines'}
          </span>
        )
          : part.kind === 'same' ? <span key={i}>{part.text}</span>
          : part.kind === 'removed' ? <del key={i} className={REMOVED}><Said what="removed">{part.text}</Said></del>
            : <ins key={i} className={ADDED}><Said what="added">{part.text}</Said></ins>
      ))}
    </span>
  )
}

function Items({ items }: { items: readonly DiffItem[] }) {
  if (items.length === 0) return <Empty />
  return (
    <span role="list" className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.value}
          role="listitem"
          data-change={item.kind}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
            item.kind === 'removed' && cn(REMOVED_BG, 'border-(--tc-rose-border)'),
            item.kind === 'added' && cn(ADDED_BG, 'border-(--tc-emerald-border)'),
            item.kind === 'same' && 'text-muted-foreground',
          )}
        >
          {item.kind !== 'same' && <span aria-hidden className="font-sans">{item.kind === 'added' ? '+' : '−'}</span>}
          <span className="sr-only">{item.kind === 'same' ? 'kept' : item.kind}: </span>
          <span className={cn(item.kind === 'removed' && STRUCK)}>{item.value}</span>
        </span>
      ))}
    </span>
  )
}

/** One side of a change between a text and a list. */
function Side({ label, value, kind }: { label: string; value: DiffValue; kind: 'removed' | 'added' }) {
  const shown = Array.isArray(value)
    ? <Items items={value.map((v) => ({ kind, value: v }))} />
    : value === null || value === undefined || value === ''
      ? <Empty />
      : <span className={cn('whitespace-pre-wrap break-words px-0.5', kind === 'removed' ? REMOVED : ADDED)}>{value}</span>
  return (
    <span className="grid gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span>{shown}</span>
    </span>
  )
}

/** A change's text, with where it starts and ends said to screen readers. */
function Said({ what, children }: { what: 'removed' | 'added'; children: string }) {
  return <><span className="sr-only">[{what}: </span>{children}<span className="sr-only">]</span></>
}

function Empty() {
  return <span className="text-muted-foreground italic">empty</span>
}
