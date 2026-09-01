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
import type { EntityType, RelationType } from '@/api/types'
import { getTypeColor } from '@/lib/typeColors'

const NODE_WIDTH = 168
const NODE_HEIGHT = 52

type TypeNodeData = { typeKey: string; displayName: string; entityTypeId: string }
type TypeNode = Node<TypeNodeData, 'schemaType'>

function SchemaTypeNode({ data }: NodeProps<TypeNode>) {
  const color = getTypeColor(data.typeKey)
  return (
    <div
      className="rounded-lg border px-3 py-2"
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
          {data.displayName}
        </span>
      </div>
      <div className="truncate font-mono text-[10px] text-muted-foreground">
        {data.typeKey}
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0!" />
    </div>
  )
}

const nodeTypes = { schemaType: SchemaTypeNode }

function layout(entityTypes: EntityType[], relationTypes: RelationType[]) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const t of entityTypes) {
    g.setNode(t.key, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const r of relationTypes) {
    if (g.hasNode(r.sourceEntityTypeKey) && g.hasNode(r.targetEntityTypeKey)) {
      g.setEdge(r.sourceEntityTypeKey, r.targetEntityTypeKey)
    }
  }
  dagre.layout(g)

  const nodes: TypeNode[] = entityTypes.map((t) => {
    const pos = g.node(t.key)
    return {
      id: t.key,
      type: 'schemaType',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { typeKey: t.key, displayName: t.displayName, entityTypeId: t.entityTypeId },
    }
  })

  const edges: Edge[] = relationTypes
    .filter(
      (r) =>
        entityTypes.some((t) => t.key === r.sourceEntityTypeKey) &&
        entityTypes.some((t) => t.key === r.targetEntityTypeKey),
    )
    .map((r) => ({
      id: r.relationTypeId,
      source: r.sourceEntityTypeKey,
      target: r.targetEntityTypeKey,
      label: r.key,
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

interface SchemaDiagramProps {
  ontologyKey: string
  entityTypes: EntityType[]
  relationTypes: RelationType[]
}

/**
 * Read-only schema graph: entity types as colored nodes, relation types as
 * labeled edges, dagre left-to-right layout. Pan/zoom/drag only; double-click
 * a node to open its editor.
 */
export function SchemaDiagram({ ontologyKey, entityTypes, relationTypes }: SchemaDiagramProps) {
  const { resolvedTheme } = useTheme()
  const navigate = useNavigate()
  const { nodes, edges } = useMemo(
    () => layout(entityTypes, relationTypes),
    [entityTypes, relationTypes],
  )
  // Uncontrolled flow (drag positions live inside React Flow); remount when
  // the schema itself changes so the dagre layout is recomputed.
  const dataKey = useMemo(
    () =>
      entityTypes
        .map((t) => t.entityTypeId)
        .concat(relationTypes.map((r) => r.relationTypeId))
        .join('|'),
    [entityTypes, relationTypes],
  )

  return (
    <div className="h-full min-h-[420px] w-full overflow-hidden rounded-xl border bg-card/40">
      <ReactFlow
        key={dataKey}
        defaultNodes={nodes}
        defaultEdges={edges}
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
        onNodeDoubleClick={(_, node) => {
          void navigate(
            `/o/${ontologyKey}/studio/entity-types/${(node.data as TypeNodeData).entityTypeId}`,
          )
        }}
        style={{ background: 'transparent' }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
