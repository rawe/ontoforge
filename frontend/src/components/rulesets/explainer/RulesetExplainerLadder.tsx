import { cn } from '@/lib/utils'
import { WriteAccessChip } from '../WriteAccessChip'
import { ladder, type StoryStep } from './rulesetExplainerStory'

/** Each step's height in px, rising left to right; the marker sits above the current one. */
const HEIGHTS = [64, 88, 112]
const MARKER = 22

/**
 * Write access as a staircase: none low, propose in the middle, full high, each step with
 * what it adds. The current level is solid; the levels above it are dashed, their verbs
 * struck through: what the client cannot do. A marker slides to the current level; a step
 * with no level shows the stairs dashed, without a marker.
 */
export function RulesetExplainerLadder({ step }: { step: StoryStep }) {
  const steps = ladder(step.writeAccess)
  const at = steps.findIndex((s) => s.place === 'current')
  const top = MARKER + HEIGHTS[HEIGHTS.length - 1]

  return <div className="relative" style={{ height: top }} role="img"
    aria-label={step.writeAccess ? `Write access ${step.writeAccess}: ${steps.filter((s) => s.place !== 'above').map((s) => s.adds).join(' ')}` : 'Write access: no level'}>
    {at >= 0 && <div className="absolute top-0 left-0 flex w-1/3 flex-col items-center text-[10px] font-semibold text-primary transition-transform duration-500"
      style={{ transform: `translate(${at * 100}%, ${top - HEIGHTS[at] - MARKER}px)` }}>
      current
      <span className="size-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-primary" />
    </div>}
    <ol className="absolute inset-x-0 bottom-0 grid grid-cols-3 items-end">
      {steps.map((s, i) => <li key={s.level} className="px-1">
        <div style={{ height: HEIGHTS[i] }}
          className={cn('flex flex-col items-center gap-1.5 rounded-lg border px-1.5 pt-2 text-center transition-[background-color,border-color,opacity] duration-500',
            s.place === 'current' ? 'border-primary bg-primary/12'
              : s.place === 'above' ? 'border-dashed border-foreground/30 bg-card opacity-50'
                : s.place === 'unset' ? 'border-dashed border-foreground/30 bg-card' : 'border-border bg-card')}>
          <WriteAccessChip level={s.level} />
          <span className={cn('text-[11px] leading-tight text-muted-foreground', s.place === 'above' && 'line-through')}>{s.adds}</span>
        </div>
      </li>)}
    </ol>
  </div>
}
