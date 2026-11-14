import { AlertCircle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Turn } from '../conversation/chatModel'
import { TimeBar, type DiagnosticsSlot } from './DiagnosticsView'
import { answerSummary, failedText, segments, stripLabel, stripText } from './timeline'
import { useNow } from './useNow'

/**
 * One line under an answer with diagnostics: a small bar of where its time
 * went, its time, model calls and tokens, and a mark when a call failed.
 * It grows while the answer runs; a click opens the drawer on it.
 */
export function DiagnosticsStrip<I>({ turn, slot, open, onOpen }: {
  turn: Turn<I>
  slot: DiagnosticsSlot<I>
  /** The drawer shows this answer. */
  open: boolean
  onOpen: () => void
}) {
  const now = useNow(turn.status === 'pending')
  const { time, facts } = answerSummary(turn, slot.time(turn, now), now)
  const failed = failedText(facts)
  return (
    <button
      type="button"
      data-testid="diagnostics-strip"
      data-diagnostics-strip={turn.id}
      aria-label={stripLabel(facts)}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className={cn(
        '-ml-2 flex h-6 w-fit max-w-full min-w-0 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        open && 'bg-secondary text-foreground',
      )}
    >
      <TimeBar items={segments(time)} />
      <span className="min-w-0 truncate tabular-nums">{stripText(facts)}</span>
      {failed !== null && (
        <span className="flex shrink-0 items-center gap-1 text-destructive">
          <AlertCircle className="size-3" /> {failed}
        </span>
      )}
      <ChevronRight className="size-3 shrink-0 opacity-60" />
    </button>
  )
}
