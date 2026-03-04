import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import * as runtimeApi from '../api/runtimeClient';
import type { EntityInstance, RelationInstance, RuntimeEntityType } from '../types/runtime';
import DataGraph from '../components/data-graph/DataGraph';
import DataGraphFilters from '../components/data-graph/DataGraphFilters';
import DataGraphDetailPanel from '../components/data-graph/DataGraphDetailPanel';
import type { DataGraphSelection } from '../components/data-graph/DataGraphDetailPanel';
import AddEntityPanel from '../components/data-graph/AddEntityPanel';
import Modal from '../components/Modal';
import DynamicForm from '../components/runtime/DynamicForm';
import EntityPicker from '../components/runtime/EntityPicker';

const MAX_WORKING_SET = 200;

export default function DataGraphPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: schema, isLoading, error } = useRuntimeSchema(ontologyKey);

  // Working set: entity instances
  const [entities, setEntities] = useState<Map<string, EntityInstance>>(new Map());
  // Relations between working set entities
  const [relations, setRelations] = useState<Map<string, RelationInstance>>(new Map());

  // UI state
  const [visibleEntityTypes, setVisibleEntityTypes] = useState<Set<string>>(new Set());
  const [visibleRelationTypes, setVisibleRelationTypes] = useState<Set<string>>(new Set());
  const [propertyFilters, setPropertyFilters] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<DataGraphSelection | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Create entity modal
  const [createEntityType, setCreateEntityType] = useState<RuntimeEntityType | null>(null);
  const [createEntitySaving, setCreateEntitySaving] = useState(false);
  const [createEntityErrors, setCreateEntityErrors] = useState<Record<string, string>>({});

  // Create relation modal
  const [showCreateRelation, setShowCreateRelation] = useState(false);
  const [createRelType, setCreateRelType] = useState<string>('');
  const [createRelFrom, setCreateRelFrom] = useState<string>('');
  const [createRelTo, setCreateRelTo] = useState<string>('');
  const [createRelSaving, setCreateRelSaving] = useState(false);
  const [createRelErrors, setCreateRelErrors] = useState<Record<string, string>>({});

  // Initialize visibility when schema loads
  useEffect(() => {
    if (!schema) return;
    setVisibleEntityTypes(new Set(schema.entityTypes.map((et) => et.key)));
    setVisibleRelationTypes(new Set(schema.relationTypes.map((rt) => rt.key)));
  }, [schema]);

  // Fetch relations for the current working set
  const fetchRelations = useCallback(async (entityMap: Map<string, EntityInstance>) => {
    if (!ontologyKey || !schema || entityMap.size === 0) {
      setRelations(new Map());
      return;
    }

    const entityIds = new Set(entityMap.keys());
    const newRelations = new Map<string, RelationInstance>();

    // For each relation type, fetch relations involving our entities
    await Promise.all(
      schema.relationTypes.map(async (rt) => {
        try {
          // Fetch relations where source is in working set
          const res = await runtimeApi.listRelations(ontologyKey, rt.key, { limit: 1000 });
          for (const rel of res.items) {
            // Only include if both endpoints are in working set
            if (entityIds.has(rel.fromEntityId) && entityIds.has(rel.toEntityId)) {
              newRelations.set(rel._id, rel);
            }
          }
        } catch {
          // Silently skip failed relation type fetches
        }
      }),
    );

    setRelations(newRelations);
  }, [ontologyKey, schema]);

  // Add entities to working set
  const addEntities = useCallback((newEntities: EntityInstance[]) => {
    setEntities((prev) => {
      const next = new Map(prev);
      for (const entity of newEntities) {
        if (next.size >= MAX_WORKING_SET) {
          toast.error(`Working set limit reached (${MAX_WORKING_SET}). Remove some entities first.`);
          break;
        }
        next.set(entity._id, entity);
      }
      // Trigger relation fetch after state update
      setTimeout(() => fetchRelations(next), 0);
      return next;
    });
  }, [fetchRelations]);

  // Remove entity from working set
  const removeEntity = useCallback((entityId: string) => {
    setEntities((prev) => {
      const next = new Map(prev);
      next.delete(entityId);
      setTimeout(() => fetchRelations(next), 0);
      return next;
    });
    setSelection(null);
  }, [fetchRelations]);

  // Handle entity updated
  const handleEntityUpdated = useCallback((entity: EntityInstance) => {
    setEntities((prev) => {
      const next = new Map(prev);
      next.set(entity._id, entity);
      return next;
    });
    setSelection((prev) => {
      if (prev?.kind === 'entity' && prev.entity._id === entity._id) {
        const et = schema?.entityTypes.find((t) => t.key === entity._entityTypeKey);
        if (et) return { kind: 'entity', entity, entityType: et };
      }
      return prev;
    });
  }, [schema]);

  // Handle entity deleted (from server)
  const handleEntityDeleted = useCallback((entityId: string) => {
    removeEntity(entityId);
  }, [removeEntity]);

  // Handle relation deleted
  const handleRelationDeleted = useCallback((relationId: string, _relationTypeKey: string) => {
    setRelations((prev) => {
      const next = new Map(prev);
      next.delete(relationId);
      return next;
    });
    setSelection(null);
  }, []);

  // Add neighbors of an entity
  const handleAddNeighbors = useCallback(async (entityId: string, _entityTypeKey: string) => {
    if (!ontologyKey || !schema) return;

    const neighborEntities: EntityInstance[] = [];

    for (const rt of schema.relationTypes) {
      try {
        const res = await runtimeApi.listRelations(ontologyKey, rt.key, { limit: 100 });
        for (const rel of res.items) {
          let neighborId: string | null = null;
          let neighborTypeKey: string | null = null;

          if (rel.fromEntityId === entityId) {
            neighborId = rel.toEntityId;
            neighborTypeKey = rt.toEntityTypeKey;
          } else if (rel.toEntityId === entityId) {
            neighborId = rel.fromEntityId;
            neighborTypeKey = rt.fromEntityTypeKey;
          }

          if (neighborId && neighborTypeKey && !entities.has(neighborId)) {
            try {
              const neighbor = await runtimeApi.getEntity(ontologyKey, neighborTypeKey, neighborId);
              neighborEntities.push(neighbor);
            } catch {
              // Entity might have been deleted
            }
          }
        }
      } catch {
        // Skip failed relation type
      }
    }

    if (neighborEntities.length > 0) {
      addEntities(neighborEntities);
      toast.success(`Added ${neighborEntities.length} neighbor(s)`);
    } else {
      toast.info('No new neighbors found');
    }
  }, [ontologyKey, schema, entities, addEntities]);

  // Auto-refresh: periodically re-fetch entities in working set
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!autoRefresh || !ontologyKey || !schema) {
      if (refreshRef.current) clearInterval(refreshRef.current);
      return;
    }

    refreshRef.current = setInterval(async () => {
      const currentEntities = new Map(entities);
      let changed = false;

      for (const [id, entity] of currentEntities) {
        try {
          const fresh = await runtimeApi.getEntity(ontologyKey, entity._entityTypeKey, id);
          if (fresh._updatedAt !== entity._updatedAt) {
            currentEntities.set(id, fresh);
            changed = true;
          }
        } catch {
          // Entity was deleted
          currentEntities.delete(id);
          changed = true;
        }
      }

      if (changed) {
        setEntities(currentEntities);
        fetchRelations(currentEntities);
      }
    }, 5000);

    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [autoRefresh, ontologyKey, schema, entities, fetchRelations]);

  // Create entity handler
  const handleCreateEntity = async (values: Record<string, unknown>) => {
    if (!ontologyKey || !createEntityType) return;
    setCreateEntitySaving(true);
    setCreateEntityErrors({});
    try {
      const created = await runtimeApi.createEntity(ontologyKey, createEntityType.key, values);
      addEntities([created]);
      setCreateEntityType(null);
      toast.success('Entity created and added to graph');
    } catch (e: unknown) {
      const err = e as { details?: { fields?: Record<string, string> }; message?: string };
      if (err.details?.fields) setCreateEntityErrors(err.details.fields);
      else toast.error(err.message ?? 'Create failed');
    } finally {
      setCreateEntitySaving(false);
    }
  };

  // Create relation handler
  const handleCreateRelation = async (values: Record<string, unknown>) => {
    if (!ontologyKey || !createRelType || !createRelFrom || !createRelTo) return;
    setCreateRelSaving(true);
    setCreateRelErrors({});
    try {
      const data = { fromEntityId: createRelFrom, toEntityId: createRelTo, ...values };
      const created = await runtimeApi.createRelation(ontologyKey, createRelType, data);
      setRelations((prev) => {
        const next = new Map(prev);
        next.set(created._id, created);
        return next;
      });
      setShowCreateRelation(false);
      setCreateRelType('');
      setCreateRelFrom('');
      setCreateRelTo('');
      toast.success('Relation created');
    } catch (e: unknown) {
      const err = e as { details?: { fields?: Record<string, string> }; message?: string };
      if (err.details?.fields) setCreateRelErrors(err.details.fields);
      else toast.error(err.message ?? 'Create failed');
    } finally {
      setCreateRelSaving(false);
    }
  };

  // Filter toggle handlers
  const toggleEntityType = useCallback((key: string) => {
    setVisibleEntityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleRelationType = useCallback((key: string) => {
    setVisibleRelationTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handlePropertyFilterChange = useCallback((key: string, value: string) => {
    setPropertyFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleClearPropertyFilters = useCallback(() => {
    setPropertyFilters({});
  }, []);

  // Get valid relation types for create (both endpoints must be in working set entity types)
  const validRelationTypes = schema?.relationTypes.filter((rt) => {
    const fromEntities = [...entities.values()].filter((e) => e._entityTypeKey === rt.fromEntityTypeKey);
    const toEntities = [...entities.values()].filter((e) => e._entityTypeKey === rt.toEntityTypeKey);
    return fromEntities.length > 0 && toEntities.length > 0;
  }) ?? [];

  const selectedRelType = schema?.relationTypes.find((rt) => rt.key === createRelType);

  if (isLoading) return <p>Loading schema...</p>;
  if (error) return <p className="text-red-600">Error: {error.message}</p>;
  if (!schema) return <p>Schema not found.</p>;

  const workingSetIds = new Set(entities.keys());

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Link to={`/data/${ontologyKey}`} className="text-blue-600 hover:underline text-sm">&larr; Data Dashboard</Link>
          <h2 className="text-lg font-bold text-gray-900">Visual Editor</h2>
          <span className="text-xs text-gray-400 font-mono">{entities.size} entities, {relations.size} relations</span>
          {entities.size >= MAX_WORKING_SET && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">Limit reached</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Filters */}
      <DataGraphFilters
        entityTypes={schema.entityTypes}
        relationTypes={schema.relationTypes}
        visibleEntityTypes={visibleEntityTypes}
        visibleRelationTypes={visibleRelationTypes}
        onToggleEntityType={toggleEntityType}
        onToggleRelationType={toggleRelationType}
        onShowAllEntities={() => setVisibleEntityTypes(new Set(schema.entityTypes.map((et) => et.key)))}
        onHideAllEntities={() => setVisibleEntityTypes(new Set())}
        onShowAllRelations={() => setVisibleRelationTypes(new Set(schema.relationTypes.map((rt) => rt.key)))}
        onHideAllRelations={() => setVisibleRelationTypes(new Set())}
        propertyFilters={propertyFilters}
        onPropertyFilterChange={handlePropertyFilterChange}
        onClearPropertyFilters={handleClearPropertyFilters}
      />

      {/* Main area */}
      <div className="flex-1 flex border border-gray-200 rounded-lg overflow-hidden bg-gray-50" style={{ minHeight: '400px' }}>
        <div className="flex-1 relative">
          {/* Action buttons overlay */}
          <div className="absolute top-3 right-3 z-10 flex gap-2">
            <button
              onClick={() => setShowAddPanel(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/90 backdrop-blur border border-gray-300 rounded-md shadow-sm hover:bg-blue-50 hover:border-blue-300 transition-colors"
            >
              <span className="text-blue-600 text-sm leading-none">+</span> Add Entities
            </button>
            {schema.entityTypes.length > 0 && (
              <div className="relative group">
                <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/90 backdrop-blur border border-gray-300 rounded-md shadow-sm hover:bg-emerald-50 hover:border-emerald-300 transition-colors">
                  <span className="text-emerald-600 text-sm leading-none">+</span> Create Entity
                </button>
                <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px] z-20">
                  {schema.entityTypes.map((et) => (
                    <button
                      key={et.key}
                      onClick={() => setCreateEntityType(et)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-700"
                    >
                      {et.displayName}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {validRelationTypes.length > 0 && (
              <button
                onClick={() => { setShowCreateRelation(true); setCreateRelType(validRelationTypes[0].key); }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/90 backdrop-blur border border-gray-300 rounded-md shadow-sm hover:bg-violet-50 hover:border-violet-300 transition-colors"
              >
                <span className="text-violet-600 text-sm leading-none">+</span> Create Relation
              </button>
            )}
          </div>

          {/* Empty state */}
          {entities.size === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-lg font-medium mb-2">No entities in graph</p>
              <p className="text-sm mb-4">Add entities to start exploring your data visually.</p>
              <button
                onClick={() => setShowAddPanel(true)}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Add Entities
              </button>
            </div>
          ) : (
            <DataGraph
              entities={entities}
              relations={relations}
              entityTypes={schema.entityTypes}
              relationTypes={schema.relationTypes}
              visibleEntityTypes={visibleEntityTypes}
              visibleRelationTypes={visibleRelationTypes}
              propertyFilters={propertyFilters}
              selection={selection}
              onSelect={setSelection}
            />
          )}
        </div>

        {/* Detail panel */}
        {selection && (
          <DataGraphDetailPanel
            selection={selection}
            ontologyKey={ontologyKey!}
            entityTypes={schema.entityTypes}
            entities={entities}
            onClose={() => setSelection(null)}
            onEntityUpdated={handleEntityUpdated}
            onEntityDeleted={handleEntityDeleted}
            onRelationDeleted={handleRelationDeleted}
            onAddNeighbors={handleAddNeighbors}
          />
        )}

        {/* Add entity panel */}
        {showAddPanel && (
          <AddEntityPanel
            ontologyKey={ontologyKey!}
            entityTypes={schema.entityTypes}
            workingSetIds={workingSetIds}
            onAddEntities={addEntities}
            onClose={() => setShowAddPanel(false)}
          />
        )}
      </div>

      {/* Create Entity Modal */}
      {createEntityType && (
        <Modal
          open={true}
          onClose={() => { setCreateEntityType(null); setCreateEntityErrors({}); }}
          title={`Create ${createEntityType.displayName}`}
        >
          <DynamicForm
            properties={createEntityType.properties}
            onSubmit={handleCreateEntity}
            onCancel={() => setCreateEntityType(null)}
            errors={createEntityErrors}
            loading={createEntitySaving}
          />
        </Modal>
      )}

      {/* Create Relation Modal */}
      <Modal
        open={showCreateRelation}
        onClose={() => { setShowCreateRelation(false); setCreateRelErrors({}); }}
        title="Create Relation"
      >
        <div className="space-y-4">
          {/* Relation type picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Relation Type</label>
            <select
              value={createRelType}
              onChange={(e) => { setCreateRelType(e.target.value); setCreateRelFrom(''); setCreateRelTo(''); }}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {validRelationTypes.map((rt) => (
                <option key={rt.key} value={rt.key}>
                  {rt.displayName} ({rt.fromEntityTypeKey} → {rt.toEntityTypeKey})
                </option>
              ))}
            </select>
          </div>

          {selectedRelType && (
            <>
              <EntityPicker
                ontologyKey={ontologyKey!}
                entityTypeKey={selectedRelType.fromEntityTypeKey}
                value={createRelFrom || null}
                onChange={setCreateRelFrom}
                label={`From (${selectedRelType.fromEntityTypeKey})`}
              />
              <EntityPicker
                ontologyKey={ontologyKey!}
                entityTypeKey={selectedRelType.toEntityTypeKey}
                value={createRelTo || null}
                onChange={setCreateRelTo}
                label={`To (${selectedRelType.toEntityTypeKey})`}
              />

              {selectedRelType.properties.length > 0 ? (
                <DynamicForm
                  properties={selectedRelType.properties}
                  onSubmit={handleCreateRelation}
                  onCancel={() => setShowCreateRelation(false)}
                  errors={createRelErrors}
                  loading={createRelSaving}
                />
              ) : (
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => handleCreateRelation({})}
                    disabled={!createRelFrom || !createRelTo || createRelSaving}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createRelSaving ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => setShowCreateRelation(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
