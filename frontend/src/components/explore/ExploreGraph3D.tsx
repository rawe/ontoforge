import { lazy, Suspense, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useDisplayLabel } from '@/api/hooks'
import type { RuntimeSchema } from '@/api/types'
import type { Graph3DEdge, Graph3DNode, Graph3DProps } from '@/components/graph3d/types'
import { formatValue } from '@/components/schema/propertyDraft'
import { formatDocSize, isDocumentStub } from '@/lib/documents'
import type { EntityFlowNode, RelationFlowEdge } from './workingSet'

const Graph3D = lazy(() => import('@/components/graph3d/Graph3D').then((module) => ({ default: module.Graph3D })))

interface ExploreGraph3DProps extends Omit<Graph3DProps, 'nodes' | 'edges'> {
  nodes: readonly EntityFlowNode[]
  edges: readonly RelationFlowEdge[]
  schema: RuntimeSchema
}

/** The same lens-bounded working set, rendered in space; this adapter performs no reads. */
export function ExploreGraph3D({ nodes, edges, schema, ...props }: ExploreGraph3DProps) {
  const displayLabel = useDisplayLabel()
  const graphNodes = useMemo<Graph3DNode[]>(() => nodes.filter((node) => !node.hidden).map((node) => {
    const entity = node.data.entity
    const type = schema.entityTypes.find((candidate) => candidate.key === entity._entityTypeKey)
    const properties = (type?.properties ?? []).flatMap((property) => {
      const value = entity[property.key]
      if (property.dataType === 'document') {
        return isDocumentStub(value)
          ? [{ label: property.displayName, value: `Document · ${formatDocSize(value.length)}` }]
          : []
      }
      const formatted = formatValue(property.dataType, value)
      return formatted === null ? [] : [{ label: property.displayName, value: formatted }]
    }).slice(0, 6)
    return {
      id: node.id,
      label: displayLabel(entity),
      typeKey: entity._entityTypeKey,
      subtitle: `${type?.displayName ?? entity._entityTypeKey}${node.data.pinned ? ' · pinned' : ''}`,
      description: type?.description ?? undefined,
      properties,
      highlighted: node.data.highlighted,
    }
  }), [nodes, schema, displayLabel])
  const graphEdges = useMemo<Graph3DEdge[]>(() => {
    const visible = new Set(graphNodes.map((node) => node.id))
    return edges.filter((edge) => !edge.hidden && visible.has(edge.source) && visible.has(edge.target)).map((edge) => {
      const relationType = schema.relationTypes.find((type) => type.key === edge.data?.relation._relationTypeKey)
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: relationType?.displayName ?? edge.data?.relation._relationTypeKey ?? '',
        parent: edge.data?.parent,
        description: relationType?.description ?? undefined,
        properties: (relationType?.properties ?? []).flatMap((property) => {
          const value = formatValue(property.dataType, edge.data?.relation[property.key])
          return value === null ? [] : [{ label: property.displayName, value }]
        }),
      }
    })
  }, [edges, graphNodes, schema])

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-[#070b18] text-slate-300"><Loader2 className="mr-2 size-4 animate-spin" /> Opening 3D explorer…</div>}>
      <Graph3D {...props} nodes={graphNodes} edges={graphEdges} />
    </Suspense>
  )
}
