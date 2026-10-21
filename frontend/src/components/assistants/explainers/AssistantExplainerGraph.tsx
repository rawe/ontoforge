import { useId } from 'react'
import { cn } from '@/lib/utils'
import { EXAMPLE, type EntityState, type LinkState, type StoryStep } from './assistantExplainerStories'

const BOX = { width: 112, height: 34 }
const PAD = 12

type Entity = (typeof EXAMPLE.entities)[number]
const ENTITIES = new Map<string, Entity>(EXAMPLE.entities.map((entity) => [entity.id, entity]))

/** A link's path between two entity boxes: straight across columns, an arc within one. */
function linkPath(from: Entity, to: Entity) {
  if (from.x === to.x) {
    const x = from.x + BOX.width / 2
    const bulge = x + 40
    return { d: `M ${x} ${from.y} C ${bulge} ${from.y}, ${bulge} ${to.y}, ${x + 3} ${to.y}`, label: { x: bulge - 6, y: (from.y + to.y) / 2 + 4 } }
  }
  const leftward = to.x < from.x
  const x1 = from.x + (leftward ? -BOX.width / 2 : BOX.width / 2)
  const x2 = to.x + (leftward ? BOX.width / 2 + 3 : -BOX.width / 2 - 3)
  return { d: `M ${x1} ${from.y} L ${x2} ${to.y}`, label: { x: (x1 + x2) / 2, y: (from.y + to.y) / 2 - 5 } }
}

const ENTITY_CLASS: Record<EntityState, { box: string; text: string }> = {
  idle: { box: 'fill-card stroke-border', text: 'fill-foreground/70' },
  dim: { box: 'fill-card stroke-border', text: 'fill-foreground/70' },
  seen: { box: 'fill-card stroke-foreground/35', text: 'fill-foreground' },
  active: { box: 'fill-primary/12 stroke-primary', text: 'fill-foreground' },
  evidence: { box: 'fill-primary/20 stroke-primary', text: 'fill-foreground font-semibold' },
  anchor: { box: 'fill-primary stroke-primary', text: 'fill-primary-foreground font-semibold' },
}

const LINK_CLASS: Record<LinkState, string> = {
  idle: 'stroke-muted-foreground/35',
  dim: 'stroke-muted-foreground/35',
  seen: 'stroke-foreground/45',
  active: 'stroke-primary',
}

/**
 * The example graph at one step of a story: which entities the run has touched, found or
 * kept, which links it followed, and the marks it left — ranks, hops, evidence references.
 * Arrowheads show how a relation is stored; the moving dashes, the way the run follows it.
 */
export function AssistantExplainerGraph({ step }: { step: StoryStep }) {
  const id = useId()
  const entityState = (key: string): EntityState => step.entities[key] ?? (step.fade ? 'dim' : 'idle')
  const linkState = (key: string): LinkState => step.links[key] ?? (step.fade ? 'dim' : 'idle')
  const frame = step.frame && (() => {
    const boxes = step.frame.around.map((key) => ENTITIES.get(key)!)
    const x1 = Math.min(...boxes.map((b) => b.x)) - BOX.width / 2 - PAD
    const x2 = Math.max(...boxes.map((b) => b.x)) + BOX.width / 2 + PAD
    const y1 = Math.min(...boxes.map((b) => b.y)) - BOX.height / 2 - PAD
    const y2 = Math.max(...boxes.map((b) => b.y)) + BOX.height / 2 + PAD
    return { x1, x2, y1, y2 }
  })()

  return <svg viewBox={`0 0 ${EXAMPLE.view.width} ${EXAMPLE.view.height}`} className="block h-auto w-full" role="img"
    aria-label={`Example graph: skills, the projects that require them and the people who work on them. ${step.title}.`}>
    <defs>
      {(['on', 'off'] as const).map((tone) => <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={tone === 'on' ? 'fill-primary' : 'fill-muted-foreground/60'} />
      </marker>)}
    </defs>

    {EXAMPLE.columns.map((column, i) => <g key={column.label}>
      <text x={column.x} y={18} textAnchor="middle" className="fill-muted-foreground text-[11px] font-semibold tracking-wider uppercase">{column.label}</text>
      {step.columns && <text x={column.x} y={34} textAnchor="middle" className="fill-primary text-[11px] font-medium">{step.columns[i]}</text>}
    </g>)}

    {frame && <g>
      <rect x={frame.x1} y={frame.y1} width={frame.x2 - frame.x1} height={frame.y2 - frame.y1} rx={12}
        className="fill-primary/4 stroke-primary/50" strokeDasharray="5 4" strokeWidth={1.25} />
      <text x={frame.x2 - 8} y={frame.y2 + 14} textAnchor="end" className="fill-primary text-[11px] font-medium">{step.frame!.label}</text>
    </g>}

    {EXAMPLE.links.map((link) => {
      const state = linkState(link.id)
      const on = state === 'active'
      const { d, label } = linkPath(ENTITIES.get(link.from)!, ENTITIES.get(link.to)!)
      return <g key={link.id} className={cn('transition-opacity duration-500', state === 'dim' && 'opacity-30')}>
        <path d={d} fill="none" strokeWidth={on ? 2 : 1.25} markerEnd={`url(#${id}-${on ? 'on' : 'off'})`}
          strokeDasharray={on ? '6 4' : undefined} className={cn('transition-[stroke] duration-500', LINK_CLASS[state])}>
          {on && <animate attributeName="stroke-dashoffset" from="0" to="20" dur="0.9s" repeatCount="indefinite" />}
        </path>
        <text x={label.x} y={label.y} textAnchor="middle" strokeWidth={4} paintOrder="stroke"
          className={cn('stroke-card text-[10.5px]', on ? 'fill-primary font-medium' : 'fill-muted-foreground')}>{link.label}</text>
      </g>
    })}

    {EXAMPLE.entities.map((entity) => {
      const state = entityState(entity.id)
      const badge = step.badges?.[entity.id]
      const left = entity.x - BOX.width / 2
      const top = entity.y - BOX.height / 2
      return <g key={entity.id} className={cn('transition-opacity duration-500', state === 'dim' && 'opacity-35')}>
        {state === 'active' && <rect x={left - 4} y={top - 4} width={BOX.width + 8} height={BOX.height + 8} rx={11}
          className="fill-none stroke-primary/40" strokeWidth={3}>
          <animate attributeName="opacity" values="1;0.25;1" dur="1.8s" repeatCount="indefinite" />
        </rect>}
        <rect x={left} y={top} width={BOX.width} height={BOX.height} rx={8} strokeWidth={state === 'idle' || state === 'dim' ? 1 : 1.5}
          className={cn('transition-[fill,stroke] duration-500', ENTITY_CLASS[state].box)} />
        <text x={entity.x} y={entity.y + 4.5} textAnchor="middle"
          className={cn('text-[13px] transition-[fill] duration-500', ENTITY_CLASS[state].text)}>{entity.label}</text>
        {badge && <g>
          <rect x={left - 10} y={top - 9} width={badge.length * 7 + 12} height={18} rx={9}
            className="fill-popover stroke-primary" strokeWidth={1.25} />
          <text x={left - 10 + (badge.length * 7 + 12) / 2} y={top + 4} textAnchor="middle"
            className="fill-primary font-mono text-[10.5px] font-semibold">{badge}</text>
        </g>}
      </g>
    })}
  </svg>
}
