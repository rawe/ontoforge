import {
  Circle, CircleCheck, CircleDashed, CircleMinus, CircleSlash, CircleX, LoaderCircle, Repeat, Sparkles,
} from 'lucide-react'
import type { GraphStep } from '@/api/graphEvents'
import { stepState, type GraphInsight, type RunStatus } from '@/components/assistants/graph/graphTurnModel'
import { cn } from '@/lib/utils'
import { formatDuration, type Turn } from '../../conversation/chatModel'

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
