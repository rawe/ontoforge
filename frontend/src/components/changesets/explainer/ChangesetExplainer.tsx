import { ChevronRight, FileStack, Plug, UserRound, type LucideIcon } from 'lucide-react'
import { ChangesetStateChip } from '@/components/changesets/ChangesetStateChip'
import { ExplainerButton } from '@/components/explainer/ExplainerButton'
import { ExplainerDialog, type ExplainerStory } from '@/components/explainer/ExplainerDialog'
import { cn } from '@/lib/utils'
import { ChangesetExplainerFlow } from './ChangesetExplainerFlow'
import { PHASES, ROLES, STORY, passedNodes, type Actor, type ExampleObject, type StoryStep } from './changesetExplainerStory'

const ACTOR_ICONS: Record<Actor, LucideIcon> = { client: Plug, person: UserRound }

const EXPLAINER: ExplainerStory<StoryStep> = {
  title: 'How a changeset works',
  icon: FileStack,
  summary: <>
    A changeset is a set of staged changes: for each entity or relation it touches one staged object, for each property
    one staged value. Nothing in it is written, and every read sees only the stored data, until it is committed — then all
    of it persists, or none does. A client or a person proposes it; a person reviews it and decides.
  </>,
  facts: [
    { label: 'Belongs to', value: 'its lens, and the ruleset it was started through' },
    { label: 'Version', value: 'rises with every change; the Workbench commits the one on the screen' },
    { label: 'A draft', value: 'expires after 7 days unchanged' },
  ],
  steps: STORY,
}

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/** A commit applies an object in its action's phase: 1 creates, 2 updates, 3 deletes. */
const phaseOf = (object: ExampleObject) => PHASES.findIndex((phase) => phase.action === object.action) + 1

/** The example's staged objects at a step, each with its values; what is new since the step before is lit. */
function ExampleObjects({ step, previous }: { step: StoryStep; previous: StoryStep | null }) {
  const committed = step.state === 'committed'
  const objects = committed ? [...step.objects].sort((a, b) => phaseOf(a) - phaseOf(b)) : step.objects
  if (objects.length === 0) return <p className="text-[12.5px] text-muted-foreground">None yet.</p>
  return <ul className="grid gap-1">
    {objects.map((object) => {
      const before = previous?.objects.find((o) => o.id === object.id)
      const fresh = previous !== null && before === undefined
      return <li key={object.id} className={cn('rounded-md border px-2.5 py-1 text-[12.5px] transition-colors',
        fresh ? 'border-primary/40 bg-primary/5' : 'border-border', object.removed && 'border-dashed')}>
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className={cn('flex flex-wrap items-baseline gap-x-2.5', object.removed && 'line-through opacity-50')}>
            <span className="w-12 font-medium">{object.action}</span>
            <span>{object.target}</span>
          </span>
          {object.removed && <span className="ml-auto text-[11px] text-muted-foreground">removed</span>}
          {committed && <span className="ml-auto text-[11px] text-primary">phase {phaseOf(object)} · {PHASES[phaseOf(object) - 1].label}</span>}
        </div>
        {object.values.length > 0 && <ul className="grid gap-0.5 pt-0.5 pl-[3.625rem]">
          {object.values.map((value) => {
            const was = before?.values.find((v) => v.property === value.property)
            const changed = previous !== null && !fresh && (was === undefined || was.change !== value.change || was.drift !== value.drift)
            return <li key={value.property} className={cn('flex flex-wrap items-baseline gap-x-2 rounded-sm px-1 -mx-1 transition-colors', changed && !value.cut && 'bg-primary/8')}>
              <span className={cn('flex flex-wrap items-baseline gap-x-2', value.cut && 'line-through opacity-50')}>
                <span className="font-mono text-[11.5px] text-muted-foreground">{value.property}</span>
                <span>{value.change}</span>
              </span>
              {value.drift && <span className="rounded-full border border-(--tc-amber-border) px-1.5 text-[10.5px] font-semibold text-(--tc-amber)">drift</span>}
              {value.cut && <span className="ml-auto text-[11px] text-muted-foreground">cut</span>}
            </li>
          })}
        </ul>}
      </li>
    })}
  </ul>
}

/** What an explainer step shows beside its title: who takes it. */
function ActorTag({ step }: { step: StoryStep }) {
  const ActorIcon = ACTOR_ICONS[step.actor]
  return <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
    step.actor === 'person' ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
    <ActorIcon className="size-3" />{ROLES[step.actor].title}
  </span>
}

/**
 * Opens how a changeset works — the workflow between a client and a person, told over one
 * example changeset and its staged objects: a bare "?" beside a page title, or `labeled` — "? How changesets work" — where
 * another explainer or page points to it.
 */
export function ChangesetExplainerButton({ labeled = false, className }: { labeled?: boolean; className?: string }) {
  return <ExplainerButton title={EXPLAINER.title} label={labeled ? 'How changesets work' : undefined} className={className}>
    <ExplainerDialog story={EXPLAINER} label="The step and the workflow" tag={(step) => <ActorTag step={step} />}
      diagram={({ index, step, go }) => <>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <h3 className={microLabel}>The workflow — and who may take each way</h3>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-primary" />This step</li>
            <li>* not with write access propose</li>
          </ul>
        </div>
        <ChangesetExplainerFlow current={step.node} passed={passedNodes(index)} lit={step.edges} onSelect={go} />
      </>}>
      {({ index, step }) => <ChangesetExample step={step} previous={index > 0 ? STORY[index - 1] : null} />}
    </ExplainerDialog>
  </ExplainerButton>
}

/** The example changeset at a step beside what every read sees and the commit's phases. */
function ChangesetExample({ step, previous }: { step: StoryStep; previous: StoryStep | null }) {
  const newNote = previous === null || previous.note !== step.note
  const committed = step.state === 'committed'

  return <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-3" aria-label="The example changeset">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={microLabel}>On an example changeset</h3>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {step.state === 'committed'
            ? <span className="inline-flex items-center rounded-full border border-transparent bg-(--tc-emerald-bg) px-2 py-0.5 text-[11px] font-semibold text-(--tc-emerald)">Committed</span>
            : <ChangesetStateChip state={step.state} />}
          <span className="tabular-nums">version {step.version}</span>
        </span>
      </div>
      {/* As high as the most objects and values a step shows, so the dialog keeps one height. */}
      <div className="grid min-h-[12rem] content-start gap-1">
        <div className={microLabel}>Staged objects</div>
        <ExampleObjects step={step} previous={previous} />
      </div>
    </section>

    <div className="flex min-w-0 flex-col gap-3">
      <section className={cn('grid gap-1 rounded-xl border p-3 text-[13px] transition-colors', newNote ? 'border-primary/40 bg-primary/5' : 'bg-card')} aria-label="Note">
        <span className={microLabel}>Note</span>
        <p>{step.note}</p>
      </section>
      <section className="grid gap-1.5 rounded-xl border bg-card p-3" aria-label="What every read sees">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={microLabel}>What every read sees</span>
          <span className="text-[11px] text-muted-foreground">{committed ? 'the committed set' : 'the stored data — nothing staged'}</span>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {step.stored.map((item) => {
            const fresh = previous !== null && !previous.stored.includes(item)
            return <li key={item} className={cn('rounded-md border px-2 py-0.5 text-[12px] transition-colors', fresh ? 'border-primary bg-primary/12' : 'bg-muted/40')}>{item}</li>
          })}
        </ul>
      </section>
      <section className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-card p-3 transition-[background-color,border-color] duration-500',
        committed && 'border-primary/40 bg-primary/5')} aria-label="The commit">
        <span className={microLabel}>The commit, in phases</span>
        <ol className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {PHASES.map((phase, i) => <li key={phase.action} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
            <span className={cn('rounded-md border px-2 py-0.5', committed ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-muted/40')}>{i + 1} · {phase.label}</span>
          </li>)}
        </ol>
      </section>
    </div>
  </div>
}
