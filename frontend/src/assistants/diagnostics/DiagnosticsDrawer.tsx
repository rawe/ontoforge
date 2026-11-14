import { ChevronLeft, ChevronRight, Gauge, LoaderCircle, XIcon } from 'lucide-react'
import { useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { Turn } from '../conversation/chatModel'
import { DiagnosticsView, type DiagnosticsSlot } from './DiagnosticsView'
import { stepping } from './timeline'

/** The answer's state beside the title, when it is not simply complete. */
function StateMark({ turn }: { turn: Turn<unknown> }) {
  if (turn.status === 'pending') {
    return <Badge variant="outline" className="font-normal"><LoaderCircle className="animate-spin" /> Running</Badge>
  }
  if (turn.status !== 'failed') return null
  return turn.stopped === true
    ? <Badge variant="secondary" className="font-normal">Stopped</Badge>
    : <Badge variant="destructive" className="font-normal">Failed</Badge>
}

/**
 * The diagnostics of one answer in a wide panel over the page's right
 * side. Non-modal: the chat stays usable and an answer keeps streaming
 * under it. ‹ › step between the conversation's answers that have
 * diagnostics; ✕ and Escape close it, and focus returns to the answer's
 * strip.
 */
export function DiagnosticsDrawer<I>({ open, turn, turns, slot, onShow, onClose }: {
  open: boolean
  turn: Turn<I>
  turns: readonly Turn<I>[]
  slot: DiagnosticsSlot<I>
  /** Show another answer. */
  onShow: (id: string) => void
  onClose: () => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const { position, count, previous, next } = stepping(turns, turn.id)
  return (
    <Sheet open={open} onOpenChange={(value) => { if (!value) onClose() }} modal={false}>
      <SheetContent
        ref={content}
        tabIndex={-1}
        data-testid="diagnostics-drawer"
        className="w-[min(880px,92vw)]"
        // The chat beside stays usable: clicking or typing there keeps the drawer open.
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          content.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          const strip = document.querySelector<HTMLElement>(`[data-diagnostics-strip="${CSS.escape(turn.id)}"]`)
          if (strip === null) return
          e.preventDefault()
          strip.focus()
        }}
      >
        <header className="flex items-start gap-3 border-b px-5 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <SheetTitle className="flex items-center gap-1.5">
                <Gauge className="size-3.5 text-muted-foreground" /> Diagnostics
              </SheetTitle>
              <StateMark turn={turn} />
            </div>
            <SheetDescription className="truncate" title={turn.question}>
              For: <span className="text-foreground">{turn.question}</span>
            </SheetDescription>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {count > 1 && (
              <>
                <span className="mr-1 text-xs text-muted-foreground tabular-nums" aria-live="polite"><span className="max-sm:hidden">Answer </span>{position} of {count}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Previous answer" disabled={previous === null} onClick={() => previous !== null && onShow(previous)}>
                  <ChevronLeft />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Next answer" disabled={next === null} onClick={() => next !== null && onShow(next)}>
                  <ChevronRight />
                </Button>
              </>
            )}
            <SheetClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close diagnostics">
                <XIcon />
              </Button>
            </SheetClose>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DiagnosticsView turn={turn} slot={slot} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
