import { useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

import type { EntityType, RelationType } from '../../types/models';
import EntityTypeNode from './EntityTypeNode';
import RelationTypeEdge from './RelationTypeEdge';
import OntologyGraphFilters from './OntologyGraphFilters';
import { layoutGraph } from './graphLayout';

const nodeTypes = { entityType: EntityTypeNode };
const edgeTypes = { relationType: RelationTypeEdge };

interface Props {
  entityTypes: EntityType[];
  relationTypes: RelationType[];
  propertyCounts: Record<string, number>;
}

export default function OntologyGraph({ entityTypes, relationTypes, propertyCounts }: Props) {
  const navigate = useNavigate();
  const { ontologyId } = useParams<{ ontologyId: string }>();

  const [visibleEntityTypes, setVisibleEntityTypes] = useState<Set<string>>(
    () => new Set(entityTypes.map((et) => et.entityTypeId)),
  );
  const [visibleRelationTypes, setVisibleRelationTypes] = useState<Set<string>>(
    () => new Set(relationTypes.map((rt) => rt.relationTypeId)),
  );

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

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const filteredNodes: Node[] = entityTypes
      .filter((et) => visibleEntityTypes.has(et.entityTypeId))
      .map((et) => ({
        id: et.entityTypeId,
        type: 'entityType',
        data: { entityType: et, propertyCount: propertyCounts[et.entityTypeId] ?? 0 },
        position: { x: 0, y: 0 },
      }));

    const filteredEdges: Edge[] = relationTypes
      .filter((rt) => visibleRelationTypes.has(rt.relationTypeId))
      .filter(
        (rt) =>
          visibleEntityTypes.has(rt.sourceEntityTypeId) &&
          visibleEntityTypes.has(rt.targetEntityTypeId),
      )
      .map((rt) => ({
        id: rt.relationTypeId,
        source: rt.sourceEntityTypeId,
        target: rt.targetEntityTypeId,
        type: 'relationType',
        data: { relationType: rt },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
      }));

    return {
      layoutNodes: layoutGraph(filteredNodes, filteredEdges),
      layoutEdges: filteredEdges,
    };
  }, [entityTypes, relationTypes, propertyCounts, visibleEntityTypes, visibleRelationTypes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Keep nodes/edges in sync when layout recomputes
  useMemo(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      navigate(`/ontologies/${ontologyId}/entity-types/${node.id}`);
    },
    [navigate, ontologyId],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      navigate(`/ontologies/${ontologyId}/relation-types/${edge.id}`);
    },
    [navigate, ontologyId],
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
      <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
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
    </div>
  );
}
