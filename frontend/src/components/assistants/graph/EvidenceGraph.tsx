import { useEffect, useMemo, useRef } from 'react'
import dagre from 'dagre'
import { useTheme } from 'next-themes'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import type { EntityCard, EntityLink } from './graphEvents'
import { roleInfo } from './graphTurnModel'

const NODE_WIDTH = 164
const NODE_HEIGHT = 42

type CardNodeData = { card: EntityCard; selected: boolean; dimmed: boolean }
type CardNode = Node<CardNodeData, 'card'>

/** A card as a node: the role colors its border, evidence is solid and bold, the rest dashed. */
function CardNodeView({ data }: NodeProps<CardNode>) {
  const { card, selected, dimmed } = data
  return (
    <div
      title={`${card.typeName}: ${card.label} · ${card.ref}${card.reason ? `\n${card.reason}` : ''}`}
      className={cn('cursor-pointer rounded-lg bg-card px-2.5 py-1.5', dimmed && 'opacity-55')}
      style={{
        width: NODE_WIDTH,
        border: `${card.evidence ? 2 : 1}px ${card.evidence || !dimmed ? 'solid' : 'dashed'} ${roleInfo(card.role).color}`,
        boxShadow: selected ? '0 0 0 3px color-mix(in oklch, var(--ring) 45%, transparent)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0!" />
      <div className="flex items-center gap-1.5">
        <span className={cn('size-2 shrink-0 rounded-full', getTypeColor(card.type).dot)} aria-hidden />
        <span className={cn('truncate text-[11.5px] text-foreground', card.evidence ? 'font-semibold' : 'font-medium')}>{card.label}</span>
      </div>
      <div className="truncate text-[10px] text-muted-foreground">
        {card.typeName} · <span className="font-mono">{card.ref}</span>
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0!" />
    </div>
  )
}

const nodeTypes = { card: CardNodeView }

/** Readable zoom bounds when the view fits a part of a large graph. */
const FIT = { padding: 0.2, minZoom: 0.6, maxZoom: 1.1 }
/** Up to this many links show their labels; beyond it, only the selected card's do. */
const LABELED_LINKS = 12
/** Up to this many cards the view opens on all of them; beyond it, on the starting points. */
const FIT_ALL = 16

/** Inside the flow: a card selected while it is open is brought into view. */
function FollowSelection({ selected }: { selected: string | null }) {
  const { fitView } = useReactFlow()
  const shown = useRef(selected)
  useEffect(() => {
    if (selected === shown.current) return
    shown.current = selected
    if (selected !== null) void fitView({ ...FIT, nodes: [{ id: selected }], duration: 300 })
  }, [selected, fitView])
  return null
}

type FitOptions = Parameters<ReturnType<typeof useReactFlow>['fitView']>[0]

/** Inside the flow: fits the view again whenever the canvas gets its size
 * or changes it — the panel settles its layout after the flow mounted. */
function FitOnResize({ options }: { options: FitOptions }) {
  const { fitView } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  const initialized = useNodesInitialized()
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  useEffect(() => {
    if (initialized && width > 0 && height > 0) void fitView(latest.current)
  }, [initialized, width, height, fitView])
  return null
}

/** Anchors on the left, each hop a column further right. */
function layout(entities: readonly EntityCard[], links: readonly EntityLink[]) {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 56, marginx: 16, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const card of entities) g.setNode(card.ref, { width: NODE_WIDTH, height: NODE_HEIGHT })
  const known = new Set(entities.map((card) => card.ref))
  const shown = links.filter((link) => known.has(link.from) && known.has(link.to))
  // Dagre ranks along the edges; draw them from the nearer card so a walk reads left to right.
  const hop = (ref: string) => entities.find((card) => card.ref === ref)?.hop ?? 0
  shown.forEach((link, i) => {
    const forward = hop(link.from) <= hop(link.to)
    g.setEdge(forward ? link.from : link.to, forward ? link.to : link.from, {}, String(i))
  })
  dagre.layout(g)
  const positions = new Map(entities.map((card) => {
    const pos = g.node(card.ref)
    return [card.ref, { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }]
  }))
  return { positions, shown }
}

/**
 * A graph kind's cards and links as a read-only node-link view: type dot,
 * role border, evidence emphasized once there is any; clicking a node
 * selects its card. A large graph opens on its starting points (anchors,
 * focus) at a readable zoom; "fit view" shows everything.
 */
export function EvidenceGraph({ entities, links, selected, onSelect }: {
  entities: readonly EntityCard[]
  links: readonly EntityLink[]
  selected: string | null
  onSelect: (ref: string) => void
}) {
  const { resolvedTheme } = useTheme()
  const { positions, shown } = useMemo(() => layout(entities, links), [entities, links])
  const anyEvidence = entities.some((card) => card.evidence === true)
  const nodes = useMemo<CardNode[]>(() => entities.map((card) => ({
    id: card.ref,
    type: 'card',
    position: positions.get(card.ref)!,
    data: { card, selected: card.ref === selected, dimmed: anyEvidence && card.evidence !== true },
  })), [entities, positions, selected, anyEvidence])
  const edges = useMemo<Edge[]>(() => shown.map((link, i) => {
    const touches = selected !== null && (link.from === selected || link.to === selected)
    return {
      id: `${link.from}-${link.type ?? link.label ?? ''}-${link.to}-${i}`,
      source: link.from,
      target: link.to,
      label: touches || shown.length <= LABELED_LINKS ? link.label ?? link.type : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: touches ? 'var(--primary)' : undefined },
      labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' },
      labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
      style: { stroke: touches ? 'var(--primary)' : 'var(--border)', strokeWidth: touches ? 2 : 1.25 },
    }
  }), [shown, selected])
  // Remount when the set of cards changes, so the view fits them again.
  const layoutKey = useMemo(() => entities.map((card) => card.ref).join('|'), [entities])
  const start = entities.length <= FIT_ALL ? []
    : entities.filter((card) => card.role === 'anchor' || card.role === 'focus' || card.ref === selected)
  const fitOptions: FitOptions = start.length > 0
    ? { ...FIT, nodes: start.map((card) => ({ id: card.ref })) }
    : { padding: 0.15, maxZoom: 1.1 }

  return (
    <ReactFlow
      key={layoutKey}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
      fitView
      fitViewOptions={fitOptions}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      style={{ background: 'transparent' }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} fitViewOptions={{ padding: 0.1 }} />
      <FitOnResize options={fitOptions} />
      <FollowSelection selected={selected} />
    </ReactFlow>
  )
}
