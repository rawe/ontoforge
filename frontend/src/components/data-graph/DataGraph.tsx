import { useMemo, useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import type { Node, Edge, NodeMouseHandler, EdgeMouseHandler, NodeChange, EdgeChange, Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { EntityInstance, RelationInstance, RuntimeEntityType, RuntimeRelationType } from '../../types/runtime';
import { getDisplayLabel } from '../../lib/displayLabel';
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
  selection: DataGraphSelection | null;
  onSelect: (sel: DataGraphSelection | null) => void;
  onConnectEntities?: (sourceEntityId: string, targetEntityId: string) => void;
}

export default function DataGraph({
  entities,
  relations,
  entityTypes,
  relationTypes,
  visibleEntityTypes,
  visibleRelationTypes,
  selection,
  onSelect,
  onConnectEntities,
}: Props) {
  // User-dragged position overrides — persists across re-renders
  const positionOverrides = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Local drag state: tracks in-progress drags so nodes move smoothly
  const [dragState, setDragState] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Build type lookup maps
  const typeColorMap = useMemo(() => {
    const map = new Map<string, number>();
    entityTypes.forEach((et, i) => map.set(et.key, i));
    return map;
  }, [entityTypes]);

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

  // Compute layout from data (no selection deps, no drag deps)
  const { layoutNodes, layoutEdges } = useMemo(() => {
    const filteredEntities: EntityInstance[] = [];
    const visibleEntityIds = new Set<string>();

    for (const entity of entities.values()) {
      if (!visibleEntityTypes.has(entity._entityTypeKey)) continue;
      filteredEntities.push(entity);
      visibleEntityIds.add(entity._id);
    }

    const nodes: Node[] = filteredEntities.map((entity) => ({
      id: entity._id,
      type: 'entityInstance',
      data: {
        entity,
        label: getDisplayLabel(entity),
        typeDisplayName: entityTypeMap.get(entity._entityTypeKey)?.displayName ?? entity._entityTypeKey,
        colorIndex: typeColorMap.get(entity._entityTypeKey) ?? 0,
        selected: false,
      },
      position: { x: 0, y: 0 },
    }));

    const edges: Edge[] = [];
    for (const relation of relations.values()) {
      if (!visibleRelationTypes.has(relation._relationTypeKey)) continue;
      if (!visibleEntityIds.has(relation.fromEntityId)) continue;
      if (!visibleEntityIds.has(relation.toEntityId)) continue;
      const rt = relationTypeMap.get(relation._relationTypeKey);
      edges.push({
        id: relation._id,
        source: relation.fromEntityId,
        target: relation.toEntityId,
        type: 'relationInstance',
        data: {
          relationTypeDisplayName: rt?.displayName ?? relation._relationTypeKey,
          selected: false,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
      });
    }

    // Dagre layout, then apply saved position overrides
    const laid = layoutDataGraph(nodes, edges);
    const finalNodes = laid.map((node) => {
      const override = positionOverrides.current.get(node.id);
      return override ? { ...node, position: override } : node;
    });

    return { layoutNodes: finalNodes, layoutEdges: edges };
  }, [entities, relations, visibleEntityTypes, visibleRelationTypes, entityTypeMap, relationTypeMap, typeColorMap]);

  // Apply selection styling + in-progress drag positions
  const selectedNodeId = selection?.kind === 'entity' ? selection.entity._id : null;
  const selectedEdgeId = selection?.kind === 'relation' ? selection.relation._id : null;

  const finalNodes = useMemo(() => {
    return layoutNodes.map((node) => {
      const drag = dragState.get(node.id);
      return {
        ...node,
        position: drag ?? node.position,
        data: { ...node.data, selected: node.id === selectedNodeId },
      };
    });
  }, [layoutNodes, selectedNodeId, dragState]);

  const finalEdges = useMemo(() => {
    return layoutEdges.map((edge) => ({
      ...edge,
      data: { ...edge.data, selected: edge.id === selectedEdgeId },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edge.id === selectedEdgeId ? '#3b82f6' : '#9ca3af',
      },
    }));
  }, [layoutEdges, selectedEdgeId]);

  // Handle node changes (drag)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let newDrag: Map<string, { x: number; y: number }> | null = null;

    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        if (!newDrag) newDrag = new Map(dragState);
        newDrag.set(change.id, { x: change.position.x, y: change.position.y });

        // Drag ended — persist to overrides
        if (!change.dragging) {
          positionOverrides.current.set(change.id, { x: change.position.x, y: change.position.y });
        }
      }
    }

    if (newDrag) setDragState(newDrag);
  }, [dragState]);

  // Handle edge changes (selection etc — we don't need to track these)
  const onEdgesChange = useCallback((_changes: EdgeChange[]) => {
    // No-op: edges are fully controlled from props
  }, []);

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

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target && onConnectEntities) {
        onConnectEntities(connection.source, connection.target);
      }
    },
    [onConnectEntities],
  );

  return (
    <ReactFlow
      nodes={finalNodes}
      edges={finalEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onConnect={handleConnect}
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
