import { lazy, Suspense, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useDisplayLabel } from '@/api/hooks'
import type { RuntimeSchema } from '@/api/types'
import type { Graph3DProps } from '@/components/graph3d/types'
import { formatValue } from '@/components/schema/propertyDraft'
import type { EntityFlowNode, RelationFlowEdge } from './workingSet'
import { buildExploreGraph3D } from './graph3dModel'

const Graph3D = lazy(() => import('@/components/graph3d/Graph3D').then((module) => ({ default: module.Graph3D })))

interface ExploreGraph3DProps extends Omit<Graph3DProps, 'nodes' | 'edges'> {
  nodes: readonly EntityFlowNode[]
  edges: readonly RelationFlowEdge[]
  schema: RuntimeSchema
}

/** The same lens-bounded working set, rendered in space; this adapter performs no reads. */
export function ExploreGraph3D({ nodes, edges, schema, ...props }: ExploreGraph3DProps) {
  const displayLabel = useDisplayLabel()
  const graph = useMemo(() => buildExploreGraph3D(nodes, edges, schema, { displayLabel, formatValue }), [nodes, edges, schema, displayLabel])

  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-[#070b18] text-slate-300"><Loader2 className="mr-2 size-4 animate-spin" /> Opening 3D explorer…</div>}>
      <Graph3D {...props} nodes={graph.nodes} edges={graph.edges} />
    </Suspense>
  )
}
