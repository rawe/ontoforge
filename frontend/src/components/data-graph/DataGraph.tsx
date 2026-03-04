import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, NodeMouseHandler, EdgeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { EntityInstance, RelationInstance, RuntimeEntityType, RuntimeRelationType } from '../../types/runtime';
import EntityInstanceNode from './EntityInstanceNode';
import RelationInstanceEdge from './RelationInstanceEdge';
import { layoutDataGraph } from './dataGraphLayout';
import type { DataGraphSelection } from './DataGraphDetailPanel';

const nodeTypes = { entityInstance: EntityInstanceNode };
const edgeTypes = { relationInstance: RelationInstanceEdge };

interface Props {
  entities: Map<string, EntityInstance>;
  relations: Map<string, RelationInstance>;
  entityTypes: RuntimeEntityType[];
  relationTypes: RuntimeRelationType[];
  visibleEntityTypes: Set<string>;
  visibleRelationTypes: Set<string>;
  propertyFilters: Record<string, string>;
  selection: DataGraphSelection | null;
  onSelect: (sel: DataGraphSelection | null) => void;
}

function getDisplayLabel(entity: EntityInstance): string {
  for (const [key, val] of Object.entries(entity)) {
    if (key.startsWith('_')) continue;
    if (key === 'fromEntityId' || key === 'toEntityId') continue;
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return entity._id.slice(0, 12);
}

function matchesPropertyFilters(entity: EntityInstance, filters: Record<string, string>): boolean {
  for (const [key, filterVal] of Object.entries(filters)) {
    if (!filterVal) continue;
    const val = entity[key];
    if (val == null) return false;
    if (!String(val).toLowerCase().includes(filterVal.toLowerCase())) return false;
  }
  return true;
}

export default function DataGraph({
  entities,
  relations,
  entityTypes,
  relationTypes,
  visibleEntityTypes,
  visibleRelationTypes,
  propertyFilters,
  selection,
  onSelect,
}: Props) {
  // Build type color index map
  const typeColorMap = useMemo(() => {
    const map = new Map<string, number>();
    entityTypes.forEach((et, i) => map.set(et.key, i));
    return map;
  }, [entityTypes]);

  // Build type display name maps
  const entityTypeMap = useMemo(() => {
    const map = new Map<string, RuntimeEntityType>();
    entityTypes.forEach((et) => map.set(et.key, et));
    return map;
  }, [entityTypes]);

  const relationTypeMap = useMemo(() => {
    const map = new Map<string, RuntimeRelationType>();
    relationTypes.forEach((rt) => map.set(rt.key, rt));
    return map;
  }, [relationTypes]);

  const selectedNodeId = selection?.kind === 'entity' ? selection.entity._id : null;
  const selectedEdgeId = selection?.kind === 'relation' ? selection.relation._id : null;

  const { layoutNodes, layoutEdges } = useMemo(() => {
    // Filter entities by type visibility and property filters
    const filteredEntities: EntityInstance[] = [];
    const visibleEntityIds = new Set<string>();

    for (const entity of entities.values()) {
      if (!visibleEntityTypes.has(entity._entityTypeKey)) continue;
      if (!matchesPropertyFilters(entity, propertyFilters)) continue;
      filteredEntities.push(entity);
      visibleEntityIds.add(entity._id);
    }

    const filteredNodes: Node[] = filteredEntities.map((entity) => ({
      id: entity._id,
      type: 'entityInstance',
      data: {
        entity,
        label: getDisplayLabel(entity),
        typeDisplayName: entityTypeMap.get(entity._entityTypeKey)?.displayName ?? entity._entityTypeKey,
        colorIndex: typeColorMap.get(entity._entityTypeKey) ?? 0,
        selected: entity._id === selectedNodeId,
      },
      position: { x: 0, y: 0 },
    }));

    // Filter relations by type visibility and endpoint visibility
    const filteredEdges: Edge[] = [];
    for (const relation of relations.values()) {
      if (!visibleRelationTypes.has(relation._relationTypeKey)) continue;
      if (!visibleEntityIds.has(relation.fromEntityId)) continue;
      if (!visibleEntityIds.has(relation.toEntityId)) continue;
      const rt = relationTypeMap.get(relation._relationTypeKey);
      filteredEdges.push({
        id: relation._id,
        source: relation.fromEntityId,
        target: relation.toEntityId,
        type: 'relationInstance',
        data: {
          relationTypeDisplayName: rt?.displayName ?? relation._relationTypeKey,
          selected: relation._id === selectedEdgeId,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: relation._id === selectedEdgeId ? '#3b82f6' : '#9ca3af',
        },
      });
    }

    return {
      layoutNodes: layoutDataGraph(filteredNodes, filteredEdges),
      layoutEdges: filteredEdges,
    };
  }, [entities, relations, visibleEntityTypes, visibleRelationTypes, propertyFilters, entityTypeMap, relationTypeMap, typeColorMap, selectedNodeId, selectedEdgeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Keep in sync when layout recomputes
  useMemo(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const entity = entities.get(node.id);
      if (!entity) return;
      const et = entityTypeMap.get(entity._entityTypeKey);
      if (!et) return;
      onSelect({ kind: 'entity', entity, entityType: et });
    },
    [entities, entityTypeMap, onSelect],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const relation = relations.get(edge.id);
      if (!relation) return;
      const rt = relationTypeMap.get(relation._relationTypeKey);
      if (!rt) return;
      const fromEntity = entities.get(relation.fromEntityId);
      const toEntity = entities.get(relation.toEntityId);
      onSelect({
        kind: 'relation',
        relation,
        relationType: rt,
        fromLabel: fromEntity ? getDisplayLabel(fromEntity) : relation.fromEntityId.slice(0, 12),
        toLabel: toEntity ? getDisplayLabel(toEntity) : relation.toEntityId.slice(0, 12),
      });
    },
    [relations, entities, relationTypeMap, onSelect],
  );

  const onPaneClick = useCallback(() => onSelect(null), [onSelect]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
    >
      <Controls />
      <MiniMap
        nodeStrokeColor="#3b82f6"
        nodeColor="#dbeafe"
        nodeBorderRadius={4}
      />
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d1d5db" />
    </ReactFlow>
  );
}
