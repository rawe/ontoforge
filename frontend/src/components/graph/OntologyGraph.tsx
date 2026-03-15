import { useEffect, useMemo, useState, useCallback } from 'react';
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
import type { Node, Edge, Connection, NodeMouseHandler, EdgeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { EntityType, RelationType } from '../../types/models';
import EntityTypeNode from './EntityTypeNode';
import RelationTypeEdge from './RelationTypeEdge';
import OntologyGraphFilters from './OntologyGraphFilters';
import GraphDetailPanel from './GraphDetailPanel';
import type { GraphSelection } from './GraphDetailPanel';
import { layoutGraph } from './graphLayout';

const nodeTypes = { entityType: EntityTypeNode };
const edgeTypes = { relationType: RelationTypeEdge };

interface Props {
  entityTypes: EntityType[];
  relationTypes: RelationType[];
  propertyCounts: Record<string, number>;
  onAddEntityType?: () => void;
  onAddRelationType?: () => void;
  onConnectNodes?: (sourceEntityTypeKey: string, targetEntityTypeKey: string) => void;
}

export default function OntologyGraph({ entityTypes, relationTypes, propertyCounts, onAddEntityType, onAddRelationType, onConnectNodes }: Props) {
  // Build a map from entityTypeId to key for edge source/target resolution
  const etIdToKey = useMemo(() => {
    const map: Record<string, string> = {};
    entityTypes.forEach((et) => { map[et.entityTypeId] = et.key; });
    return map;
  }, [entityTypes]);

  const etKeyToId = useMemo(() => {
    const map: Record<string, string> = {};
    entityTypes.forEach((et) => { map[et.key] = et.entityTypeId; });
    return map;
  }, [entityTypes]);

  const [visibleEntityTypes, setVisibleEntityTypes] = useState<Set<string>>(
    () => new Set(entityTypes.map((et) => et.entityTypeId)),
  );
  const [visibleRelationTypes, setVisibleRelationTypes] = useState<Set<string>>(
    () => new Set(relationTypes.map((rt) => rt.relationTypeId)),
  );

  // Auto-show newly added types
  useEffect(() => {
    setVisibleEntityTypes((prev) => {
      const next = new Set(prev);
      entityTypes.forEach((et) => { if (!prev.has(et.entityTypeId)) next.add(et.entityTypeId); });
      return next.size === prev.size ? prev : next;
    });
  }, [entityTypes]);

  useEffect(() => {
    setVisibleRelationTypes((prev) => {
      const next = new Set(prev);
      relationTypes.forEach((rt) => { if (!prev.has(rt.relationTypeId)) next.add(rt.relationTypeId); });
      return next.size === prev.size ? prev : next;
    });
  }, [relationTypes]);

  const [selection, setSelection] = useState<GraphSelection | null>(null);

  const clearSelection = useCallback(() => setSelection(null), []);

  const toggleEntityType = useCallback((id: string) => {
    setVisibleEntityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRelationType = useCallback((id: string) => {
    setVisibleRelationTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedNodeId =
    selection?.kind === 'entity' ? selection.entityType.entityTypeId : null;
  const selectedEdgeId =
    selection?.kind === 'relation' ? selection.relationType.relationTypeId : null;

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const filteredNodes: Node[] = entityTypes
      .filter((et) => visibleEntityTypes.has(et.entityTypeId))
      .map((et) => ({
        id: et.entityTypeId,
        type: 'entityType',
        data: {
          entityType: et,
          propertyCount: propertyCounts[et.entityTypeId] ?? 0,
          selected: et.entityTypeId === selectedNodeId,
        },
        position: { x: 0, y: 0 },
      }));

    const filteredEdges: Edge[] = relationTypes
      .filter((rt) => visibleRelationTypes.has(rt.relationTypeId))
      .filter(
        (rt) => {
          const sourceId = etKeyToId[rt.sourceEntityTypeKey];
          const targetId = etKeyToId[rt.targetEntityTypeKey];
          return sourceId && targetId && visibleEntityTypes.has(sourceId) && visibleEntityTypes.has(targetId);
        },
      )
      .map((rt) => ({
        id: rt.relationTypeId,
        source: etKeyToId[rt.sourceEntityTypeKey],
        target: etKeyToId[rt.targetEntityTypeKey],
        type: 'relationType',
        data: {
          relationType: rt,
          selected: rt.relationTypeId === selectedEdgeId,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: rt.relationTypeId === selectedEdgeId ? '#3b82f6' : '#9ca3af',
        },
      }));

    return {
      layoutNodes: layoutGraph(filteredNodes, filteredEdges),
      layoutEdges: filteredEdges,
    };
  }, [entityTypes, relationTypes, propertyCounts, visibleEntityTypes, visibleRelationTypes, selectedNodeId, selectedEdgeId, etKeyToId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useMemo(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const et = entityTypes.find((e) => e.entityTypeId === node.id);
      if (et) {
        setSelection({ kind: 'entity', entityType: et });
      }
    },
    [entityTypes],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const rt = relationTypes.find((r) => r.relationTypeId === edge.id);
      if (rt) {
        setSelection({ kind: 'relation', relationType: rt });
      }
    },
    [relationTypes],
  );

  const onPaneClick = useCallback(() => {
    setSelection(null);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (onConnectNodes && connection.source && connection.target) {
        const sourceKey = etIdToKey[connection.source];
        const targetKey = etIdToKey[connection.target];
        if (sourceKey && targetKey) {
          onConnectNodes(sourceKey, targetKey);
        }
      }
    },
    [onConnectNodes, etIdToKey],
  );

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
      <OntologyGraphFilters
        entityTypes={entityTypes}
        relationTypes={relationTypes}
        visibleEntityTypes={visibleEntityTypes}
        visibleRelationTypes={visibleRelationTypes}
        onToggleEntityType={toggleEntityType}
        onToggleRelationType={toggleRelationType}
        onShowAllEntities={() => setVisibleEntityTypes(new Set(entityTypes.map((et) => et.entityTypeId)))}
        onHideAllEntities={() => setVisibleEntityTypes(new Set())}
        onShowAllRelations={() => setVisibleRelationTypes(new Set(relationTypes.map((rt) => rt.relationTypeId)))}
        onHideAllRelations={() => setVisibleRelationTypes(new Set())}
      />
      <div className="flex-1 flex border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        <div className="flex-1 relative">
          {(onAddEntityType || onAddRelationType) && (
            <div className="absolute top-3 right-3 z-10 flex gap-2">
              {onAddEntityType && (
                <button
                  onClick={onAddEntityType}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/90 backdrop-blur border border-gray-300 rounded-md shadow-sm hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <span className="text-blue-600 text-sm leading-none">+</span> Add Entity Type
                </button>
              )}
              {onAddRelationType && (
                <button
                  onClick={onAddRelationType}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/90 backdrop-blur border border-gray-300 rounded-md shadow-sm hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <span className="text-blue-600 text-sm leading-none">+</span> Add Relation Type
                </button>
              )}
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
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
        </div>
        {selection && (
          <GraphDetailPanel
            selection={selection}
            entityTypes={entityTypes}
            onClose={clearSelection}
          />
        )}
      </div>
    </div>
  );
}
