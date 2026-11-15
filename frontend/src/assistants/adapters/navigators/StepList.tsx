import { Circle, CircleCheck, CircleDashed, CircleMinus, CircleSlash, CircleX, LoaderCircle, Repeat } from 'lucide-react'
import type { GraphStep } from '@/api/graphEvents'
import { stepState, type GraphInsight, type RunStatus } from '@/components/assistants/graph/graphTurnModel'
import { cn } from '@/lib/utils'
import type { Turn } from '../../conversation/chatModel'

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

/** The pipeline, top to bottom: each step's live state and what it did per round. */
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
  return (
    <ol>
      {steps.map((step, i) => {
        const runs = insight.steps.filter((run) => run.id === step.id)
        const state = stepState(insight, step.id, ended)
        const loops = insight.graph?.edges.filter((edge) => edge.from === step.id && edge.to === step.id) ?? []
        return (
          <li key={step.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 pb-4 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className="absolute top-5 bottom-0.5 left-[7.5px] w-px bg-border" />}
            <StatusIcon state={state} className="mt-0.5 size-4" />
            <div className="min-w-0 space-y-1">
              <span className={cn('block text-[13px] font-medium', (state === 'waiting' || state === 'not-run') && 'text-muted-foreground')}>{step.label}</span>
              {step.description && <p className="text-[11px] text-muted-foreground">{step.description}</p>}
              {runs.map((run) => (
                <div key={run.round} className={cn('flex items-start gap-1.5 text-xs', run.status === 'running' && 'text-primary')}>
                  {runs.length > 1 && (
                    <span className="mt-px shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground tabular-nums">round {run.round}</span>
                  )}
                  {runs.length > 1 && <StatusIcon state={run.status} className="mt-0.5 size-3" />}
                  <span className="min-w-0 flex-1">{run.summary ?? STATUS[run.status].text}</span>
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
  )
}
