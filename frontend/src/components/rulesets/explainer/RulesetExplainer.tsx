import { useEffect, useRef, type ComponentType } from 'react'
import { Anchor, Plug, PencilLine, ScrollText, UserRound, type LucideIcon } from 'lucide-react'
import { ChangesetExplainerButton } from '@/components/changesets/explainer/ChangesetExplainer'
import { ExplainerButton } from '@/components/explainer/ExplainerButton'
import { ExplainerDialog, type ExplainerStory } from '@/components/explainer/ExplainerDialog'
import { cn } from '@/lib/utils'
import { RulesetExplainerFlow } from './RulesetExplainerFlow'
import { RulesetExplainerLadder } from './RulesetExplainerLadder'
import { RulesetExplainerTree } from './RulesetExplainerTree'
import { ANCHOR_CAPTIONS, STORY, logUpTo, type Actor, type RuleId, type RULE_IDS, type StoryStep } from './rulesetExplainerStory'

const ACTOR_ICONS: Record<Actor, LucideIcon> = { client: Plug, person: UserRound }
const ACTORS: Record<Actor, string> = { client: 'Client', person: 'Person' }

const EXPLAINER: ExplainerStory<StoryStep> = {
  title: 'What a ruleset does to a client',
  icon: ScrollText,
  summary: <>
    A ruleset gives an AI client its own MCP URL, and holds rules that every call through that URL must follow.
    Write access says what the client may do: read only (none), propose changes that a person commits (propose), or
    write as the lens allows (full). An anchor, if set, says where it may write: inside one entity’s subtree, while
    other hierarchies and types stay free.
  </>,
  facts: [
    { label: 'Reads', value: 'not narrowed: the whole lens' },
    { label: 'Checked', value: 'on every call, against the ruleset as it is then' },
    { label: 'Not authentication', value: 'it guards against mistakes' },
  ],
  steps: STORY,
}

/** The step body's lines beside the controls: two, so the explainer fits on one screen. */
const STEP_BODY_LINES = 2

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/** The write access card's picture: the staircase, centred in the card's height. */
function WriteAccessVisual({ step }: { step: StoryStep }) {
  return <div className="flex min-h-0 flex-1 flex-col justify-center"><RulesetExplainerLadder step={step} /></div>
}

/** The anchor card's picture: the example hierarchy and its legend. */
function AnchorVisual({ step }: { step: StoryStep }) {
  return <>
    <div className="flex min-h-0 flex-1 flex-col justify-center"><RulesetExplainerTree step={step} /></div>
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-primary" />Anchor</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-primary/45 bg-primary/6" />In the subtree</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-border bg-card" />Outside the subtree</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-dashed border-foreground/40 bg-card" />Free type</li>
    </ul>
  </>
}

/** The anchor's caption, beside the card's title. */
function AnchorCaption({ step }: { step: StoryStep }) {
  if (!step.anchor) return null
  return <p className={cn('text-[11px]', step.anchor === 'deleted' ? 'font-medium text-destructive' : 'text-muted-foreground')}>{ANCHOR_CAPTIONS[step.anchor]}</p>
}

interface RuleCard<Id = RuleId> {
  id: Id
  title: string
  icon: LucideIcon
  Visual: ComponentType<{ step: StoryStep }>
  /** Beside the card's title. */
  Aside?: ComponentType<{ step: StoryStep }>
  /** The rule's setting at a step for the flow's heading, such as "write access propose"; null when the step has none. */
  phrase: (step: StoryStep) => string | null
}

/** One card per id, in the ids' order. */
type CardsOf<Ids extends readonly RuleId[]> = { [I in keyof Ids]: RuleCard<Ids[I]> }

/**
 * The ruleset's rules, one card each, in rule order, side by side under the flow. Typed by
 * `RULE_IDS`, so every rule has exactly one card. A new rule is one more entry.
 */
const RULE_CARDS: CardsOf<typeof RULE_IDS> = [
  {
    id: 'writeAccess', title: 'Write access', icon: PencilLine, Visual: WriteAccessVisual,
    phrase: (step) => step.writeAccess && `write access ${step.writeAccess}`,
  },
  {
    id: 'anchor', title: 'Anchor', icon: Anchor, Visual: AnchorVisual, Aside: AnchorCaption,
    phrase: (step) => step.anchor && { none: 'no anchor', found: 'anchor Apollo', deleted: 'anchor deleted' }[step.anchor],
  },
]

/** "write access propose · anchor Apollo": each rule's phrase at a step, for the flow's heading. */
const rulesAt = (step: StoryStep) =>
  RULE_CARDS.map((card) => card.phrase(step)).filter((phrase) => phrase !== null).join(' · ')

/** What a ruleset step shows beside its title: who takes it. */
function ActorTag({ step }: { step: StoryStep }) {
  const ActorIcon = ACTOR_ICONS[step.actor]
  return <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
    step.actor === 'person' ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
    <ActorIcon className="size-3" />{ACTORS[step.actor]}
  </span>
}

/** Opens what a ruleset does to a client — write access, then the anchor — told over one example: a "?" beside a page title. */
export function RulesetExplainerButton({ className }: { className?: string }) {
  return <ExplainerButton title={EXPLAINER.title} className={className}>
    <ExplainerDialog story={EXPLAINER} label="The step and the way of a write" bodyLines={STEP_BODY_LINES}
      tag={(step) => <ActorTag step={step} />} aside={<ChangesetExplainerButton labeled className="shrink-0" />}
      diagram={({ step }) => {
        const rules = rulesAt(step)
        return <>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <h3 className={microLabel}>The way of a write{rules && ` — ${rules}`}</h3>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-primary" />This step</li>
              <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] border border-destructive bg-destructive/10" />Refused here</li>
            </ul>
          </div>
          <RulesetExplainerFlow step={step} />
        </>
      }}>
      {({ step, index }) => <RulesetExample step={step} index={index} />}
    </ExplainerDialog>
  </ExplainerButton>
}

/**
 * The ruleset's rules on the example at a step, beside the calls so far. The rule cards and
 * Calls share one height, set by the hierarchy; Calls scrolls to its latest call.
 */
function RulesetExample({ step, index }: { step: StoryStep; index: number }) {
  const log = logUpTo(index)
  const logRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = logRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [index])

  return <div className="grid grid-cols-[19rem_auto_minmax(0,1fr)] gap-x-3 gap-y-1">
    <h3 className={cn(microLabel, 'col-span-2')}>Ruleset <span className="font-mono normal-case">agent-a</span></h3>
    {RULE_CARDS.map(({ id, title, icon: Icon, Visual, Aside }) => {
      const lit = step.rule === id || step.rule === 'both'
      return <section key={id} aria-label={title}
        className={cn('row-start-2 flex flex-col gap-2 rounded-xl border bg-card p-3 transition-[background-color,border-color,opacity] duration-500',
          lit ? 'border-primary/40 bg-primary/5' : step.rule !== 'ruleset' && 'opacity-70')}>
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-xs font-medium"><Icon className="size-3.5 text-muted-foreground" />{title}</h4>
          {Aside && <Aside step={step} />}
        </div>
        <Visual step={step} />
      </section>
    })}

    <section className="row-start-2 flex min-h-0 flex-col gap-2 rounded-xl border bg-card p-3 [contain:size]" aria-label="Calls">
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
}
