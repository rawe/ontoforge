import { useMemo } from 'react'
import dagre from 'dagre'
import { useTheme } from 'next-themes'
import { useNavigate } from 'react-router-dom'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Waypoints } from 'lucide-react'
import type { EntityInstance } from '@/api/types'
import { displayLabel } from '@/lib/displayLabel'
import { getTypeColor } from '@/lib/typeColors'
import type { DerivedEdge } from './resultUtils'

const NODE_WIDTH = 176
const NODE_HEIGHT = 52

type ResultNodeData = { entity: EntityInstance; ontologyKey: string; lensKey: string }
type ResultNode = Node<ResultNodeData, 'resultEntity'>

function ResultEntityNode({ data }: NodeProps<ResultNode>) {
  const navigate = useNavigate()
  const { entity, ontologyKey, lensKey } = data
  const color = getTypeColor(entity._entityTypeKey)
  return (
    <div
      className="group rounded-lg border px-3 py-2"
      style={{
        width: NODE_WIDTH,
        background: 'var(--card)',
        borderColor: color.borderVar,
        boxShadow: `inset 3px 0 0 ${color.cssVar}`,
      }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0!" />
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color.cssVar }} />
        <span className="truncate text-[12px] font-medium text-foreground">
          {displayLabel(entity)}
        </span>
        <button
          type="button"
          title="Open in Explorer"
          aria-label={`Open ${displayLabel(entity)} in Explorer`}
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            void navigate(
              `/o/${ontologyKey}/w/${lensKey}/explore?focus=${entity._entityTypeKey}:${entity._id}`,
            )
          }}
        >
          <Waypoints className="size-3.5" />
        </button>
      </div>
      <div className="truncate font-mono text-[10px] text-muted-foreground">
        {entity._entityTypeKey}
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0!" />
    </div>
  )
}

const nodeTypes = { resultEntity: ResultEntityNode }

function layout(
  entities: EntityInstance[],
  derivedEdges: DerivedEdge[],
  ontologyKey: string,
  lensKey: string,
) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const e of entities) g.setNode(e._id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const edge of derivedEdges) g.setEdge(edge.sourceEntityId, edge.targetEntityId)
  dagre.layout(g)

  const nodes: ResultNode[] = entities.map((entity) => {
    const pos = g.node(entity._id)
    return {
      id: entity._id,
      type: 'resultEntity',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { entity, ontologyKey, lensKey },
    }
  })

  const edges: Edge[] = derivedEdges.map((edge) => ({
    id: edge.id,
    source: edge.sourceEntityId,
    target: edge.targetEntityId,
    label: edge.relationTypeKey,
    type: 'default',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    labelStyle: {
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      fill: 'var(--muted-foreground)',
    },
    labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.85 },
    style: { stroke: 'var(--border)', strokeWidth: 1.5 },
  }))

  return { nodes, edges }
}

interface ResultsGraphProps {
  ontologyKey: string
  lensKey: string
  entities: EntityInstance[]
  edges: DerivedEdge[]
}

/**
 * Read-only mini graph of a result set: unique result entities as
 * type-colored nodes (dagre layout), derivable relations as labeled edges.
 * Each node offers "Open in Explorer".
 */
export function ResultsGraph({ ontologyKey, lensKey, entities, edges }: ResultsGraphProps) {
  const { resolvedTheme } = useTheme()
  const graph = useMemo(
    () => layout(entities, edges, ontologyKey, lensKey),
    [entities, edges, ontologyKey, lensKey],
  )
  const dataKey = useMemo(
    () => entities.map((e) => e._id).concat(edges.map((e) => e.id)).join('|'),
    [entities, edges],
  )

  return (
    <div className="h-[26rem] w-full overflow-hidden rounded-xl border bg-card/40">
      <ReactFlow
        key={dataKey}
        defaultNodes={graph.nodes}
        defaultEdges={graph.edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        fitView
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        style={{ background: 'transparent' }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
