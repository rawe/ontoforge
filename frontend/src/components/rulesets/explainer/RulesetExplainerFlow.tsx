import { useId } from 'react'
import { cn } from '@/lib/utils'
import { FLOW, type FlowEdgeId, type FlowNodeId, type StoryStep } from './rulesetExplainerStory'

const VIEW = { width: 1120, height: 218, lane: 140 }
const STEP = { width: 132, height: 48 }
const IO = { width: 104, height: 36 }

const AT: Record<FlowNodeId, { x: number; y: number }> = {
  client: { x: 90, y: 78 },
  write: { x: 330, y: 40 },
  anchor: { x: 560, y: 40 },
  stage: { x: 330, y: 106 },
  submit: { x: 560, y: 106 },
  review: { x: 730, y: 182 },
  commit: { x: 920, y: 182 },
  data: { x: 1040, y: 78 },
}

/** Each way's path, and where its label sits. */
const ROUTES: Record<FlowEdgeId, { d: string; x: number; y: number; anchor?: 'start' | 'end' }> = {
  'client-write': { d: 'M 142 70 C 200 70, 205 40, 261 40', x: 196, y: 31 },
  'write-anchor': { d: 'M 396 40 L 491 40', x: 0, y: 0 },
  'anchor-data': { d: 'M 626 40 C 850 40, 960 68, 985 74', x: 790, y: 32 },
  'client-stage': { d: 'M 142 86 C 200 86, 205 106, 261 106', x: 196, y: 121 },
  'stage-submit': { d: 'M 396 106 L 491 106', x: 0, y: 0 },
  'submit-review': { d: 'M 600 130 C 615 165, 630 182, 661 182', x: 619, y: 175, anchor: 'end' },
  'review-commit': { d: 'M 796 182 L 851 182', x: 0, y: 0 },
  'commit-data': { d: 'M 986 182 C 1030 182, 1040 140, 1040 99', x: 1030, y: 148, anchor: 'end' },
}

/** A lit node or edge waits for the ones before it on the step's way: the way lights in sequence. */
const delay = (order: number) => ({ transitionDelay: order > 0 ? `${order * 150}ms` : undefined })

/**
 * The way of a client's write through a ruleset's URL: at once, past the anchor — or
 * staged and submitted, then committed by a person. Each client edge names the write access
 * levels that open it. The client's lane above, the person's below; the step's way lit,
 * where it stops marked refused.
 */
export function RulesetExplainerFlow({ step }: { step: StoryStep }) {
  const id = useId()
  const escapes = step.rule === 'escapes'
  return <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="mx-auto block h-auto w-full max-w-[1120px]" role="img"
    aria-label="A client's write through a ruleset's URL: with write access full written at once past the anchor, or, with propose or full, staged and submitted, then reviewed and committed by a person">
    <defs>
      {(['on', 'off'] as const).map((tone) => <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={tone === 'on' ? 'fill-primary' : 'fill-muted-foreground/50'} />
      </marker>)}
    </defs>

    <rect x={0} y={0} width={VIEW.width} height={VIEW.lane - 3} rx={12} className="fill-muted/45" />
    <rect x={0} y={VIEW.lane + 3} width={VIEW.width} height={VIEW.height - VIEW.lane - 3} rx={12} className="fill-muted/45" />
    <text x={18} y={24} className="fill-foreground text-[11px] font-semibold tracking-wider uppercase">Client</text>
    <text x={18} y={39} className="fill-muted-foreground text-[11px]">on the ruleset’s URL</text>
    <text x={18} y={VIEW.lane + 25} className="fill-foreground text-[11px] font-semibold tracking-wider uppercase">Person</text>
    <text x={18} y={VIEW.lane + 40} className={cn('text-[11px]', escapes ? 'fill-primary font-semibold' : 'fill-muted-foreground')}>in the Workbench · plain lens URL</text>

    {FLOW.edges.map((edge) => {
      const order = step.edges.indexOf(edge.id)
      const on = order >= 0
      const route = ROUTES[edge.id]
      return <g key={edge.id}>
        <path d={route.d} fill="none" strokeWidth={on ? 2 : 1.25} markerEnd={`url(#${id}-${on ? 'on' : 'off'})`}
          strokeDasharray={on ? '6 4' : undefined} style={delay(order)}
          className={cn('transition-[stroke] duration-500', on ? 'stroke-primary' : 'stroke-muted-foreground/45')}>
          {on && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.9s" repeatCount="indefinite" />}
        </path>
        {edge.label && <text x={route.x} y={route.y} textAnchor={route.anchor ?? 'middle'} style={delay(order)}
          className={cn('text-[11px] transition-[fill] duration-500', on ? 'fill-primary font-medium' : 'fill-muted-foreground')}>{edge.label}</text>}
      </g>
    })}

    {FLOW.nodes.map((node) => {
      const { x, y } = AT[node.id]
      const io = node.role === 'io'
      const { width, height } = io ? IO : STEP
      const refused = step.refused?.includes(node.id) ?? false
      const order = step.nodes.indexOf(node.id)
      const on = order >= 0
      const passes = node.id === 'anchor' && step.anchor !== 'found' && step.anchor !== 'deleted' && !refused
      return <g key={node.id} className={cn('transition-opacity duration-500', !on && !io && 'opacity-60')} style={delay(order)}>
        {on && !io && <rect x={x - width / 2 - 5} y={y - height / 2 - 5} width={width + 10} height={height + 10} rx={13}
          className={cn('fill-none', refused ? 'stroke-destructive/30' : 'stroke-primary/30')} strokeWidth={4} />}
        <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx={io ? height / 2 : 9}
          strokeWidth={on ? 2 : 1.25} strokeDasharray={passes ? '5 4' : undefined} style={delay(order)}
          className={cn('transition-[fill,stroke] duration-500',
            io ? (on ? 'fill-muted stroke-foreground/35' : 'fill-muted stroke-border')
              : refused ? 'fill-destructive/10 stroke-destructive' : on ? 'fill-primary/12 stroke-primary' : 'fill-card stroke-border')} />
        <text x={x} y={io ? y + 4 : y - 2} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{node.label}</text>
        {!io && <text x={x} y={y + 14} textAnchor="middle" className={cn('text-[10.5px]', refused ? 'fill-destructive' : 'fill-muted-foreground')}>
          {refused ? 'refused' : passes ? 'no anchor: passes' : node.sub}
        </text>}
      </g>
    })}
  </svg>
}
