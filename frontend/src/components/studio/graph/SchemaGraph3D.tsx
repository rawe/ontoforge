import { useMemo } from 'react'
import { Crosshair } from 'lucide-react'
import { Graph3D } from '@/components/graph3d/Graph3D'
import type { Graph3DEdge, Graph3DNode } from '@/components/graph3d/types'
import { Button } from '@/components/ui/button'
import { searchSchema } from '../modeling/search'
import { useModelSchema } from '../modeling/useModelSchema'
import { useSchemaWorkspace } from '../schema/workspaceContext'

/** A rendering adapter only; selection and edits stay with the schema workspace. */
export function SchemaGraph3D() {
  const { ontologyKey, selection, select, switchView, search, focusMode, toggleFocus, revealRequest } = useSchemaWorkspace()
  const schema = useModelSchema(ontologyKey)
  const { nodes, edges } = useMemo(() => {
    const matches = searchSchema(schema, search)
    const entities = new Map(schema.entityTypes.map((type) => [type.key, type]))
    const relations = schema.relationTypes.filter((relation) =>
      entities.has(relation.sourceEntityTypeKey) && entities.has(relation.targetEntityTypeKey),
    )
    const focusedKeys = new Set<string>()
    if (selection?.kind === 'entity-types') {
      focusedKeys.add(selection.key)
      for (const relation of relations) {
        if (relation.sourceEntityTypeKey === selection.key || relation.targetEntityTypeKey === selection.key) {
          focusedKeys.add(relation.sourceEntityTypeKey)
          focusedKeys.add(relation.targetEntityTypeKey)
        }
      }
    } else if (selection !== null) {
      const relation = relations.find((type) => type.key === selection.key)
      if (relation !== undefined) {
        focusedKeys.add(relation.sourceEntityTypeKey)
        focusedKeys.add(relation.targetEntityTypeKey)
      }
    }
    const focusActive = focusMode && focusedKeys.size > 0
    const nodes: Graph3DNode[] = schema.entityTypes.map((type) => ({
      id: type.entityTypeId,
      label: type.displayName,
      typeKey: type.key,
      subtitle: `${type.key} · ${(schema.properties[type.entityTypeId] ?? []).length} properties`,
      description: type.description ?? undefined,
      properties: (schema.properties[type.entityTypeId] ?? []).map((property) => ({
        label: property.displayName,
        value: `${property.dataType}${property.required ? ' · required' : ''}${property.key === type.nameProperty ? ' · name' : ''}${type.identityProperties?.includes(property.key) ? ' · identity' : ''}`,
      })),
      highlighted: matches.entityIds.has(type.entityTypeId),
      dimmed: (matches.active && !matches.entityIds.has(type.entityTypeId)) || (focusActive && !focusedKeys.has(type.key)),
    }))
    const edges: Graph3DEdge[] = relations.map((relation) => ({
      id: relation.relationTypeId,
      source: entities.get(relation.sourceEntityTypeKey)!.entityTypeId,
      target: entities.get(relation.targetEntityTypeKey)!.entityTypeId,
      label: relation.displayName,
      description: relation.description ?? undefined,
      properties: (schema.properties[relation.relationTypeId] ?? []).map((property) => ({
        label: property.displayName,
        value: `${property.dataType}${property.required ? ' · required' : ''}`,
      })),
      parent: relation.parent !== null,
      dimmed: (matches.active && !matches.relationIds.has(relation.relationTypeId) &&
        !(matches.entityIds.has(entities.get(relation.sourceEntityTypeKey)!.entityTypeId) && matches.entityIds.has(entities.get(relation.targetEntityTypeKey)!.entityTypeId))) ||
        (focusActive && (selection?.kind === 'relation-types'
          ? relation.key !== selection.key
          : relation.sourceEntityTypeKey !== selection?.key && relation.targetEntityTypeKey !== selection?.key)),
    }))
    return { nodes, edges }
  }, [schema, search, selection, focusMode])
  const selectedNodeId = selection?.kind === 'entity-types'
    ? schema.entityTypes.find((type) => type.key === selection.key)?.entityTypeId ?? null : null
  const selectedEdgeId = selection?.kind === 'relation-types'
    ? schema.relationTypes.find((type) => type.key === selection.key)?.relationTypeId ?? null : null

  return (
    <div className="relative h-full min-h-80">
      <Graph3D
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onSelectNode={(id) => {
          const type = schema.entityTypes.find((entity) => entity.entityTypeId === id)
          select(type === undefined ? null : { kind: 'entity-types', key: type.key })
        }}
        onSelectEdge={(id) => {
          const type = schema.relationTypes.find((relation) => relation.relationTypeId === id)
          if (type !== undefined) select({ kind: 'relation-types', key: type.key })
        }}
        onExit3D={() => switchView('graph')}
        revealRequest={revealRequest?.nonce}
        title="Ontology atlas"
      />
      <div className="absolute left-4 top-20 z-10">
        <Button size="sm" variant={focusMode ? 'default' : 'secondary'} onClick={toggleFocus}>
          <Crosshair className="size-3.5" /> {focusMode ? 'Exit focus' : 'Focus selection'}
        </Button>
      </div>
    </div>
  )
}
