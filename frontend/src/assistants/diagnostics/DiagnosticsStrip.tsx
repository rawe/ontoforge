import { AlertCircle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TimeBar } from './DiagnosticsView'
import { answerSummary, drawerAnswer, failedText, stripLabel, stripText, type Answer } from './timeline'
import type { DiagnosticsControl } from './useDiagnostics'
import { useNow } from './useNow'

/**
 * One line under an answer with diagnostics: a small bar of its steps, its
 * time, model calls and tokens, and a mark when a step failed. It grows
 * with each finished step while the answer runs; a click opens the drawer
 * on it, a second one closes it. Nothing while diagnostics are off or the
 * answer has none.
 */
export function DiagnosticsStrip({ diagnostics, answer, answers }: {
  diagnostics: DiagnosticsControl
  answer: Answer
  /** The conversation's answers: which of them the drawer shows. */
  answers: readonly Answer[]
}) {
  if (!diagnostics.on || answer.diagnostics === undefined) return null
  const { drawer, setDrawer } = diagnostics.view
  const open = drawer.open && drawerAnswer(answers, drawer.id)?.id === answer.id
  return <Strip answer={answer} open={open} onOpen={() => setDrawer(open ? { ...drawer, open: false } : { open: true, id: answer.id })} />
}

function Strip({ answer, open, onOpen }: {
  answer: Answer
  /** The drawer shows this answer. */
  open: boolean
  onOpen: () => void
}) {
  const now = useNow(answer.status === 'pending')
  const { facts, segments } = answerSummary(answer, now)
  const failed = failedText(facts)
  return (
    <button
      type="button"
      data-testid="diagnostics-strip"
      data-diagnostics-strip={answer.id}
      aria-label={stripLabel(facts)}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className={cn(
        '-ml-2 flex h-6 w-fit max-w-full min-w-0 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        open && 'bg-secondary text-foreground',
      )}
    >
      <TimeBar items={segments} />
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
