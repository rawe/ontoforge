import { useId } from 'react'
import { cn } from '@/lib/utils'
import { FLOW, STORY, type FlowEdgeId, type FlowNodeId } from './changesetExplainerStory'

const VIEW = { width: 1120, height: 330, lane: 165 }
const STATE = { width: 140, height: 52 }
const END = { width: 96, height: 34 }

const AT: Record<FlowNodeId, { x: number; y: number }> = {
  start: { x: 150, y: 70 },
  discarded: { x: 150, y: 140 },
  expired: { x: 150, y: 200 },
  draft: { x: 430, y: VIEW.lane },
  submitted: { x: 700, y: VIEW.lane },
  committed: { x: 970, y: VIEW.lane },
}

/** Each way's path, and where its name (and who may take it, below) sits. */
const ROUTES: Record<FlowEdgeId, { d: string; x: number; y: number }> = {
  start: { d: 'M 198 70 C 300 70, 380 92, 393 136', x: 290, y: 50 },
  stage: { d: 'M 405 139 C 392 82, 468 82, 455 136', x: 430, y: 64 },
  submit: { d: 'M 485 139 C 525 72, 610 72, 648 136', x: 566, y: 64 },
  unsubmit: { d: 'M 662 191 C 630 268, 500 268, 470 194', x: 566, y: 216 },
  commit: { d: 'M 740 191 C 770 268, 905 268, 932 194', x: 836, y: 216 },
  'commit-draft': { d: 'M 400 191 C 425 340, 975 340, 1000 194', x: 700, y: 270 },
  discard: { d: 'M 358 156 L 202 141', x: 282, y: 124 },
  expire: { d: 'M 358 176 L 202 199', x: 282, y: 214 },
}

/**
 * The changeset workflow: the client's lane above the states, the person's below, every
 * way between them named with who may take it — the current step ringed, its ways lit.
 */
export function ChangesetExplainerFlow({ current, passed, lit, onSelect, motion }: {
  current: FlowNodeId
  passed: Set<FlowNodeId>
  lit: FlowEdgeId[]
  onSelect: (index: number) => void
  motion: boolean
}) {
  const id = useId()
  const stepOf = (edge: FlowEdgeId) => STORY.findIndex((step) => step.edges.includes(edge))
  return <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="block h-auto w-full" role="img"
    aria-label={`The changeset workflow: ${FLOW.edges.map((edge) => `${edge.label}, ${edge.who}`).join('; ')}`}>
    <defs>
      {(['on', 'off'] as const).map((tone) => <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={tone === 'on' ? 'fill-primary' : 'fill-muted-foreground/50'} />
      </marker>)}
    </defs>

    <rect x={0} y={0} width={VIEW.width} height={VIEW.lane - 2} rx={12} className="fill-muted/45" />
    <rect x={0} y={VIEW.lane + 2} width={VIEW.width} height={VIEW.height - VIEW.lane - 2} rx={12} className="fill-muted/45" />
    <text x={18} y={26} className="fill-foreground text-[11px] font-semibold tracking-wider uppercase">Client</text>
    <text x={18} y={41} className="fill-muted-foreground text-[11px]">proposes · REST or MCP</text>
    <text x={18} y={VIEW.height - 28} className="fill-foreground text-[11px] font-semibold tracking-wider uppercase">Person</text>
    <text x={18} y={VIEW.height - 13} className="fill-muted-foreground text-[11px]">decides · in the Workbench</text>

    {FLOW.edges.map((edge) => {
      const on = lit.includes(edge.id)
      const route = ROUTES[edge.id]
      const step = stepOf(edge.id)
      const clickable = step >= 0 && !on
      return <g key={edge.id} onClick={clickable ? () => onSelect(step) : undefined} className={cn(clickable && 'cursor-pointer')}>
        <path d={route.d} fill="none" strokeWidth={on ? 2 : 1.25} markerEnd={`url(#${id}-${on ? 'on' : 'off'})`}
          strokeDasharray={on ? '6 4' : edge.id === 'expire' ? '3 3' : undefined}
          className={cn('transition-[stroke] duration-500', on ? 'stroke-primary' : 'stroke-muted-foreground/45')}>
          {on && motion && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.9s" repeatCount="indefinite" />}
        </path>
        <text x={route.x} y={route.y} textAnchor="middle"
          className={cn('text-[12px] font-semibold transition-[fill] duration-500', on ? 'fill-primary' : 'fill-foreground/80')}>{edge.label}</text>
        <text x={route.x} y={route.y + 14} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{edge.who}</text>
        {clickable && <title>{`Jump to “${STORY[step].title}”`}</title>}
      </g>
    })}

    {FLOW.nodes.map((node) => {
      const { x, y } = AT[node.id]
      const end = node.role === 'end'
      const { width, height } = end ? END : STATE
      const active = node.id === current
      const done = passed.has(node.id) && !active
      const step = STORY.findIndex((s) => s.node === node.id)
      const clickable = step >= 0 && !active
      return <g key={node.id} onClick={clickable ? () => onSelect(step) : undefined}
        className={cn('transition-opacity duration-500', clickable && 'cursor-pointer')}>
        {active && <rect x={x - width / 2 - 5} y={y - height / 2 - 5} width={width + 10} height={height + 10} rx={13}
          className="fill-none stroke-primary/30" strokeWidth={4} />}
        <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx={end ? height / 2 : 9}
          strokeWidth={active ? 2 : 1.25}
          className={cn('transition-[fill,stroke] duration-500',
            end ? 'fill-muted stroke-border'
              : active ? 'fill-primary/12 stroke-primary' : done ? 'fill-card stroke-foreground/35' : 'fill-card stroke-border')} />
        <text x={x} y={end ? y + 4 : y - 2} textAnchor="middle"
          className={cn('text-[13px] font-semibold', end ? 'fill-muted-foreground' : 'fill-foreground')}>{node.label}</text>
        {node.sub && <text x={x} y={y + 14} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{node.sub}</text>}
        {clickable && <title>{`Jump to “${STORY[step].title}”`}</title>}
      </g>
    })}
  </svg>
}
