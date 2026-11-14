import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatDuration, type Turn } from '../conversation/chatModel'
import { modelCallTotals, usageParts, type ModelCall } from './diagnostics'
import { ModelCallList } from './ModelCallList'
import {
  SEGMENT_MIN_PX, answerSummary, barWidth, failedText, isTimed, type AnswerTime, type PartKind, type PartState, type Segment, type TimePart,
} from './timeline'
import type { DiagnosticsMode } from './useDiagnostics'
import { useNow } from './useNow'

/**
 * What a kind gives the shell for its diagnostics: the shell draws the
 * switch, the strip under each answer and the drawer, in the same order
 * for every kind; the kind adds only what it has.
 */
export interface DiagnosticsSlot<I> {
  mode: DiagnosticsMode
  /** Where the answer's time went, at `now` (which matters only while it runs). */
  time: (turn: Turn<I>, now: number) => AnswerTime
  /** One short line under the time bars. */
  timeNote?: string
  /** Folded detail under the time bars (the retriever's detailed timings). */
  timeDetail?: (turn: Turn<I>) => ReactNode
  /** The kind's counts among the summary chips (`3 search calls`). */
  facts?: (turn: Turn<I>) => string[]
  /** The Model calls tab: an intro, a call's shown name, what shows under a call. */
  calls?: {
    intro?: string
    nameOf?: (name: string, turn: Turn<I>) => string
    detail?: (call: ModelCall, turn: Turn<I>) => ReactNode
  }
  /** The kind's own tabs after Model calls. */
  tabs?: (turn: Turn<I>) => { value: string; label: string; content: ReactNode }[]
}

/** A part's colour: model calls in the accent, other work grey; failed red; a running part pulses. */
function partTone(kind: PartKind, state: PartState): string {
  if (state === 'failed') return 'bg-destructive'
  const tone = kind === 'model' ? 'bg-primary' : 'bg-muted-foreground/45'
  return state === 'running' ? cn(tone, 'motion-safe:animate-pulse') : tone
}

/**
 * The strip's bar: the answer's timed parts end to end, each as wide as its
 * share. The bar keeps its width beside the text, which gives way first;
 * where even the whole line is narrower than the bar, every segment narrows
 * alike, so none is cut off at the end.
 */
export function TimeBar({ items }: { items: readonly Segment[] }) {
  return (
    <span aria-hidden className="flex h-1.5 max-w-full shrink-0 items-stretch gap-px overflow-hidden rounded-full" style={{ width: barWidth(items.length) }}>
      {items.map((segment) => (
        <span key={segment.key} className={partTone(segment.kind, segment.state)} style={{ flex: `${segment.share} 1 ${SEGMENT_MIN_PX}px`, minWidth: 0 }} />
      ))}
    </span>
  )
}

/** A colour key for the bars. */
function Legend() {
  return (
    <span aria-hidden className="flex items-center gap-3 text-[11px] font-normal text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-3 rounded-full', partTone('model', 'done'))} /> Model call</span>
      <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-3 rounded-full', partTone('work', 'done'))} /> Other work</span>
    </span>
  )
}

const UNTIMED: Partial<Record<PartState, string>> = { skipped: 'Skipped', stopped: 'Stopped', 'not-run': 'Not run', waiting: '…' }

/** One row per part, each bar starting where the one before ended. */
function TimeRows({ parts, totalMs }: { parts: readonly TimePart[]; totalMs: number }) {
  if (parts.length === 0) return <p className="text-xs text-muted-foreground">No times reported for this answer.</p>
  return (
    <ol className="space-y-1.5" data-testid="diagnostics-time">
      {parts.map((part) => {
        const timed = isTimed(part)
        const left = totalMs > 0 ? (part.offsetMs / totalMs) * 100 : 0
        const width = totalMs > 0 ? (part.durationMs / totalMs) * 100 : 100
        return (
          <li key={part.key} className="grid grid-cols-[minmax(0,10rem)_minmax(3rem,1fr)_4.5rem] items-center gap-3 text-xs">
            <span className={cn('min-w-0', !timed && 'text-muted-foreground', part.state === 'failed' && 'text-destructive')}>
              <span className="block truncate" title={part.label}>{part.label}</span>
              {part.detail !== undefined && <span className="block truncate text-[11px] text-muted-foreground" title={part.detail}>{part.detail}</span>}
            </span>
            <span className="relative h-2 overflow-hidden rounded-full bg-muted">
              {timed && (
                <span
                  className={cn('absolute inset-y-0 rounded-full', partTone(part.kind, part.state))}
                  style={{ left: `${left}%`, width: `max(${SEGMENT_MIN_PX}px, ${width}%)` }}
                />
              )}
            </span>
            <span className={cn('text-right tabular-nums', !timed && 'text-muted-foreground')}>
              {timed ? `${formatDuration(part.durationMs)}${part.state === 'running' ? '…' : ''}` : UNTIMED[part.state]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium">{title}{aside}</h3>
      {children}
    </section>
  )
}

/**
 * One answer's diagnostics, the same order for every kind: summary chips
 * and limitations, where the time went, then the Model calls tab and the
 * kind's own tabs. It fills while the answer runs.
 */
export function DiagnosticsView<I>({ turn, slot }: { turn: Turn<I>; slot: DiagnosticsSlot<I> }) {
  const now = useNow(turn.status === 'pending')
  const { time, facts } = answerSummary(turn, slot.time(turn, now), now)
  const diagnostics = turn.diagnostics ?? {}
  const calls = diagnostics.modelCalls ?? []
  const failed = failedText(facts)
  const tabs = [
    {
      value: 'calls',
      label: 'Model calls',
      content: (
        <div className="space-y-3 text-xs">
          {slot.calls?.intro !== undefined && <p className="text-muted-foreground">{slot.calls.intro}</p>}
          <ModelCallList
            calls={diagnostics.modelCalls}
            status={turn.status}
            nameOf={slot.calls?.nameOf && ((name) => slot.calls!.nameOf!(name, turn))}
            detail={slot.calls?.detail && ((call) => slot.calls!.detail!(call, turn))}
          />
        </div>
      ),
    },
    ...(slot.tabs?.(turn) ?? []),
  ]
  const [tab, setTab] = useState('calls')
  const shownTab = tabs.some((t) => t.value === tab) ? tab : 'calls'
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" data-testid="diagnostics-summary">
          <Badge variant="outline" className="font-normal tabular-nums">
            {formatDuration(facts.timeMs)}{facts.running && ' so far'}
          </Badge>
          <Badge variant="outline" className="font-normal tabular-nums">
            {facts.calls} {facts.calls === 1 ? 'model call' : 'model calls'}
          </Badge>
          {failed !== null && <Badge variant="destructive" className="font-normal tabular-nums">{failed}</Badge>}
          {usageParts(modelCallTotals(calls).usage).map((part) => (
            <Badge key={part} variant="outline" className="font-normal tabular-nums">{part}</Badge>
          ))}
          {slot.facts?.(turn).map((fact) => (
            <Badge key={fact} variant="outline" className="font-normal tabular-nums">{fact}</Badge>
          ))}
        </div>
        {diagnostics.limitations?.map((text, i) => (
          <p key={i} className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{text}</p>
        ))}
      </div>

      <Section title="Where the time went" aside={<Legend />}>
        <TimeRows parts={time.parts} totalMs={time.totalMs} />
        {slot.timeNote !== undefined && <p className="text-[11px] text-muted-foreground">{slot.timeNote}</p>}
        {slot.timeDetail?.(turn)}
      </Section>

      <Tabs value={shownTab} onValueChange={setTab} className="gap-0">
        <TabsList variant="line" className="h-8 w-full justify-start border-b">
          {tabs.map((t) => <TabsTrigger key={t.value} value={t.value} className="flex-none px-2 text-xs">{t.label}</TabsTrigger>)}
        </TabsList>
        {tabs.map((t) => <TabsContent key={t.value} value={t.value} className="pt-4">{t.content}</TabsContent>)}
      </Tabs>
    </div>
  )
}
