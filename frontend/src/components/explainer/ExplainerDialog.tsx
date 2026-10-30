import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FIRST_STEP, advance, goTo, isRunning, togglePlay } from './explainerSteps'

/** One step of an explainer's story: its title and what it says. A story adds what its diagram and example show. */
export interface ExplainerStep {
  title: string
  body: string
}

/** What an explainer tells: its title and icon, the summary and facts under the title, and the steps. */
export interface ExplainerStory<Step extends ExplainerStep> {
  title: string
  icon: LucideIcon
  summary: ReactNode
  facts: { label: string; value: string }[]
  steps: readonly Step[]
}

/** The story at its current step, for the diagram and the example: `go` moves to another step and stops auto-play. */
export interface ExplainerAt<Step extends ExplainerStep> {
  step: Step
  index: number
  go: (index: number) => void
}

interface ExplainerDialogProps<Step extends ExplainerStep> {
  story: ExplainerStory<Step>
  /** Names the step bar and its diagram for assistive technology, such as "The step and the workflow". */
  label: string
  /** The diagram under the step, with its heading. */
  diagram: (at: ExplainerAt<Step>) => ReactNode
  /** The example under the step bar. */
  children: (at: ExplainerAt<Step>) => ReactNode
  /** Beside the step's title, such as who takes the step. */
  tag?: (step: Step) => ReactNode
  /** Beside the title and summary, such as a link to another explainer. */
  aside?: ReactNode
  /** How long auto-play shows a step. */
  playMs?: number
  /** The step's body is this many lines high beside the controls, so the step bar keeps one height; a longer body scrolls. */
  bodyLines?: number
}

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/**
 * An explainer's dialog: the title, summary and facts, then the step bar — the step, the
 * controls and the diagram — over the example. Auto-play, the step dots and the arrow keys
 * move through the story. On a narrow screen the controls go under the step and its body
 * grows instead of scrolling.
 */
export function ExplainerDialog<Step extends ExplainerStep>(props: ExplainerDialogProps<Step>) {
  return <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(78rem,calc(100%-2rem))]">
    <ExplainerPanel {...props} />
  </DialogContent>
}

function ExplainerPanel<Step extends ExplainerStep>({
  story, label, diagram, children, tag, aside, playMs = 5000, bodyLines = 3,
}: ExplainerDialogProps<Step>) {
  const { title, icon: Icon, summary, facts, steps } = story
  const [state, setState] = useState(FIRST_STEP)
  const { index } = state
  const last = steps.length - 1
  const step = steps[index]

  const running = isRunning(state, last)
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setState((s) => advance(s, last)), playMs)
    return () => window.clearTimeout(timer)
  }, [running, index, last, playMs])

  const go = (next: number) => setState(goTo(next, last))
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
  }
  const at: ExplainerAt<Step> = { step, index, go }

  return <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
    <header className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b px-5 pt-4 pb-3 pr-14">
      <div className="flex min-w-0 flex-1 basis-[28rem] items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
        <div className="grid min-w-0 gap-1">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{summary}</DialogDescription>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {facts.map((fact) => <div key={fact.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{fact.label}</dt><dd className="font-medium">{fact.value}</dd>
            </div>)}
          </dl>
        </div>
      </div>
      {aside}
    </header>

    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">
      <section className="shrink-0 rounded-xl border bg-card px-3 pt-2.5 pb-2" aria-label={label}>
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-6" aria-live="polite">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={microLabel}>Step {index + 1} of {steps.length}</span>
              {tag?.(step)}
              <h4 className="text-base font-semibold">{step.title}</h4>
            </div>
            {/* Fixed beside the controls; on a narrow screen it grows instead. */}
            <p className="text-[13px] leading-relaxed text-muted-foreground md:h-[var(--step-body)] md:overflow-y-auto" style={{ '--step-body': `${bodyLines}lh` } as CSSProperties}>{step.body}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5 md:w-[22rem]">
            <Button type="button" variant="outline" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronLeft /> Back
            </Button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5">
              {steps.map((s, i) => <button key={i} type="button" aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === index ? 'step' : undefined}
                onClick={() => go(i)} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-primary' : i < index ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/30')} />)}
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={running ? 'Pause' : 'Play the example'} onClick={() => setState((s) => togglePlay(s, last))}>
              {running ? <Pause /> : <Play />}
            </Button>
            <Button type="button" size="sm" onClick={() => go(index + 1)} disabled={index === last}>
              Next <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="mt-1.5 border-t pt-1.5">{diagram(at)}</div>
      </section>

      {children(at)}
    </div>
  </div>
}
