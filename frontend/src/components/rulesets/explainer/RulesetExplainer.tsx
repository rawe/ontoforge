import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Anchor, ChevronLeft, ChevronRight, CircleQuestionMark, Pause, Play, Plug, UserRound, type LucideIcon } from 'lucide-react'
import { ChangesetExplainerButton } from '@/components/changesets/explainer/ChangesetExplainer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { RulesetExplainerFlow } from './RulesetExplainerFlow'
import { RulesetExplainerTree } from './RulesetExplainerTree'
import { STORY, logUpTo, type Actor } from './rulesetExplainerStory'

const PLAY_MS = 5000
const TITLE = 'What an anchor does to a client'
const ACTOR_ICONS: Record<Actor, LucideIcon> = { client: Plug, person: UserRound }
const ACTORS: Record<Actor, string> = { client: 'Client', person: 'Person' }

const FACTS = [
  { label: 'Reads', value: 'not narrowed: the whole lens' },
  { label: 'Checked', value: 'on every call, against the anchor as it is then' },
  { label: 'Not authentication', value: 'it guards against mistakes' },
]

const RULES = [
  {
    title: 'The hold',
    text: 'Writes to the anchored entity’s hierarchy stay in its subtree: a create needs its parent relation to a parent inside it; an update, a delete or a relation may touch only covered entities and free types, those outside the hierarchy. Unanchored, an anchor holds nothing; dangling, its entity deleted, it refuses every write.',
  },
  {
    title: 'Staged-only',
    text: 'Every immediate write through the anchor’s URL is refused, and so is the commit, whatever the anchor’s state. Starting, staging, unstaging, submitting, unsubmitting and discarding a draft still work: the client proposes, a person commits.',
  },
  {
    title: 'Two escapes',
    text: 'Neither is a lock. 1. The plain lens URL, the anchored URL without its anchor, writes immediately and commits. 2. The anchor’s maintenance, open to any REST client, turns the flag off or re-points the anchor.',
  },
]

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/** Opens what an anchor does to a client — the hold and staged-only — told over one example: a "?" beside a page title. */
export function RulesetExplainerButton({ className }: { className?: string }) {
  return <Dialog>
    <Tooltip>
      <TooltipTrigger asChild>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={TITLE}
            className={cn('text-muted-foreground hover:text-foreground', className)}>
            <CircleQuestionMark />
          </Button>
        </DialogTrigger>
      </TooltipTrigger>
      <TooltipContent side="top">{TITLE}</TooltipContent>
    </Tooltip>
    <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(78rem,calc(100%-2rem))]">
      <RulesetExplainerPanel />
    </DialogContent>
  </Dialog>
}

/** The explainer's content: a write's way, an example hierarchy, step by step, and the rules. */
function RulesetExplainerPanel() {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const step = STORY[index]
  const last = STORY.length - 1
  const ActorIcon = ACTOR_ICONS[step.actor]

  const running = playing && index < last
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setIndex((i) => Math.min(i + 1, last)), PLAY_MS)
    return () => window.clearTimeout(timer)
  }, [running, index, last])

  const go = (next: number) => { setIndex(Math.max(0, Math.min(last, next))); setPlaying(false) }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
  }
  const log = logUpTo(index)
  const logRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = logRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [index])

  return <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
    <header className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b px-6 pt-5 pb-4 pr-14">
      <div className="flex min-w-0 flex-1 basis-[28rem] items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Anchor className="size-5" /></span>
        <div className="grid min-w-0 gap-1.5">
          <DialogTitle className="text-lg font-semibold">{TITLE}</DialogTitle>
          <DialogDescription className="max-w-3xl text-[13px] leading-relaxed">
            An anchor points at one entity. A client on the anchor’s URL has its writes to that entity’s hierarchy held to the
            entity and its descendants. With staged-only on, it writes nothing at once: it stages writes into a changeset and
            submits them, and a person commits.
          </DialogDescription>
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {FACTS.map((fact) => <div key={fact.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{fact.label}</dt><dd className="font-medium">{fact.value}</dd>
            </div>)}
          </dl>
        </div>
      </div>
      <ChangesetExplainerButton labeled className="shrink-0" />
    </header>

    <div className="grid min-h-0 gap-4 overflow-y-auto px-6 py-5">
      <section className="rounded-xl border bg-card px-4 pt-3 pb-3" aria-label="The way of a write">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className={microLabel}>The way of a write — {step.stagedOnly ? 'staged-only on' : 'staged-only off'}</h3>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-primary" />This step</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-destructive bg-destructive/10" />Refused here</li>
          </ul>
        </div>
        <RulesetExplainerFlow step={step} />
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="The example hierarchy">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={microLabel}>On an example hierarchy</h3>
            <span className="text-[11px] text-muted-foreground">the anchor apollo at the project Apollo</span>
          </div>
          <RulesetExplainerTree step={step} />
          <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-primary" />Anchored</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-primary/45 bg-primary/6" />Covered</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-border bg-card" />Outside the subtree</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-dashed border-foreground/40 bg-card" />Free type</li>
          </ul>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="grid gap-3 rounded-xl border bg-card p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span className={microLabel}>Step {index + 1} of {STORY.length}</span>
              <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                step.actor === 'person' ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
                <ActorIcon className="size-3" />{ACTORS[step.actor]}
              </span>
            </div>
            <h4 className="text-base font-semibold">{step.title}</h4>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
            <div className="flex items-center gap-2 border-t pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
                <ChevronLeft /> Back
              </Button>
              <div className="flex flex-1 items-center justify-center gap-1.5">
                {STORY.map((s, i) => <button key={i} type="button" aria-label={`Step ${i + 1}: ${s.title}`} aria-current={i === index ? 'step' : undefined}
                  onClick={() => go(i)} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-primary' : i < index ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/30')} />)}
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={running ? 'Pause' : 'Play the example'}
                onClick={() => { if (running) { setPlaying(false); return } if (index === last) setIndex(0); setPlaying(true) }}>
                {running ? <Pause /> : <Play />}
              </Button>
              <Button type="button" size="sm" onClick={() => go(index + 1)} disabled={index === last}>
                Next <ChevronRight />
              </Button>
            </div>
          </section>

          <section className="flex min-h-48 flex-1 flex-col gap-2 rounded-xl border bg-card p-4 md:[contain:size]" aria-label="Calls">
            <h3 className={microLabel}>Calls</h3>
            <ol ref={logRef} className="-mx-1 grid min-h-0 content-start gap-1.5 overflow-y-auto px-1">
              {log.map((entry, i) => {
                const LogIcon = ACTOR_ICONS[entry.actor]
                const now = entry.step === index
                return <li key={i} className={cn('flex gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors',
                  now ? 'border-primary/30 bg-primary/5' : 'border-transparent')}>
                  <LogIcon className={cn('mt-0.5 size-3.5 shrink-0', now ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="grid min-w-0 gap-0.5">
                    <span className={cn('font-mono text-[11.5px] font-medium break-words', !now && 'text-muted-foreground')}>{entry.call}</span>
                    <span className="text-[11.5px] text-muted-foreground">{entry.result}</span>
                  </div>
                </li>
              })}
            </ol>
          </section>
        </div>
      </div>

      <section className="grid gap-2" aria-label="The rules">
        <h3 className={microLabel}>The rules — and the two escapes</h3>
        <ul className="grid gap-2 md:grid-cols-3">
          {RULES.map((rule) => <li key={rule.title} className="grid content-start gap-1 rounded-lg border bg-card px-3 py-2.5">
            <span className="text-xs font-medium">{rule.title}</span>
            <span className="text-[11.5px] leading-snug text-muted-foreground">{rule.text}</span>
          </li>)}
        </ul>
      </section>
    </div>
  </div>
}
