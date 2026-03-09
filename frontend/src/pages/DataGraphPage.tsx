import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import * as runtimeApi from '../api/runtimeClient';
import type { EntityInstance, RelationInstance, RuntimeEntityType } from '../types/runtime';
import type { ListEntityParams } from '../api/runtimeClient';
import DataGraph from '../components/data-graph/DataGraph';
import DataGraphFilters from '../components/data-graph/DataGraphFilters';
import DataGraphDetailPanel from '../components/data-graph/DataGraphDetailPanel';
import type { DataGraphSelection } from '../components/data-graph/DataGraphDetailPanel';
import AddEntityPanel from '../components/data-graph/AddEntityPanel';
import Modal from '../components/Modal';
import DynamicForm from '../components/runtime/DynamicForm';
import EntityPicker from '../components/runtime/EntityPicker';
import { MAX_WORKING_SET, PER_TYPE_LIMIT, RELATION_CAP, REFRESH_INTERVAL } from '../lib/dataGraphConstants';
import { getDisplayLabel } from '../lib/displayLabel';

export default function DataGraphPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>();
  const { data: schema, isLoading, error } = useRuntimeSchema(ontologyKey);

  // Working set: entities on the canvas
  const [entities, setEntities] = useState<Map<string, EntityInstance>>(new Map());
  const [relations, setRelations] = useState<Map<string, RelationInstance>>(new Map());

  // Visibility toggles (which types are shown; entities stay in Map when hidden)
  const [visibleEntityTypes, setVisibleEntityTypes] = useState<Set<string>>(new Set());
  const [visibleRelationTypes, setVisibleRelationTypes] = useState<Set<string>>(new Set());

  // UI state
  const [selection, setSelection] = useState<DataGraphSelection | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Relation totals (from API)
  const [relationTypeTotals, setRelationTypeTotals] = useState<Map<string, number>>(new Map());

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

  // Refs for auto-refresh (avoid resetting interval on every state change)
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const visibleEntityTypesRef = useRef(visibleEntityTypes);
  visibleEntityTypesRef.current = visibleEntityTypes;
  const visibleRelationTypesRef = useRef(visibleRelationTypes);
  visibleRelationTypesRef.current = visibleRelationTypes;
  const fetchRelationsSeqRef = useRef(0);
  const spotCheckOffsetRef = useRef(0);

  // Initialize relation type visibility when schema loads (all ON by default)
  useEffect(() => {
    if (!schema) return;
    setVisibleRelationTypes(new Set(schema.relationTypes.map((rt) => rt.key)));
  }, [schema]);

  // Entity counts per type on the canvas
  const canvasCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of entities.values()) {
      counts.set(entity._entityTypeKey, (counts.get(entity._entityTypeKey) ?? 0) + 1);
    }
    return counts;
  }, [entities]);

  // Visible entity count (for empty state)
  const visibleEntityCount = useMemo(() => {
    let count = 0;
    for (const entity of entities.values()) {
      if (visibleEntityTypes.has(entity._entityTypeKey)) count++;
    }
    return count;
  }, [entities, visibleEntityTypes]);

  // Fetch relations for the current working set, filtered by visible types.
  const fetchRelations = useCallback(async (
    entityMap: Map<string, EntityInstance>,
    enabledEntityTypes?: Set<string>,
    enabledRelationTypes?: Set<string>,
  ) => {
    const seq = ++fetchRelationsSeqRef.current;

    if (!ontologyKey || !schema || entityMap.size === 0) {
      if (seq === fetchRelationsSeqRef.current) setRelations(new Map());
      return;
    }

    const activeEntityTypes = enabledEntityTypes ?? visibleEntityTypesRef.current;
    const activeRelationTypes = enabledRelationTypes ?? visibleRelationTypesRef.current;
    const entityIds = new Set(entityMap.keys());
    const newRelations = new Map<string, RelationInstance>();
    const newRelTotals = new Map<string, number>();

    await Promise.all(
      schema.relationTypes.map(async (rt) => {
        if (!activeRelationTypes.has(rt.key)) return;
        if (!activeEntityTypes.has(rt.fromEntityTypeKey) || !activeEntityTypes.has(rt.toEntityTypeKey)) return;

        try {
          const res = await runtimeApi.listRelations(ontologyKey, rt.key, { limit: RELATION_CAP });
          newRelTotals.set(rt.key, res.total);
          for (const rel of res.items) {
            if (entityIds.has(rel.fromEntityId) && entityIds.has(rel.toEntityId)) {
              newRelations.set(rel._id, rel);
            }
          }
        } catch {
          // Silently skip failed relation type fetches
        }
      }),
    );

    if (seq !== fetchRelationsSeqRef.current) return;
    setRelations(newRelations);
    setRelationTypeTotals(newRelTotals);
  }, [ontologyKey, schema]);

  // Add entities to working set
  const addEntities = useCallback((newEntities: EntityInstance[]) => {
    setEntities((prev) => {
      const next = new Map(prev);
      for (const entity of newEntities) {
        if (next.size >= MAX_WORKING_SET && !next.has(entity._id)) {
          toast.error(`Working set limit reached (${MAX_WORKING_SET}).`);
          break;
        }
        next.set(entity._id, entity);
      }
      return next;
    });
  }, []);

  // Add entities and ensure their types are visible
  const addEntitiesAndEnableTypes = useCallback((newEntities: EntityInstance[]) => {
    addEntities(newEntities);
    const newVisible = new Set(visibleEntityTypesRef.current);
    let changed = false;
    for (const entity of newEntities) {
      if (!newVisible.has(entity._entityTypeKey)) {
        newVisible.add(entity._entityTypeKey);
        changed = true;
      }
    }
    if (changed) {
      visibleEntityTypesRef.current = newVisible;
      setVisibleEntityTypes(newVisible);
    }
    setTimeout(() => fetchRelations(entitiesRef.current, visibleEntityTypesRef.current), 0);
  }, [addEntities, fetchRelations]);

  // Remove a single entity from canvas (not from DB)
  const removeEntityFromCanvas = useCallback((entityId: string) => {
    setEntities((prev) => {
      const next = new Map(prev);
      next.delete(entityId);
      return next;
    });
    setSelection(null);
  }, []);

  // Remove all entities of a type from canvas
  const removeTypeFromCanvas = useCallback((key: string) => {
    const newVisible = new Set(visibleEntityTypesRef.current);
    newVisible.delete(key);
    visibleEntityTypesRef.current = newVisible;
    setVisibleEntityTypes(newVisible);

    setEntities((prev) => {
      const next = new Map(prev);
      for (const [id, entity] of prev) {
        if (entity._entityTypeKey === key) next.delete(id);
      }
      setTimeout(() => fetchRelations(next, newVisible), 0);
      return next;
    });
    setSelection(null);
  }, [fetchRelations]);

  // Toggle entity type visibility (show/hide only — no load, no delete)
  const toggleEntityType = useCallback((key: string) => {
    const newVisible = new Set(visibleEntityTypesRef.current);
    if (newVisible.has(key)) {
      newVisible.delete(key);
    } else {
      newVisible.add(key);
    }
    visibleEntityTypesRef.current = newVisible;
    setVisibleEntityTypes(newVisible);
    setTimeout(() => fetchRelations(entitiesRef.current, newVisible), 0);
  }, [fetchRelations]);

  // Show all types that have entities on canvas
  const handleShowAllEntities = useCallback(() => {
    const typesInMap = new Set<string>();
    for (const entity of entitiesRef.current.values()) {
      typesInMap.add(entity._entityTypeKey);
    }
    visibleEntityTypesRef.current = typesInMap;
    setVisibleEntityTypes(typesInMap);
    setTimeout(() => fetchRelations(entitiesRef.current, typesInMap), 0);
  }, [fetchRelations]);

  // Hide all types (entities stay in working set, just hidden)
  const handleHideAllEntities = useCallback(() => {
    const empty = new Set<string>();
    visibleEntityTypesRef.current = empty;
    setVisibleEntityTypes(empty);
    setRelations(new Map());
  }, []);

  const toggleRelationType = useCallback((key: string) => {
    setVisibleRelationTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setTimeout(() => fetchRelations(entitiesRef.current, undefined, next), 0);
      return next;
    });
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
    removeEntityFromCanvas(entityId);
  }, [removeEntityFromCanvas]);

  // Handle relation deleted
  const handleRelationDeleted = useCallback((relationId: string, _relationTypeKey: string) => {
    setRelations((prev) => {
      const next = new Map(prev);
      next.delete(relationId);
      return next;
    });
    setSelection(null);
  }, []);

  // Refresh a single entity from the server (detect updates or deletion)
  const handleRefreshEntity = useCallback(async (entityId: string, entityTypeKey: string) => {
    if (!ontologyKey) return;
    try {
      const fresh = await runtimeApi.getEntity(ontologyKey, entityTypeKey, entityId);
      handleEntityUpdated(fresh);
      toast.success('Entity refreshed');
    } catch {
      removeEntityFromCanvas(entityId);
      toast.info('Entity no longer exists — removed from canvas');
    }
  }, [ontologyKey, handleEntityUpdated, removeEntityFromCanvas]);

  // Refresh a single relation from the server (detect updates or deletion)
  const handleRefreshRelation = useCallback(async (relationId: string, relationTypeKey: string) => {
    if (!ontologyKey) return;
    try {
      const fresh = await runtimeApi.getRelation(ontologyKey, relationTypeKey, relationId);
      setRelations((prev) => {
        const next = new Map(prev);
        next.set(fresh._id, fresh);
        return next;
      });
      // Update selection if this relation is selected
      setSelection((prev) => {
        if (prev?.kind === 'relation' && prev.relation._id === relationId) {
          const rt = schema?.relationTypes.find((t) => t.key === relationTypeKey);
          if (rt) {
            const fromEntity = entitiesRef.current.get(fresh.fromEntityId);
            const toEntity = entitiesRef.current.get(fresh.toEntityId);
            return {
              kind: 'relation',
              relation: fresh,
              relationType: rt,
              fromLabel: fromEntity ? getDisplayLabel(fromEntity) : fresh.fromEntityId.slice(0, 12),
              toLabel: toEntity ? getDisplayLabel(toEntity) : fresh.toEntityId.slice(0, 12),
              fromEntityId: fresh.fromEntityId,
              toEntityId: fresh.toEntityId,
              fromTypeName: schema?.entityTypes.find((t) => t.key === rt.fromEntityTypeKey)?.displayName ?? rt.fromEntityTypeKey,
              toTypeName: schema?.entityTypes.find((t) => t.key === rt.toEntityTypeKey)?.displayName ?? rt.toEntityTypeKey,
            };
          }
        }
        return prev;
      });
      toast.success('Relation refreshed');
    } catch {
      setRelations((prev) => {
        const next = new Map(prev);
        next.delete(relationId);
        return next;
      });
      setSelection(null);
      toast.info('Relation no longer exists — removed from canvas');
    }
  }, [ontologyKey, schema]);

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

          if (neighborId && neighborTypeKey && !entitiesRef.current.has(neighborId)) {
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
      const newTypes = new Set(visibleEntityTypesRef.current);
      for (const n of neighborEntities) newTypes.add(n._entityTypeKey);
      visibleEntityTypesRef.current = newTypes;
      setVisibleEntityTypes(newTypes);
      setTimeout(() => fetchRelations(entitiesRef.current, newTypes), 100);
      toast.success(`Added ${neighborEntities.length} neighbor(s)`);
    } else {
      toast.info('No new neighbors found');
    }
  }, [ontologyKey, schema, addEntities, fetchRelations]);

  // Auto-refresh: discover new entities and detect updates/deletions
  // Iterates all types present in the working set (not just visible types)
  useEffect(() => {
    if (!autoRefresh || !ontologyKey || !schema) return;

    const controller = new AbortController();

    const tick = async () => {
      const currentEntities = entitiesRef.current;

      // Compute types present in the working set
      const typesInMap = new Set<string>();
      for (const entity of currentEntities.values()) {
        typesInMap.add(entity._entityTypeKey);
      }
      if (typesInMap.size === 0) return;

      let changed = false;
      const updatedMap = new Map(currentEntities);

      // Part 1: Discover new + detect updates for each type in the Map
      for (const typeKey of typesInMap) {
        if (controller.signal.aborted) return;
        try {
          const params: ListEntityParams = {
            limit: 10,
            sort: '_createdAt',
            order: 'desc',
          };
          const res = await runtimeApi.listEntities(ontologyKey, typeKey, params);

          const currentTypeCount = [...updatedMap.values()].filter((e) => e._entityTypeKey === typeKey).length;

          for (const entity of res.items) {
            const existing = updatedMap.get(entity._id);
            if (!existing) {
              // New entity — add if under cap
              if (currentTypeCount < PER_TYPE_LIMIT && updatedMap.size < MAX_WORKING_SET) {
                updatedMap.set(entity._id, entity);
                changed = true;
              }
            } else if (existing._updatedAt !== entity._updatedAt) {
              // Updated entity
              updatedMap.set(entity._id, entity);
              changed = true;
            }
          }
        } catch {
          // Skip failed type
        }
      }

      // Part 2: Spot-check a rotating batch of existing entities for deletions
      if (!controller.signal.aborted) {
        const allIds = [...updatedMap.entries()];
        const offset = allIds.length > 0 ? spotCheckOffsetRef.current % allIds.length : 0;
        const batch = allIds.slice(offset, offset + 10).concat(
          offset + 10 > allIds.length ? allIds.slice(0, (offset + 10) - allIds.length) : [],
        );
        spotCheckOffsetRef.current = (offset + 10) % Math.max(allIds.length, 1);
        for (const [id, entity] of batch) {
          if (controller.signal.aborted) return;
          try {
            const fresh = await runtimeApi.getEntity(ontologyKey, entity._entityTypeKey, id);
            if (fresh._updatedAt !== entity._updatedAt) {
              updatedMap.set(id, fresh);
              changed = true;
            }
          } catch {
            updatedMap.delete(id);
            changed = true;
          }
        }
      }

      if (changed && !controller.signal.aborted) {
        setEntities(updatedMap);
        fetchRelations(updatedMap);
      }
    };

    const interval = setInterval(tick, REFRESH_INTERVAL);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [autoRefresh, ontologyKey, schema, fetchRelations]);

  // Create entity handler
  const handleCreateEntity = async (values: Record<string, unknown>) => {
    if (!ontologyKey || !createEntityType) return;
    setCreateEntitySaving(true);
    setCreateEntityErrors({});
    try {
      const created = await runtimeApi.createEntity(ontologyKey, createEntityType.key, values);
      addEntities([created]);
      // Ensure the type is visible
      if (!visibleEntityTypesRef.current.has(createEntityType.key)) {
        const newVisible = new Set(visibleEntityTypesRef.current);
        newVisible.add(createEntityType.key);
        visibleEntityTypesRef.current = newVisible;
        setVisibleEntityTypes(newVisible);
      }
      setCreateEntityType(null);
      toast.success('Entity created and added to graph');
      setTimeout(() => fetchRelations(entitiesRef.current), 100);
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

  // Handle drag-to-connect: find valid relation types between two entities
  const handleConnectEntities = useCallback((sourceEntityId: string, targetEntityId: string) => {
    if (!schema) return;
    const sourceEntity = entities.get(sourceEntityId);
    const targetEntity = entities.get(targetEntityId);
    if (!sourceEntity || !targetEntity) return;

    const sourceType = sourceEntity._entityTypeKey;
    const targetType = targetEntity._entityTypeKey;

    const forwardTypes = schema.relationTypes.filter(
      (rt) => rt.fromEntityTypeKey === sourceType && rt.toEntityTypeKey === targetType,
    );
    const reverseTypes = schema.relationTypes.filter(
      (rt) => rt.fromEntityTypeKey === targetType && rt.toEntityTypeKey === sourceType,
    );

    if (forwardTypes.length === 0 && reverseTypes.length === 0) {
      toast.info('No valid relation types between these entities');
      return;
    }

    if (forwardTypes.length > 0) {
      setCreateRelType(forwardTypes[0].key);
      setCreateRelFrom(sourceEntityId);
      setCreateRelTo(targetEntityId);
    } else {
      setCreateRelType(reverseTypes[0].key);
      setCreateRelFrom(targetEntityId);
      setCreateRelTo(sourceEntityId);
    }
    setShowCreateRelation(true);
  }, [schema, entities]);

  // Get valid relation types for create (both endpoints must be in working set)
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
          <span className="text-xs text-gray-400 font-mono">{entities.size}/{MAX_WORKING_SET} entities, {relations.size} relations</span>
          {entities.size >= MAX_WORKING_SET && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">Limit reached</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer"
            title="Polls for newly created entities of types already on the canvas. Does not detect changes to existing entities — use the Refresh button in the detail panel for that."
          >
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

      {/* Visibility filters */}
      <DataGraphFilters
        entityTypes={schema.entityTypes}
        relationTypes={schema.relationTypes}
        visibleEntityTypes={visibleEntityTypes}
        visibleRelationTypes={visibleRelationTypes}
        canvasCounts={canvasCounts}
        onToggleEntityType={toggleEntityType}
        onToggleRelationType={toggleRelationType}
        onRemoveType={removeTypeFromCanvas}
        onShowAllEntities={handleShowAllEntities}
        onHideAllEntities={handleHideAllEntities}
        onShowAllRelations={() => {
          const all = new Set(schema.relationTypes.map((rt) => rt.key));
          setVisibleRelationTypes(all);
          setTimeout(() => fetchRelations(entitiesRef.current, undefined, all), 0);
        }}
        onHideAllRelations={() => {
          setVisibleRelationTypes(new Set());
          setRelations(new Map());
        }}
        relationTypeTotals={relationTypeTotals}
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
                <div className="hidden group-hover:block absolute right-0 top-full pt-1 z-20"><div className="bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[160px]">
                  {schema.entityTypes.map((et) => (
                    <button
                      key={et.key}
                      onClick={() => setCreateEntityType(et)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-700"
                    >
                      {et.displayName}
                    </button>
                  ))}
                </div></div>
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
          {visibleEntityCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-lg font-medium mb-2">No entities visible</p>
              <p className="text-sm">
                {entities.size > 0
                  ? 'Some entities are on the canvas but hidden. Use the type toggles above to show them.'
                  : 'Use the Add Entities button to load data onto the canvas.'}
              </p>
            </div>
          ) : (
            <DataGraph
              entities={entities}
              relations={relations}
              entityTypes={schema.entityTypes}
              relationTypes={schema.relationTypes}
              visibleEntityTypes={visibleEntityTypes}
              visibleRelationTypes={visibleRelationTypes}
              selection={selection}
              onSelect={setSelection}
              onConnectEntities={handleConnectEntities}
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
            onRemoveFromCanvas={removeEntityFromCanvas}
            onRefreshEntity={handleRefreshEntity}
            onRefreshRelation={handleRefreshRelation}
          />
        )}

        {/* Add entity panel */}
        {showAddPanel && (
          <AddEntityPanel
            ontologyKey={ontologyKey!}
            entityTypes={schema.entityTypes}
            workingSetIds={workingSetIds}
            onAddEntities={addEntitiesAndEnableTypes}
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
