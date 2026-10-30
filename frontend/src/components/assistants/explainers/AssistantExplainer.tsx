import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Funnel, Layers, ListOrdered, MessageCircleQuestionMark, MessageSquareText, Search, Sparkles, Waypoints, Wrench, type LucideIcon,
} from 'lucide-react'
import type { AssistantKind } from '@/api/types'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { ExplainerButton } from '@/components/explainer/ExplainerButton'
import { ExplainerDialog, type ExplainerStory } from '@/components/explainer/ExplainerDialog'
import { cn } from '@/lib/utils'
import { AssistantExplainerFlow } from './AssistantExplainerFlow'
import { AssistantExplainerGraph } from './AssistantExplainerGraph'
import { EXAMPLE, EXPLAINERS, litEdges, logUpTo, passedNodes, type Explainer, type LogEntry, type StoryStep } from './assistantExplainerStories'

const KINDS: AssistantKind[] = ['agents', 'retrievers', 'navigators']

const storyOf = (kind: AssistantKind): ExplainerStory<StoryStep> => {
  const { title, summary, facts, story } = EXPLAINERS[kind]
  return { title, icon: ASSISTANT_KINDS[kind].icon, summary, facts, steps: story }
}

/** One story per kind, made once: a tab switches to another story, which starts at its first step. */
const STORIES: Record<AssistantKind, ExplainerStory<StoryStep>> = {
  agents: storyOf('agents'), retrievers: storyOf('retrievers'), navigators: storyOf('navigators'),
}

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
  return <ExplainerButton title={`How ${article(one)} ${one.toLowerCase()} works`} label={labeled ? `How ${many} work` : undefined} className={className}>
    <AssistantExplainerDialog openedFor={kind} />
  </ExplainerButton>
}

/** The explainer of the kind chosen in its tabs: the flow of one run, an example run over it, step by step. */
function AssistantExplainerDialog({ openedFor }: { openedFor: AssistantKind }) {
  const [kind, setKind] = useState(openedFor)
  const reset = useCallback(() => setKind(openedFor), [openedFor])
  const explainer = EXPLAINERS[kind]
  const story = explainer.story

  return <ExplainerDialog story={STORIES[kind]} label="The step and the flow of a run"
    tag={(step) => <NodeTag explainer={explainer} step={step} />}
    aside={<KindTabs kind={kind} onSelect={setKind} onClose={reset} />}
    diagram={({ index, step, go }) => <>
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
    </>}>
    {({ index, step }) => <AssistantExample explainer={explainer} step={step} index={index} />}
  </ExplainerDialog>
}

/**
 * Switches the explainer to another kind. The tabs live as long as the open dialog, so
 * `onClose` brings back the kind it was opened for; the arrow keys stay with the tabs
 * instead of moving the step.
 */
function KindTabs({ kind, onSelect, onClose }: { kind: AssistantKind; onSelect: (kind: AssistantKind) => void; onClose: () => void }) {
  useEffect(() => onClose, [onClose])
  const keepArrows = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation() }
  return <div role="tablist" aria-label="Assistant kind" onKeyDown={keepArrows} className="flex shrink-0 rounded-lg border bg-muted/50 p-0.5">
    {KINDS.map((option) => {
      const { one, icon: KindIcon } = ASSISTANT_KINDS[option]
      return <button key={option} type="button" role="tab" aria-selected={option === kind} onClick={() => onSelect(option)}
        className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          option === kind ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
        <KindIcon className="size-3.5" />{one}
      </button>
    })}
  </div>
}

/** What an explainer step shows beside its title: the step of the flow it runs in, tinted when it calls the model. */
function NodeTag({ explainer, step }: { explainer: Explainer; step: StoryStep }) {
  const node = explainer.flow.nodes.find((n) => n.id === step.node)!
  return <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
    node.role === 'model' ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
    {node.role === 'model' && <Sparkles className="size-3" />}{node.label}
  </span>
}

/** The example run at a step: the example graph beside the run log, then the settings that steer the run. */
function AssistantExample({ explainer, step, index }: { explainer: Explainer; step: StoryStep; index: number }) {
  const story = explainer.story
  return <>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-3" aria-label="The example graph">
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

      <RunLog explainer={explainer} index={index} />
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
  </>
}

/** What the run called, found and decided up to the step, the step's own entries lit; it scrolls to the newest. */
function RunLog({ explainer, index }: { explainer: Explainer; index: number }) {
  const log = logUpTo(explainer, index)
  const logRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = logRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [explainer, index])

  return <section className="flex min-h-48 flex-col gap-2 rounded-xl border bg-card p-3 md:[contain:size]" aria-label="Run log">
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
}
