import { useEffect, useRef, type ReactNode } from 'react'
import {
  ArrowUpRight, Circle, CircleCheck, CircleDashed, CircleMinus, CircleSlash, CircleX, LoaderCircle, Repeat, Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDuration, type Turn } from '@/components/assistants/chat/chatModel'
import { TypeChip } from '@/components/TypeChip'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { EvidenceGraph } from './EvidenceGraph'
import type { EntityCard, GraphStep } from './graphEvents'
import { groupByRole, roleInfo, stepState, type GraphInsight, type RunStatus } from './graphTurnModel'

export type SidebarView = 'entities' | 'graph' | 'steps'

interface EvidenceSidebarProps {
  ontologyKey: string
  lensKey: string
  turn: Turn<GraphInsight>
  view: SidebarView
  onView: (view: SidebarView) => void
  /** The selected card's ref in this answer, if any. */
  selected: string | null
  onSelect: (ref: string) => void
}

/**
 * A graph kind's insight panel for one answer: the cards it found
 * (Entities), the same as a node-link view (Graph), and its pipeline with
 * live status (Steps). It fills while the answer streams.
 */
export function EvidenceSidebar({ ontologyKey, lensKey, turn, view, onView, selected, onSelect }: EvidenceSidebarProps) {
  const { insight } = turn
  return (
    <Tabs value={view} onValueChange={(value) => onView(value as SidebarView)} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="border-b px-3 py-2">
        <TabsList className="h-7 w-full">
          <TabsTrigger value="entities" className="text-xs">
            Entities{insight.entities.length > 0 && <span className="tabular-nums text-muted-foreground">{insight.entities.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="graph" className="text-xs">Graph</TabsTrigger>
          <TabsTrigger value="steps" className="text-xs">Steps</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="entities" className="min-h-0 flex-1 overflow-y-auto p-3">
        <EntityCardList ontologyKey={ontologyKey} lensKey={lensKey} turn={turn} selected={selected} onSelect={onSelect} />
      </TabsContent>
      <TabsContent value="graph" className="flex min-h-0 flex-1 flex-col">
        {insight.entities.length === 0 ? <div className="p-3"><Waiting turn={turn} /></div> : <>
          <div className="min-h-[260px] flex-1">
            <EvidenceGraph entities={insight.entities} links={insight.links} selected={selected} onSelect={onSelect} />
          </div>
          <Legend />
        </>}
      </TabsContent>
      <TabsContent value="steps" className="min-h-0 flex-1 overflow-y-auto p-3">
        <StepList turn={turn} />
      </TabsContent>
    </Tabs>
  )
}

/**
 * An answer's cards grouped by role, with how many are evidence. `compact`
 * leaves out the fields and the count line (the Explorer's ask dock);
 * `aside` adds something after each card's label; `onHover` reports the
 * card under the pointer.
 */
export function EntityCardList({ ontologyKey, lensKey, turn, selected, onSelect, compact = false, aside, onHover }: {
  ontologyKey: string
  lensKey: string
  turn: Turn<GraphInsight>
  /** The selected card's ref in this answer, if any. */
  selected: string | null
  onSelect: (ref: string) => void
  compact?: boolean
  aside?: (card: EntityCard) => ReactNode
  onHover?: (ref: string | null) => void
}) {
  const { entities } = turn.insight
  if (entities.length === 0) return <Waiting turn={turn} />
  const evidence = entities.filter((card) => card.evidence === true).length
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {!compact && (
        <p className="text-xs text-muted-foreground">
          {entities.length} {entities.length === 1 ? 'entity' : 'entities'}
          {evidence > 0 && <> · <span className="font-medium text-foreground">{evidence} evidence</span> handed to the answer</>}
        </p>
      )}
      {groupByRole(entities).map(({ role, cards }) => (
        <section key={role} className={compact ? 'space-y-1.5' : 'space-y-2'}>
          <h3 className="flex items-baseline gap-1.5 text-xs font-medium">
            <span aria-hidden className="size-2 shrink-0 translate-y-px rounded-full" style={{ background: roleInfo(role).color }} />
            {roleInfo(role).title}
            <span className="tabular-nums text-muted-foreground">{cards.length}</span>
            {roleInfo(role).hint && <span className={cn('font-normal text-muted-foreground', compact && 'truncate')}>· {roleInfo(role).hint}</span>}
          </h3>
          {cards.map((card) => (
            <CardView
              key={card.ref}
              href={`/o/${ontologyKey}/w/${lensKey}/e/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`}
              card={card}
              selected={card.ref === selected}
              dimmed={evidence > 0 && card.evidence !== true}
              onSelect={onSelect}
              compact={compact}
              aside={aside?.(card)}
              onHover={onHover}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function Waiting({ turn }: { turn: Turn<GraphInsight> }) {
  return (
    <p className="text-xs text-muted-foreground">
      {turn.status === 'pending' ? 'The entities appear here as soon as the question’s anchors are found.' : 'This answer found no entities.'}
    </p>
  )
}

/** One card; selecting it (here, by a citation or in the graph) scrolls it into view. */
function CardView({ card, href, selected, dimmed, onSelect, compact, aside, onHover }: {
  card: EntityCard
  href: string
  selected: boolean
  dimmed: boolean
  onSelect: (ref: string) => void
  compact: boolean
  aside: ReactNode
  onHover?: (ref: string | null) => void
}) {
  const element = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selected) element.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  const fields = compact ? [] : (card.fields ?? []).slice(0, 6)
  return (
    <article
      ref={element}
      onClick={() => onSelect(card.ref)}
      onMouseEnter={onHover && (() => onHover(card.ref))}
      onMouseLeave={onHover && (() => onHover(null))}
      className={cn(
        'rounded-lg border bg-card text-xs transition-[opacity,box-shadow]',
        compact ? 'cursor-pointer px-2.5 py-1.5' : 'px-3 py-2',
        card.evidence && 'border-l-2 border-l-primary',
        dimmed && !selected && 'opacity-60 hover:opacity-100',
        selected && 'ring-2 ring-ring/60',
      )}
    >
      <div className="flex items-center gap-1.5">
        <TypeChip typeKey={card.type} displayName={card.typeName} size="sm" />
        <button
          type="button"
          aria-pressed={selected}
          onClick={(e) => { e.stopPropagation(); onSelect(card.ref) }}
          className="min-w-0 flex-1 truncate rounded-sm text-left text-[13px] font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {card.label}
        </button>
        {aside}
        <Link
          to={href}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${card.label}`}
          title="Open the entity"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{card.ref}</span>
        {card.hop !== undefined && card.hop > 0 && <span>· {card.hop} {card.hop === 1 ? 'hop' : 'hops'} away</span>}
        {card.evidence && <span className="font-medium text-primary">· Evidence</span>}
      </p>
      {card.reason && <p className={cn('mt-1 text-muted-foreground', compact && 'line-clamp-2')}>{card.reason}</p>}
      {fields.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-[11px]">
          {fields.map((field) => (
            <div key={field.name} className="contents">
              <dt className="max-w-32 truncate text-muted-foreground">{field.name}</dt>
              <dd className="truncate" title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
      {(['anchor', 'focus', 'reached'] as const).map((role) => (
        <span key={role} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3.5 rounded-sm border-2" style={{ borderColor: roleInfo(role).color }} />
          {roleInfo(role).title}
        </span>
      ))}
      <span>· bold = evidence, faded = context</span>
    </div>
  )
}

/* ---------------------------------- steps ---------------------------------- */

const STATUS: Record<RunStatus | 'waiting' | 'not-run', { icon: typeof Circle; className: string; text: string }> = {
  running: { icon: LoaderCircle, className: 'animate-spin text-primary', text: 'Running…' },
  done: { icon: CircleCheck, className: 'text-(--tc-emerald)', text: 'Done' },
  skipped: { icon: CircleMinus, className: 'text-muted-foreground', text: 'Skipped' },
  failed: { icon: CircleX, className: 'text-destructive', text: 'Failed' },
  interrupted: { icon: CircleSlash, className: 'text-(--tc-amber)', text: 'Did not finish' },
  waiting: { icon: Circle, className: 'text-muted-foreground/50', text: 'Waiting' },
  'not-run': { icon: CircleDashed, className: 'text-muted-foreground/60', text: 'Not run' },
}

function StatusIcon({ state, className }: { state: keyof typeof STATUS; className?: string }) {
  const { icon: Icon, className: tone, text } = STATUS[state]
  return <Icon aria-label={text} className={cn('shrink-0', tone, className)} />
}

/** The pipeline, top to bottom: each step's live state, what it did per round, and how long it took. */
export function StepList({ turn }: { turn: Turn<GraphInsight> }) {
  const { insight } = turn
  const ended = turn.status !== 'pending'
  // Steps the pipeline does not list (should not happen) still show, after it.
  const listed = insight.graph?.steps ?? []
  const steps: GraphStep[] = [
    ...listed,
    ...[...new Set(insight.steps.map((run) => run.id))].filter((id) => !listed.some((s) => s.id === id))
      .map((id) => ({ id, label: id, description: '' })),
  ]
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">{ended ? 'No steps were reported for this answer.' : 'Waiting for the first step…'}</p>
  }
  const { summary } = insight
  return (
    <div className="space-y-4">
      <ol>
        {steps.map((step, i) => {
          const runs = insight.steps.filter((run) => run.id === step.id)
          const state = stepState(insight, step.id, ended)
          const total = runs.reduce<number | undefined>((sum, run) => (run.durationMs === undefined ? sum : (sum ?? 0) + run.durationMs), undefined)
            ?? summary?.timings?.[step.id]
          const loops = insight.graph?.edges.filter((edge) => edge.from === step.id && edge.to === step.id) ?? []
          return (
            <li key={step.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 pb-4 last:pb-0">
              {i < steps.length - 1 && <span aria-hidden className="absolute top-5 bottom-0.5 left-[7.5px] w-px bg-border" />}
              <StatusIcon state={state} className="mt-0.5 size-4" />
              <div className="min-w-0 space-y-1">
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-[13px] font-medium', (state === 'waiting' || state === 'not-run') && 'text-muted-foreground')}>{step.label}</span>
                  {step.model && (
                    <span className="flex items-center gap-0.5 self-center rounded border px-1 text-[10px] text-muted-foreground" title="This step calls the language model">
                      <Sparkles className="size-2.5" /> model
                    </span>
                  )}
                  {total !== undefined && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{formatDuration(total)}</span>}
                </div>
                {step.description && <p className="text-[11px] text-muted-foreground">{step.description}</p>}
                {runs.map((run) => (
                  <div key={run.round} className={cn('flex items-start gap-1.5 text-xs', run.status === 'running' && 'text-primary')}>
                    {runs.length > 1 && (
                      <span className="mt-px shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground tabular-nums">round {run.round}</span>
                    )}
                    {runs.length > 1 && <StatusIcon state={run.status} className="mt-0.5 size-3" />}
                    <span className="min-w-0 flex-1">{run.summary ?? STATUS[run.status].text}</span>
                    {runs.length > 1 && run.durationMs !== undefined && (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatDuration(run.durationMs)}</span>
                    )}
                  </div>
                ))}
                {loops.map((edge) => (
                  <p key={edge.label ?? 'loop'} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Repeat className="size-3 shrink-0" /> May repeat{edge.label ? `: ${edge.label}` : ''}
                  </p>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      {summary !== null && (
        <dl className="grid grid-cols-4 gap-1.5 border-t pt-3 text-center">
          {([
            ['Model calls', summary.modelCalls?.toString()],
            ['Total', summary.durationMs === undefined ? undefined : formatDuration(summary.durationMs)],
            ['Entities', summary.entities?.toString()],
            ['Evidence', summary.evidence?.toString()],
          ] as const).map(([name, value]) => (
            <div key={name} className="flex flex-col-reverse rounded-md border px-1 py-1.5">
              <dt className="text-[10.5px] text-muted-foreground">{name}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value ?? '–'}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
