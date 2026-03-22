import { useMemo, useState, useCallback } from 'react';
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

import type { RuntimeSchema, RuntimeEntityType, RuntimeRelationType, RuntimePropertyDef } from '../../types/runtime';
import EntityTypeNode from './EntityTypeNode';
import RelationTypeEdge from './RelationTypeEdge';
import { layoutGraph } from './graphLayout';

const nodeTypes = { entityType: EntityTypeNode };
const edgeTypes = { relationType: RelationTypeEdge };

type Selection =
  | { kind: 'entity'; entityType: RuntimeEntityType }
  | { kind: 'relation'; relationType: RuntimeRelationType };

interface Props {
  schema: RuntimeSchema;
}

export default function ScopedOntologyGraph({ schema }: Props) {
  const { entityTypes, relationTypes } = schema;

  const [visibleEntityTypes, setVisibleEntityTypes] = useState<Set<string>>(
    () => new Set(entityTypes.map((et) => et.key)),
  );
  const [visibleRelationTypes, setVisibleRelationTypes] = useState<Set<string>>(
    () => new Set(relationTypes.map((rt) => rt.key)),
  );

  const [selection, setSelection] = useState<Selection | null>(null);
  const clearSelection = useCallback(() => setSelection(null), []);

  const toggleEntityType = useCallback((key: string) => {
    setVisibleEntityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleRelationType = useCallback((key: string) => {
    setVisibleRelationTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectedNodeId = selection?.kind === 'entity' ? selection.entityType.key : null;
  const selectedEdgeId = selection?.kind === 'relation' ? selection.relationType.key : null;

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const filteredNodes: Node[] = entityTypes
      .filter((et) => visibleEntityTypes.has(et.key))
      .map((et) => ({
        id: et.key,
        type: 'entityType',
        data: {
          entityType: et,
          propertyCount: et.properties.length,
          selected: et.key === selectedNodeId,
        },
        position: { x: 0, y: 0 },
      }));

    const filteredEdges: Edge[] = relationTypes
      .filter((rt) => visibleRelationTypes.has(rt.key))
      .filter((rt) => visibleEntityTypes.has(rt.fromEntityTypeKey) && visibleEntityTypes.has(rt.toEntityTypeKey))
      .map((rt) => ({
        id: rt.key,
        source: rt.fromEntityTypeKey,
        target: rt.toEntityTypeKey,
        type: 'relationType',
        data: {
          relationType: rt,
          selected: rt.key === selectedEdgeId,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: rt.key === selectedEdgeId ? '#3b82f6' : '#9ca3af',
        },
      }));

    return {
      layoutNodes: layoutGraph(filteredNodes, filteredEdges),
      layoutEdges: filteredEdges,
    };
  }, [entityTypes, relationTypes, visibleEntityTypes, visibleRelationTypes, selectedNodeId, selectedEdgeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useMemo(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const et = entityTypes.find((e) => e.key === node.id);
      if (et) setSelection({ kind: 'entity', entityType: et });
    },
    [entityTypes],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const rt = relationTypes.find((r) => r.key === edge.id);
      if (rt) setSelection({ kind: 'relation', relationType: rt });
    },
    [relationTypes],
  );

  const onPaneClick = useCallback(() => setSelection(null), []);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 270px)', minHeight: '400px' }}>
      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-500 font-medium w-24 shrink-0">Entity Types:</span>
          {entityTypes.map((et) => (
            <button
              key={et.key}
              onClick={() => toggleEntityType(et.key)}
              className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                visibleEntityTypes.has(et.key)
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {et.displayName}
            </button>
          ))}
          <button onClick={() => setVisibleEntityTypes(new Set(entityTypes.map((et) => et.key)))} className="text-xs text-blue-600 hover:underline ml-1">
            All
          </button>
          <button onClick={() => setVisibleEntityTypes(new Set())} className="text-xs text-blue-600 hover:underline">
            None
          </button>
        </div>
        {relationTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 font-medium w-24 shrink-0">Relations:</span>
            {relationTypes.map((rt) => (
              <button
                key={rt.key}
                onClick={() => toggleRelationType(rt.key)}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  visibleRelationTypes.has(rt.key)
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {rt.displayName}
              </button>
            ))}
            <button onClick={() => setVisibleRelationTypes(new Set(relationTypes.map((rt) => rt.key)))} className="text-xs text-blue-600 hover:underline ml-1">
              All
            </button>
            <button onClick={() => setVisibleRelationTypes(new Set())} className="text-xs text-blue-600 hover:underline">
              None
            </button>
          </div>
        )}
      </div>

      {/* Graph + Detail Panel */}
      <div className="flex-1 flex border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        <div className="flex-1 relative">
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
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} />
            <MiniMap
              nodeStrokeColor="#3b82f6"
              nodeColor="#dbeafe"
              nodeBorderRadius={4}
            />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d1d5db" />
          </ReactFlow>
        </div>
        {selection && (
          <ScopedDetailPanel
            selection={selection}
            entityTypes={entityTypes}
            onClose={clearSelection}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScopedDetailPanel — read-only detail panel for scoped ontology graph
// ---------------------------------------------------------------------------

function ScopedDetailPanel({ selection, entityTypes, onClose }: {
  selection: Selection;
  entityTypes: RuntimeEntityType[];
  onClose: () => void;
}) {
  const displayName = selection.kind === 'entity'
    ? selection.entityType.displayName
    : selection.relationType.displayName;

  const key = selection.kind === 'entity'
    ? selection.entityType.key
    : selection.relationType.key;

  const description = selection.kind === 'entity'
    ? selection.entityType.description
    : selection.relationType.description;

  const properties: RuntimePropertyDef[] = selection.kind === 'entity'
    ? selection.entityType.properties
    : selection.relationType.properties;

  const sourceName = selection.kind === 'relation'
    ? entityTypes.find((et) => et.key === selection.relationType.fromEntityTypeKey)?.displayName ?? selection.relationType.fromEntityTypeKey
    : null;

  const targetName = selection.kind === 'relation'
    ? entityTypes.find((et) => et.key === selection.relationType.toEntityTypeKey)?.displayName ?? selection.relationType.toEntityTypeKey
    : null;

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          {selection.kind === 'entity' ? 'Entity Type' : 'Relation Type'}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{displayName}</h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{key}</p>
        </div>

        {description && (
          <p className="text-sm text-gray-600">{description}</p>
        )}

        {selection.kind === 'relation' && (
          <div className="text-sm">
            <span className="text-gray-500">{sourceName}</span>
            <span className="mx-1.5 text-gray-400">&rarr;</span>
            <span className="text-gray-500">{targetName}</span>
          </div>
        )}

        <div>
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Properties
          </h4>
          {properties.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No properties defined</p>
          ) : (
            <ul className="space-y-2">
              {properties.map((prop) => (
                <li key={prop.key} className="border border-gray-100 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{prop.displayName}</span>
                    <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                      {prop.dataType}
                    </span>
                    {prop.required && (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                        required
                      </span>
                    )}
                  </div>
                  {prop.description && (
                    <p className="text-xs text-gray-500 mt-1">{prop.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
