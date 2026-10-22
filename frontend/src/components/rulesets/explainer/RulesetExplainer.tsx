import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { Anchor, ChevronLeft, ChevronRight, CircleQuestionMark, Pause, Play, PencilLine, Plug, ScrollText, UserRound, type LucideIcon } from 'lucide-react'
import { ChangesetExplainerButton } from '@/components/changesets/explainer/ChangesetExplainer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { WRITE_ACCESS_LEVELS } from '../rulesets'
import { WriteAccessChip } from '../WriteAccessChip'
import { RulesetExplainerFlow } from './RulesetExplainerFlow'
import { RulesetExplainerLadder } from './RulesetExplainerLadder'
import { RulesetExplainerTree } from './RulesetExplainerTree'
import { ANCHOR_CAPTIONS, STORY, logUpTo, type Actor, type RuleId, type RULE_IDS, type StepRule, type StoryStep } from './rulesetExplainerStory'

const PLAY_MS = 5000
const TITLE = 'What a ruleset does to a client'
const ACTOR_ICONS: Record<Actor, LucideIcon> = { client: Plug, person: UserRound }
const ACTORS: Record<Actor, string> = { client: 'Client', person: 'Person' }

const FACTS = [
  { label: 'Reads', value: 'not narrowed: the whole lens' },
  { label: 'Checked', value: 'on every call, against the ruleset as it is then' },
  { label: 'Not authentication', value: 'it guards against mistakes' },
]

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/** The anchor card's picture: the example hierarchy, its caption and its legend. */
function AnchorVisual({ step }: { step: StoryStep }) {
  return <>
    <p className={cn('text-[11px]', step.anchor === 'deleted' ? 'font-medium text-destructive' : 'text-muted-foreground')}>{ANCHOR_CAPTIONS[step.anchor]}</p>
    <RulesetExplainerTree step={step} />
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-primary" />Anchor</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-primary/45 bg-primary/6" />In the subtree</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-border bg-card" />Outside the subtree</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-dashed border-foreground/40 bg-card" />Free type</li>
    </ul>
  </>
}

interface RuleCard<Id = RuleId> {
  id: Id
  title: string
  icon: LucideIcon
  Visual: ComponentType<{ step: StoryStep }>
}

/** One card per id, in the ids' order. */
type CardsOf<Ids extends readonly RuleId[]> = { [I in keyof Ids]: RuleCard<Ids[I]> }

/**
 * The ruleset's rules, one card each, in rule order: the left column. Typed by
 * `RULE_IDS`, so every rule has exactly one card. A new rule is one more entry.
 */
const RULE_CARDS: CardsOf<typeof RULE_IDS> = [
  { id: 'writeAccess', title: 'Write access', icon: PencilLine, Visual: RulesetExplainerLadder },
  { id: 'anchor', title: 'Anchor', icon: Anchor, Visual: AnchorVisual },
]

/** The bottom row: one card per rule, then what holds for all of them. */
const BOTTOM_CARDS: { id: StepRule; title: string; icon?: LucideIcon; text: ReactNode }[] = [
  {
    id: 'writeAccess', title: 'Write access', icon: PencilLine,
    text: <ul className="grid gap-1">
      {WRITE_ACCESS_LEVELS.map((level) => <li key={level.level} className="flex items-start gap-1.5">
        <WriteAccessChip level={level.level} className="shrink-0" />{level.short}
      </li>)}
    </ul>,
  },
  {
    id: 'anchor', title: 'Anchor', icon: Anchor,
    text: 'Writes to the anchor’s hierarchy stay in its subtree: a create needs its parent inside it; an update, a delete or a relation may touch only covered entities and free types. No anchor: no limit on where. Anchor deleted: every write is refused.',
  },
  {
    id: 'both', title: 'Both must pass',
    text: 'Write access is checked first, then the anchor. A write goes through only if every rule allows it.',
  },
  {
    id: 'escapes', title: 'Two escapes',
    text: 'Neither is a lock. 1. The plain lens URL, the same URL without the ruleset, writes as the lens allows. 2. Ruleset maintenance, open to any REST client, can change the rules.',
  },
]

const isRule = (id: StepRule) => RULE_CARDS.some((card) => card.id === id)

/** "write access propose · anchor Apollo": the rules at a step, for the flow's heading. */
const rulesAt = (step: StoryStep) =>
  `write access ${step.writeAccess} · ${step.anchor === 'none' ? 'no anchor' : step.anchor === 'found' ? 'anchor Apollo' : 'anchor deleted'}`

/** Opens what a ruleset does to a client — write access, then the anchor — told over one example: a "?" beside a page title. */
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

/** The explainer's content: a write's way, the ruleset's rules on an example, step by step, and the rules in short. */
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
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ScrollText className="size-5" /></span>
        <div className="grid min-w-0 gap-1.5">
          <DialogTitle className="text-lg font-semibold">{TITLE}</DialogTitle>
          <DialogDescription className="max-w-3xl text-[13px] leading-relaxed">
            A ruleset gives an AI client its own MCP URL, and holds rules that every call through that URL must follow.
            Write access says what the client may do: read only (none), propose changes that a person commits (propose), or
            write as the lens allows (full). An anchor, if set, says where it may write: inside one entity’s subtree, while
            other hierarchies and types stay free.
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
          <h3 className={microLabel}>The way of a write — {rulesAt(step)}</h3>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-primary" />This step</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-destructive bg-destructive/10" />Refused here</li>
          </ul>
        </div>
        <RulesetExplainerFlow step={step} />
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3" aria-label="The ruleset agent-a">
          <h3 className={microLabel}>Ruleset <span className="font-mono normal-case">agent-a</span></h3>
          {RULE_CARDS.map(({ id, title, icon: Icon, Visual }) => {
            const lit = step.rule === id || step.rule === 'both'
            return <section key={id} aria-label={title}
              className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4 transition-[background-color,border-color,opacity] duration-500',
                lit ? 'border-primary/40 bg-primary/5' : step.rule !== 'ruleset' && 'opacity-70')}>
              <h4 className="flex items-center gap-1.5 text-xs font-medium"><Icon className="size-3.5 text-muted-foreground" />{title}</h4>
              <Visual step={step} />
            </section>
          })}
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
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5">
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
                    {entry.result && <span className="text-[11.5px] text-muted-foreground">{entry.result}</span>}
                  </div>
                </li>
              })}
            </ol>
          </section>
        </div>
      </div>

      <section className="grid gap-2" aria-label="The rules">
        <h3 className={microLabel}>The rules — and the two escapes</h3>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {BOTTOM_CARDS.map(({ id, title, icon: Icon, text }) => <li key={id}
            className={cn('grid content-start gap-1 rounded-lg border bg-card px-3 py-2.5 transition-[background-color,border-color] duration-500',
              step.rule === id && !isRule(id) && 'border-primary/40 bg-primary/5')}>
            <span className="flex items-center gap-1.5 text-xs font-medium">{Icon && <Icon className="size-3.5 text-muted-foreground" />}{title}</span>
            <div className="text-[11.5px] leading-snug text-muted-foreground">{text}</div>
          </li>)}
        </ul>
      </section>
    </div>
  </div>
}
