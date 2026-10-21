import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ChevronLeft, ChevronRight, CircleQuestionMark, Funnel, Layers, ListOrdered, MessageCircleQuestionMark, MessageSquareText, Pause, Play, Search,
  Sparkles, Waypoints, Wrench, type LucideIcon,
} from 'lucide-react'
import type { AssistantKind } from '@/api/types'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AssistantExplainerFlow } from './AssistantExplainerFlow'
import { AssistantExplainerGraph } from './AssistantExplainerGraph'
import { EXAMPLE, EXPLAINERS, litEdges, logUpTo, passedNodes, type LogEntry } from './assistantExplainerStories'

const KINDS: AssistantKind[] = ['agents', 'retrievers', 'navigators']
const PLAY_MS = 5000

const LOG_ICONS: Record<LogEntry['tag'], LucideIcon> = {
  model: Sparkles, tool: Wrench, search: Search, filter: Funnel, walk: Waypoints, rank: ListOrdered, keep: Layers, answer: MessageSquareText,
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/**
 * Opens how an assistant kind works, told over one example run: a bare "?" beside an
 * assistant's name, or `labeled` — "? How retrievers work" — among a list's actions.
 */
export function AssistantExplainerButton({ kind, labeled = false, className }: { kind: AssistantKind; labeled?: boolean; className?: string }) {
  const { one, many } = ASSISTANT_KINDS[kind]
  const title = `How ${article(one)} ${one.toLowerCase()} works`
  if (labeled) return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="sm" className={className}><CircleQuestionMark className="size-3.5" /> How {many} work</Button>
    </DialogTrigger>
    <AssistantExplainerDialog kind={kind} />
  </Dialog>
  return <Dialog>
    <Tooltip>
      <TooltipTrigger asChild>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={title}
            className={cn('text-muted-foreground hover:text-foreground', className)}>
            <CircleQuestionMark />
          </Button>
        </DialogTrigger>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
    <AssistantExplainerDialog kind={kind} />
  </Dialog>
}

function AssistantExplainerDialog({ kind }: { kind: AssistantKind }) {
  return <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(78rem,calc(100%-2rem))]">
    <AssistantExplainerPanel initialKind={kind} />
  </DialogContent>
}


/** The explainer's content: the flow of one kind, an example run over it, step by step. */
function AssistantExplainerPanel({ initialKind }: { initialKind: AssistantKind }) {
  const [kind, setKind] = useState(initialKind)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const explainer = EXPLAINERS[kind]
  const story = explainer.story
  const step = story[index]
  const last = story.length - 1
  const Icon = ASSISTANT_KINDS[kind].icon
  const flowNode = explainer.flow.nodes.find((node) => node.id === step.node)!

  const running = playing && index < last
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setIndex((i) => Math.min(i + 1, last)), PLAY_MS)
    return () => window.clearTimeout(timer)
  }, [running, index, last])

  const go = (next: number) => { setIndex(Math.max(0, Math.min(last, next))); setPlaying(false) }
  const switchKind = (next: AssistantKind) => { setKind(next); setIndex(0); setPlaying(false) }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest('[role="tablist"]')) return
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
  }
  const log = logUpTo(explainer, index)
  const logRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = logRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [kind, index])

  return <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
    <header className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b px-6 pt-5 pb-4 pr-14">
      <div className="flex min-w-0 flex-1 basis-[28rem] items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
        <div className="grid min-w-0 gap-1.5">
          <DialogTitle className="text-lg font-semibold">{explainer.title}</DialogTitle>
          <DialogDescription className="max-w-3xl text-[13px] leading-relaxed">{explainer.summary}</DialogDescription>
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {explainer.facts.map((fact) => <div key={fact.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{fact.label}</dt><dd className="font-medium">{fact.value}</dd>
            </div>)}
          </dl>
        </div>
      </div>
      <div role="tablist" aria-label="Assistant kind" className="flex shrink-0 rounded-lg border bg-muted/50 p-0.5">
        {KINDS.map((option) => {
          const { one, icon: KindIcon } = ASSISTANT_KINDS[option]
          return <button key={option} type="button" role="tab" aria-selected={option === kind} onClick={() => switchKind(option)}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              option === kind ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <KindIcon className="size-3.5" />{one}
          </button>
        })}
      </div>
    </header>

    <div className="grid min-h-0 gap-4 overflow-y-auto px-6 py-5">
      <section className="rounded-xl border bg-card px-4 pt-3 pb-2" aria-label="The flow of a run">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={microLabel}>The flow of one run</h3>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-primary/45 bg-primary/10" />Calls the language model</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border bg-card" />Reads the lens, no model</li>
            <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-primary" />This step</li>
          </ul>
        </div>
        <AssistantExplainerFlow explainer={explainer} current={step.node} passed={passedNodes(explainer, index)} lit={litEdges(explainer, index)}
          onSelect={(node) => go(story.findIndex((s) => s.node === node))} />
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="The example graph">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={microLabel}>On an example graph</h3>
            <span className="text-[11px] text-muted-foreground">the same question for every kind</span>
          </div>
          <p className="flex items-center gap-2 self-start rounded-lg bg-muted px-3 py-2 text-[13px]">
            <MessageCircleQuestionMark className="size-4 shrink-0 text-muted-foreground" />{EXAMPLE.question}
          </p>
          <AssistantExplainerGraph step={step} />
          <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-primary" />Starting point</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-primary bg-primary/12" />Touched now</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-foreground/35 bg-card" />Touched before</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-primary bg-primary/25" />Found — the answer’s evidence</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-foreground/20 bg-card opacity-50" />Never touched</li>
          </ul>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="grid gap-3 rounded-xl border bg-card p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span className={microLabel}>Step {index + 1} of {story.length}</span>
              <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                flowNode.role === 'model' ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
                {flowNode.role === 'model' && <Sparkles className="size-3" />}{flowNode.label}
              </span>
            </div>
            <h4 className="text-base font-semibold">{step.title}</h4>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
            {step.settings.length > 0 && <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">Set by</span>
              {step.settings.map((label) => <span key={label} className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-primary">{label}</span>)}
            </div>}
            <div className="flex items-center gap-2 border-t pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
                <ChevronLeft /> Back
              </Button>
              <div className="flex flex-1 items-center justify-center gap-1.5">
                {story.map((s, i) => <button key={i} type="button" aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === index ? 'step' : undefined}
                  onClick={() => go(i)} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-primary' : i < index ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/30')} />)}
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={running ? 'Pause' : 'Play the run'}
                onClick={() => { if (running) { setPlaying(false); return } if (index === last) setIndex(0); setPlaying(true) }}>
                {running ? <Pause /> : <Play />}
              </Button>
              <Button type="button" size="sm" onClick={() => go(index + 1)} disabled={index === last}>
                Next <ChevronRight />
              </Button>
            </div>
          </section>

          <section className="flex min-h-48 flex-1 flex-col gap-2 rounded-xl border bg-card p-4 md:[contain:size]" aria-label="Run log">
            <h3 className={microLabel}>Run log</h3>
            <ol ref={logRef} className="-mx-1 grid min-h-0 content-start gap-1.5 overflow-y-auto px-1">
              {log.map((entry, i) => {
                const LogIcon = LOG_ICONS[entry.tag]
                const now = entry.step === index
                return <li key={i} className={cn('flex gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors',
                  now ? 'border-primary/30 bg-primary/5' : 'border-transparent')}>
                  <LogIcon className={cn('mt-0.5 size-3.5 shrink-0', entry.tag === 'model' || now ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="grid min-w-0 gap-0.5">
                    <span className={cn('text-xs font-medium break-words', entry.tag === 'tool' && 'font-mono text-[11.5px]', !now && 'text-muted-foreground')}>{entry.title}</span>
                    <span className="text-[11.5px] text-muted-foreground">{entry.detail}</span>
                  </div>
                </li>
              })}
            </ol>
          </section>
        </div>
      </div>

      <section className="grid gap-2" aria-label="What you set">
        <h3 className={microLabel}>What you set — and the step it steers</h3>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {explainer.settings.map((setting) => {
            const on = step.settings.includes(setting.label)
            const steers = explainer.flow.nodes.filter((node) => story.some((s) => s.node === node.id && s.settings.includes(setting.label))).map((node) => node.label)
            return <li key={setting.label} className={cn('grid content-start gap-1 rounded-lg border px-3 py-2 transition-colors',
              on ? 'border-primary/40 bg-primary/5' : 'bg-card')}>
              <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs font-medium">
                <span className={on ? 'text-primary' : undefined}>{setting.label}</span>
                <span className="text-[10.5px] font-normal text-muted-foreground">{steers.join(' · ')}</span>
              </span>
              <span className="text-[11.5px] leading-snug text-muted-foreground">{setting.hint}</span>
            </li>
          })}
        </ul>
      </section>
    </div>
  </div>
}
