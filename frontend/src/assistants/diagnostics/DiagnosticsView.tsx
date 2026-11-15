import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDuration, type Turn } from '../conversation/chatModel'
import { stepTotals, usageParts } from './diagnostics'
import {
  SEGMENT_MIN_PX, answerTime, barWidth, failedText, modelCallsText, stepRows, stripFacts, timeText, type Segment, type StepRow, type Tone,
} from './timeline'
import type { DiagnosticsMode } from './useDiagnostics'
import { useNow } from './useNow'

/**
 * What a kind gives the shell for its diagnostics: the shell draws the
 * switch, the strip under each answer and the drawer, the same for every
 * kind; the kind adds only its steps' readable names and how a plan reads.
 */
export interface DiagnosticsSlot<I> {
  mode: DiagnosticsMode
  /** A step's readable name (a tool's label, a pipeline step's); its name as sent when omitted. */
  nameOf?: (name: string, turn: Turn<I>) => string
  /** What a step's plan shows when the step is opened; null when it cannot be read. */
  plan?: (plan: Record<string, unknown>, turn: Turn<I>) => ReactNode
}

/** A bar's colour: model calls in the accent, other work grey, failed red; the running time pulses. */
function toneClass(tone: Tone, failed: boolean): string {
  if (failed) return 'bg-destructive'
  if (tone === 'running') return 'bg-primary/40 motion-safe:animate-pulse'
  return tone === 'model' ? 'bg-primary' : 'bg-muted-foreground/45'
}

/**
 * The strip's bar: the answer's steps end to end, each segment as wide as
 * its share. The bar gives way before the numbers beside it: where the
 * line is narrow it shrinks, and every segment narrows alike, so none is
 * cut off at the end.
 */
export function TimeBar({ items }: { items: readonly Segment[] }) {
  return (
    <span aria-hidden className="flex h-1.5 min-w-8 shrink-[100] items-stretch gap-px overflow-hidden rounded-full" style={{ width: barWidth(items.length) }}>
      {items.map((segment) => (
        <span key={segment.key} className={toneClass(segment.tone, segment.failed)} style={{ flex: `${segment.share} 1 ${SEGMENT_MIN_PX}px`, minWidth: 0 }} />
      ))}
    </span>
  )
}

/** A colour key for the bars. */
function Legend() {
  return (
    <span aria-hidden className="flex items-center gap-3 text-[11px] font-normal text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-3 rounded-full', toneClass('model', false))} /> Model call</span>
      <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-3 rounded-full', toneClass('work', false))} /> Other work</span>
    </span>
  )
}

/** One step: its number, name, bar at its real place and time; a model step's tokens and finish reason under it; a plan to open. */
function StepItem({ row, plan }: { row: StepRow; plan: ReactNode }) {
  const [open, setOpen] = useState(false)
  const running = row.tone === 'running'
  const head = (
    <>
      <span className="w-6 shrink-0 text-right text-muted-foreground tabular-nums">{row.index ?? ''}</span>
      <span className={cn('flex min-w-0 items-center gap-1', row.failed && 'text-destructive', running && 'text-muted-foreground')}>
        <span className="truncate" title={row.label}>{row.label}</span>
        {plan !== null && <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />}
      </span>
      <span className="relative h-2 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('absolute inset-y-0 rounded-full', toneClass(row.tone, row.failed))}
          style={{ left: `min(${row.left}%, calc(100% - ${SEGMENT_MIN_PX}px))`, width: `max(${SEGMENT_MIN_PX}px, ${row.width}%)` }}
        />
      </span>
      <span className={cn('text-right tabular-nums', running && 'text-muted-foreground')}>
        {formatDuration(row.durationMs)}{running && '…'}
      </span>
    </>
  )
  const grid = 'grid w-full grid-cols-[1.5rem_minmax(0,10rem)_minmax(3rem,1fr)_4.5rem] items-center gap-x-3 text-left'
  return (
    <li className="space-y-1 text-xs" data-testid="diagnostics-step">
      {plan === null ? (
        <div className={grid}>{head}</div>
      ) : (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(grid, '-mx-1 rounded px-1 py-0.5 hover:bg-muted/50')}>
          {head}
        </button>
      )}
      {(row.failed || row.facts.length > 0) && (
        <p className="pl-9 text-[11px] text-muted-foreground tabular-nums">
          {row.failed && <span className="font-medium text-destructive">Failed{row.facts.length > 0 && ' · '}</span>}
          {row.facts.join(' · ')}
        </p>
      )}
      {open && plan !== null && <div className="ml-9 rounded border p-3">{plan}</div>}
    </li>
  )
}

/**
 * One answer's diagnostics, the same for every kind: summary chips (time,
 * model calls, failed steps, tokens as reported), then one list of its
 * steps in order. It grows with each finished step while the answer runs.
 */
export function DiagnosticsView<I>({ turn, slot }: { turn: Turn<I>; slot: DiagnosticsSlot<I> }) {
  const running = turn.status === 'pending'
  const now = useNow(running)
  const steps = turn.diagnostics?.steps ?? []
  const timeMs = answerTime(turn, now)
  const facts = stripFacts(turn.diagnostics ?? {}, timeMs, running)
  const failed = failedText(facts)
  const nameOf = slot.nameOf && ((name: string) => slot.nameOf!(name, turn))
  const rows = stepRows(steps, timeMs, nameOf, running ? timeMs : undefined)
  const chip = 'font-normal tabular-nums'
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5" data-testid="diagnostics-summary">
        <Badge variant="outline" className={chip}>{timeText(facts)}</Badge>
        <Badge variant="outline" className={chip}>{modelCallsText(facts.modelCalls)}</Badge>
        {failed !== null && <Badge variant="destructive" className={chip}>{failed}</Badge>}
        {usageParts(stepTotals(steps).usage).map((part) => <Badge key={part} variant="outline" className={chip}>{part}</Badge>)}
      </div>

      <section className="space-y-3">
        <h3 className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium">Steps<Legend /></h3>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No steps reported for this answer.</p>
        ) : (
          <ol className="space-y-1.5" data-testid="diagnostics-steps">
            {rows.map((row) => (
              <StepItem key={row.key} row={row} plan={row.plan !== undefined && slot.plan !== undefined ? slot.plan(row.plan, turn) ?? null : null} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
