import type { DataType, EntityInstance, JsonValue, RuntimeSchema, SchemaProperty } from '../../api/types.ts'
import type { Graph3DEdge, Graph3DNode } from '../graph3d/types.ts'
import { formatDocSize, isDocumentStub } from '../../lib/documents.ts'
import type { EntityFlowNode, RelationFlowEdge } from './workingSet.ts'

interface Formatters {
  displayLabel: (entity: EntityInstance) => string
  formatValue: (dataType: DataType, value: JsonValue | undefined) => string | null
}

/** Adapts only the current lens-bounded view; it never reads additional data. */
export function buildExploreGraph3D(
  nodes: readonly EntityFlowNode[],
  edges: readonly RelationFlowEdge[],
  schema: RuntimeSchema,
  { displayLabel, formatValue }: Formatters,
): { nodes: Graph3DNode[]; edges: Graph3DEdge[] } {
  const entityTypes = new Map(schema.entityTypes.map(type => [type.key, type]))
  const relationTypes = new Map(schema.relationTypes.map(type => [type.key, type]))
  const properties = (definitions: readonly SchemaProperty[], values: Record<string, JsonValue | undefined>) => definitions.flatMap(property => {
    const value = values[property.key]
    if (property.dataType === 'document') {
      const length = isDocumentStub(value) ? value.length : typeof value === 'string' ? value.length : null
      return length === null ? [] : [{ label: property.displayName, value: `Document · ${formatDocSize(length)}` }]
    }
    const formatted = formatValue(property.dataType, value)
    return formatted === null ? [] : [{ label: property.displayName, value: formatted }]
  })
  const graphNodes: Graph3DNode[] = nodes.filter(node => !node.hidden).map(node => {
    const entity = node.data.entity
    const type = entityTypes.get(entity._entityTypeKey)
    return {
      id: node.id,
      label: displayLabel(entity),
      typeKey: entity._entityTypeKey,
      subtitle: `${type?.displayName ?? entity._entityTypeKey}${node.data.pinned ? ' · pinned' : ''}`,
      identity: type?.identityProperties?.length ? entity._identity : undefined,
      properties: properties((type?.properties ?? []).filter(property => property.key !== type?.nameProperty), entity),
      highlighted: node.data.highlighted,
      connections: [],
    }
  })
  const visible = new Map(graphNodes.map(node => [node.id, node]))
  const graphEdges: Graph3DEdge[] = edges
    .filter(edge => !edge.hidden && visible.has(edge.source) && visible.has(edge.target))
    .map(edge => {
      const relation = edge.data?.relation
      const type = relationTypes.get(relation?._relationTypeKey ?? '')
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: type?.displayName ?? relation?._relationTypeKey ?? '',
        parent: edge.data?.parent,
        properties: properties(type?.properties ?? [], relation ?? {}),
      }
    })

  // Count visible relation instances per direction/type, not the full neighbourhood.
  // A self-loop participates once in each direction, just as the runtime exposes it.
  const connections = new Map<string, Map<string, { label: string; count: number }>>()
  const count = (nodeId: string, otherId: string, edge: Graph3DEdge, direction: 'Outgoing' | 'Incoming') => {
    const other = visible.get(otherId)!
    const otherType = entityTypes.get(other.typeKey)?.displayName ?? other.typeKey
    const relationKey = edgesById.get(edge.id)?.data?.relation._relationTypeKey ?? edge.label
    const key = JSON.stringify([direction, relationKey, other.typeKey])
    let groups = connections.get(nodeId)
    if (!groups) connections.set(nodeId, groups = new Map())
    const existing = groups.get(key)
    if (existing) existing.count++
    else groups.set(key, { label: `${direction} · ${edge.label} ${direction === 'Outgoing' ? '→' : '←'} ${otherType}`, count: 1 })
  }
  const edgesById = new Map(edges.map(edge => [edge.id, edge]))
  for (const edge of graphEdges) {
    count(edge.source, edge.target, edge, 'Outgoing')
    count(edge.target, edge.source, edge, 'Incoming')
  }
  for (const node of graphNodes) {
    node.connections = [...(connections.get(node.id)?.values() ?? [])].map(({ label, count }) => ({
      label,
      value: `${count} ${count === 1 ? 'relation' : 'relations'}`,
    }))
  }
  return { nodes: graphNodes, edges: graphEdges }
}
