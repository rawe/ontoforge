import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, CircleQuestionMark, FileStack, Pause, Play, Plug, UserRound, type LucideIcon } from 'lucide-react'
import { ChangesetStateChip } from '@/components/changesets/ChangesetStateChip'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ChangesetExplainerFlow } from './ChangesetExplainerFlow'
import { EXAMPLE, ROLES, STORY, logUpTo, passedNodes, type Actor } from './changesetExplainerStory'

const PLAY_MS = 5000
const TITLE = 'How a changeset works'
const ACTOR_ICONS: Record<Actor, LucideIcon> = { client: Plug, person: UserRound }

const FACTS = [
  { label: 'Belongs to', value: 'its lens, and the anchor it was started through' },
  { label: 'Version', value: 'rises with every change; the Workbench commits the one on the screen' },
  { label: 'A draft', value: 'expires after 7 days unchanged' },
]

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/**
 * Opens how a changeset works — the workflow between a client and a person, told over one
 * example: a bare "?" beside a page title, or `labeled` — "? How changesets work" — where
 * another explainer or page points to it.
 */
export function ChangesetExplainerButton({ labeled = false, className }: { labeled?: boolean; className?: string }) {
  if (labeled) return <Dialog>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="sm" className={className}><CircleQuestionMark className="size-3.5" /> How changesets work</Button>
    </DialogTrigger>
    <ChangesetExplainerDialog />
  </Dialog>
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
    <ChangesetExplainerDialog />
  </Dialog>
}

function ChangesetExplainerDialog() {
  return <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(78rem,calc(100%-2rem))]">
    <ChangesetExplainerPanel />
  </DialogContent>
}

/** The explainer's content: the workflow, an example changeset through it, step by step. */
function ChangesetExplainerPanel() {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const step = STORY[index]
  const previous = index > 0 ? STORY[index - 1] : null
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

  const shown = EXAMPLE.writes.filter((write) => step.writes.includes(write.seq) || step.unstaged?.includes(write.seq))
  const newNote = previous === null || previous.note !== step.note

  return <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
    <header className="flex items-start gap-3 border-b px-6 pt-5 pb-4 pr-14">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileStack className="size-5" /></span>
      <div className="grid min-w-0 gap-1.5">
        <DialogTitle className="text-lg font-semibold">{TITLE}</DialogTitle>
        <DialogDescription className="max-w-3xl text-[13px] leading-relaxed">
          A changeset is a plan of writes: staged, not written, and invisible to every read until it is committed — then all of
          them persist, or none does. A client or a person proposes the plan; a person reviews it and decides.
        </DialogDescription>
        <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {FACTS.map((fact) => <div key={fact.label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{fact.label}</dt><dd className="font-medium">{fact.value}</dd>
          </div>)}
        </dl>
      </div>
    </header>

    <div className="grid min-h-0 gap-4 overflow-y-auto px-6 py-5">
      <section className="rounded-xl border bg-card px-4 pt-3 pb-3" aria-label="The workflow">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className={microLabel}>The workflow — and who may take each way</h3>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-primary" />This step</li>
            <li>* not through a staged-only anchor</li>
          </ul>
        </div>
        <ChangesetExplainerFlow current={step.node} passed={passedNodes(index)} lit={step.edges} onSelect={go} />
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4" aria-label="The example changeset">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={microLabel}>On an example changeset</h3>
            <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {step.state === 'committed'
                ? <span className="inline-flex items-center rounded-full border border-transparent bg-(--tc-emerald-bg) px-2 py-0.5 text-[11px] font-semibold text-(--tc-emerald)">Committed</span>
                : <ChangesetStateChip state={step.state} />}
              <span className="tabular-nums">version {step.version}</span>
            </span>
          </div>
          <div className={cn('rounded-lg border px-3 py-2 text-[13px] transition-colors', newNote ? 'border-primary/40 bg-primary/5' : 'bg-muted/30')}>
            <div className={microLabel}>Note</div>
            <p>{step.note}</p>
          </div>
          <div className="grid gap-1.5">
            <div className={microLabel}>Staged writes</div>
            {shown.length === 0
              ? <p className="text-[12.5px] text-muted-foreground">None yet.</p>
              : <ul className="grid gap-1">
                {shown.map((write) => {
                  const struck = step.unstaged?.includes(write.seq)
                  const fresh = !struck && previous !== null && !previous.writes.includes(write.seq)
                  return <li key={write.seq} className={cn('flex flex-wrap items-baseline gap-x-2.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors',
                    fresh ? 'border-primary/40 bg-primary/5' : 'border-border', struck && 'border-dashed')}>
                    <span className={cn('flex flex-wrap items-baseline gap-x-2.5', struck && 'line-through opacity-50')}>
                      <span className="font-mono text-[11.5px] text-muted-foreground">#{write.seq}</span>
                      <span className="w-12 font-medium">{write.op}</span>
                      <span>{write.target}</span>
                      {write.change && <span className="text-muted-foreground">{write.change}</span>}
                    </span>
                    {struck && <span className="ml-auto text-[11px] text-muted-foreground">unstaged</span>}
                  </li>
                })}
              </ul>}
          </div>
          <div className="mt-auto grid gap-1.5 border-t pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={microLabel}>What every read sees</span>
              <span className="text-[11px] text-muted-foreground">{step.state === 'committed' ? 'the committed writes' : 'the stored data — nothing staged'}</span>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {step.stored.map((item) => {
                const fresh = previous !== null && !previous.stored.includes(item)
                return <li key={item} className={cn('rounded-md border px-2 py-0.5 text-[12px] transition-colors', fresh ? 'border-primary bg-primary/12' : 'bg-muted/40')}>{item}</li>
              })}
            </ul>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="grid gap-3 rounded-xl border bg-card p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <span className={microLabel}>Step {index + 1} of {STORY.length}</span>
              <span className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                step.actor === 'person' ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>
                <ActorIcon className="size-3" />{ROLES[step.actor].title}
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

      <section className="grid gap-2" aria-label="Who does what">
        <h3 className={microLabel}>Who does what — and the note</h3>
        <div className="grid gap-2 md:grid-cols-3">
          {(['client', 'person'] as const).map((actor) => {
            const role = ROLES[actor]
            const RoleIcon = ACTOR_ICONS[actor]
            return <div key={actor} className={cn('grid content-start gap-2 rounded-lg border px-3 py-2.5 transition-colors', step.actor === actor ? 'border-primary/40 bg-primary/5' : 'bg-card')}>
              <span className="flex items-baseline gap-1.5 text-xs font-medium">
                <RoleIcon className="size-3.5 self-center" />{role.title}
                <span className="font-normal text-muted-foreground">{role.via}</span>
              </span>
              <ul className="flex flex-wrap gap-1">
                {role.actions.map((action) => {
                  const on = step.actor === actor && step.action === action
                  return <li key={action} className={cn('rounded border px-1.5 py-px text-[11px]', on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground')}>{action}</li>
                })}
              </ul>
              <span className="text-[11.5px] leading-snug text-muted-foreground">{role.hint}</span>
            </div>
          })}
          <div className={cn('grid content-start gap-1.5 rounded-lg border px-3 py-2.5 transition-colors', newNote ? 'border-primary/40 bg-primary/5' : 'bg-card')}>
            <span className="text-xs font-medium">The note</span>
            <span className="text-[11.5px] leading-snug text-muted-foreground">
              Optional at the start, at most 1,000 characters. Submit replaces it when it brings one; unsubmit requires one and
              replaces it, so it tells the client what to change. The Workbench sets it at the start, by submit and by unsubmit.
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
}
