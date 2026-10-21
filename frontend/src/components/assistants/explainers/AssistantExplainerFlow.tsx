import { useId } from 'react'
import { cn } from '@/lib/utils'
import { FLOW_VIEW, type Explainer, type FlowEdge, type FlowNode } from './assistantExplainerStories'

const size = (node: FlowNode) => (node.role === 'io' ? FLOW_VIEW.io : FLOW_VIEW.node)

/** The path of one flow edge between its nodes, and where its label sits. */
function route(edge: FlowEdge, from: FlowNode, to: FlowNode) {
  const a = size(from)
  const b = size(to)
  if (edge.from === edge.to) {
    const bottom = from.y + a.height / 2
    return { d: `M ${from.x + 26} ${bottom} C ${from.x + 34} ${bottom + 44}, ${from.x - 34} ${bottom + 44}, ${from.x - 26} ${bottom + 3}`, label: { x: from.x, y: bottom + 50, anchor: 'middle' as const } }
  }
  if (edge.bend) {
    const x = from.x + (edge.bend === 'left' ? -30 : 30)
    const down = to.y > from.y
    const y1 = from.y + (down ? a.height / 2 : -a.height / 2)
    const y2 = to.y + (down ? -b.height / 2 - 3 : b.height / 2 + 3)
    return { d: `M ${x} ${y1} L ${x} ${y2}`, label: { x: x + (edge.bend === 'left' ? -8 : 8), y: (y1 + y2) / 2 + 4, anchor: edge.bend === 'left' ? 'end' as const : 'start' as const } }
  }
  const x1 = from.x + a.width / 2
  const x2 = to.x - b.width / 2 - 3
  return { d: `M ${x1} ${from.y} L ${x2} ${to.y}`, label: { x: (x1 + x2) / 2, y: from.y - 8, anchor: 'middle' as const } }
}

/** A small sparkle marking a step that calls the language model. */
function ModelMark({ x, y }: { x: number; y: number }) {
  return <path transform={`translate(${x} ${y}) scale(0.55)`} className="fill-primary"
    d="M12 2 L13.9 9.1 L21 11 L13.9 12.9 L12 20 L10.1 12.9 L3 11 L10.1 9.1 Z" />
}

/**
 * The steps of one run of an assistant kind as a flow: model calls tinted, steps that only
 * read the lens plain, a loop framed, the current step ringed and the way the run took lit.
 */
export function AssistantExplainerFlow({ explainer, current, passed, lit, onSelect }: {
  explainer: Explainer
  current: string
  passed: Set<string>
  lit: string[]
  onSelect: (node: string) => void
}) {
  const id = useId()
  const nodes = new Map(explainer.flow.nodes.map((node) => [node.id, node]))
  const inStory = new Set(explainer.story.map((step) => step.node))
  const { loop } = explainer.flow
  const looped = loop?.around.map((key) => nodes.get(key)!)
  const frame = looped && {
    x1: Math.min(...looped.map((n) => n.x - size(n).width / 2)) - 190,
    x2: Math.max(...looped.map((n) => n.x + size(n).width / 2)) + 40,
    y1: Math.min(...looped.map((n) => n.y - size(n).height / 2)) - 12,
    y2: Math.max(...looped.map((n) => n.y + size(n).height / 2)) + 12,
  }
  return <svg viewBox={`0 0 ${FLOW_VIEW.width} ${explainer.flow.height ?? FLOW_VIEW.height}`} className="block h-auto w-full" role="img"
    aria-label={`The steps of a run: ${explainer.flow.nodes.map((node) => node.label).join(', ')}`}>
    <defs>
      {(['on', 'off'] as const).map((tone) => <marker key={tone} id={`${id}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className={tone === 'on' ? 'fill-primary' : 'fill-muted-foreground/50'} />
      </marker>)}
    </defs>

    {loop && frame && <g>
      <rect x={frame.x1} y={frame.y1} width={frame.x2 - frame.x1} height={frame.y2 - frame.y1} rx={14}
        className="fill-primary/4 stroke-primary/40" strokeDasharray="5 4" strokeWidth={1.25} />
      {loop.lines.map((line, i) => <text key={line} x={frame.x1 + 18} y={(frame.y1 + frame.y2) / 2 - 14 + i * 17}
        className={i === 0 ? 'fill-primary text-[13px] font-semibold' : 'fill-muted-foreground text-[11.5px]'}>{line}</text>)}
    </g>}

    {explainer.flow.edges.map((edge) => {
      const on = lit.includes(edge.id)
      const { d, label } = route(edge, nodes.get(edge.from)!, nodes.get(edge.to)!)
      return <g key={edge.id}>
        <path d={d} fill="none" strokeWidth={on ? 2 : 1.25} markerEnd={`url(#${id}-${on ? 'on' : 'off'})`}
          strokeDasharray={on ? '6 4' : undefined}
          className={cn('transition-[stroke] duration-500', on ? 'stroke-primary' : 'stroke-muted-foreground/40')}>
          {on && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.9s" repeatCount="indefinite" />}
        </path>
        {edge.label && <text x={label.x} y={label.y} textAnchor={label.anchor}
          className={cn('text-[11px] transition-[fill] duration-500', on ? 'fill-primary' : 'fill-muted-foreground')}>{edge.label}</text>}
      </g>
    })}

    {explainer.flow.nodes.map((node) => {
      const { width, height } = size(node)
      const active = node.id === current
      const done = passed.has(node.id) && !active
      const model = node.role === 'model'
      const io = node.role === 'io'
      const clickable = inStory.has(node.id) && !active
      return <g key={node.id} onClick={clickable ? () => onSelect(node.id) : undefined}
        className={cn('transition-opacity duration-500', clickable && 'cursor-pointer', !active && !done && !io && 'opacity-60')}>
        {active && <rect x={node.x - width / 2 - 5} y={node.y - height / 2 - 5} width={width + 10} height={height + 10} rx={13}
          className="fill-none stroke-primary/30" strokeWidth={4} />}
        <rect x={node.x - width / 2} y={node.y - height / 2} width={width} height={height} rx={io ? height / 2 : 9}
          strokeWidth={active ? 2 : 1.25}
          className={cn('transition-[fill,stroke] duration-500',
            io ? (done || active ? 'fill-muted stroke-foreground/30' : 'fill-muted stroke-border')
              : model ? (active ? 'fill-primary/15 stroke-primary' : 'fill-primary/8 stroke-primary/45')
                : active ? 'fill-card stroke-primary' : done ? 'fill-card stroke-foreground/35' : 'fill-card stroke-border')} />
        {model && <ModelMark x={node.x - width / 2 + 7} y={node.y - height / 2 + 6} />}
        <text x={node.x} y={io ? node.y + 4 : node.y - 2} textAnchor="middle"
          className={cn('text-[13px] font-semibold', io && !done && !active ? 'fill-muted-foreground' : 'fill-foreground')}>{node.label}</text>
        {node.sub && <text x={node.x} y={node.y + 14} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">{node.sub}</text>}
        {clickable && <title>{`Jump to “${node.label}”`}</title>}
      </g>
    })}
  </svg>
}
