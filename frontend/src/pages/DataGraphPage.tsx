import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useRuntimeSchema } from '../hooks/useRuntimeSchema';
import * as runtimeApi from '../api/runtimeClient';
import type { EntityInstance, RelationInstance, RuntimeEntityType } from '../types/runtime';
import DataGraph from '../components/data-graph/DataGraph';
import DataGraphFilters from '../components/data-graph/DataGraphFilters';
import type { PropertyFilter } from '../components/data-graph/DataGraphFilters';
import type { ListEntityParams } from '../api/runtimeClient';
import DataGraphDetailPanel from '../components/data-graph/DataGraphDetailPanel';
import type { DataGraphSelection } from '../components/data-graph/DataGraphDetailPanel';
import AddEntityPanel from '../components/data-graph/AddEntityPanel';
import Modal from '../components/Modal';
import DynamicForm from '../components/runtime/DynamicForm';
import EntityPicker from '../components/runtime/EntityPicker';

const MAX_WORKING_SET = 200;
const PER_TYPE_LIMIT = 50;
const RELATION_CAP = 200;
const REFRESH_INTERVAL = 7000;

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
  const [propertyFilters, setPropertyFilters] = useState<Record<string, Record<string, PropertyFilter>>>({});
  const [selection, setSelection] = useState<DataGraphSelection | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Type-driven loading state
  const [typeTotals, setTypeTotals] = useState<Map<string, number>>(new Map());
  const [relationTypeTotals, setRelationTypeTotals] = useState<Map<string, number>>(new Map());
  const [typeLoading, setTypeLoading] = useState<Set<string>>(new Set());

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
  const propertyFiltersRef = useRef(propertyFilters);
  propertyFiltersRef.current = propertyFilters;
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build API filter params from nested PropertyFilter records for a specific entity type
  const buildApiFilters = useCallback((typeKey: string, filters: Record<string, Record<string, PropertyFilter>>): Record<string, string> => {
    if (!schema) return {};
    const et = schema.entityTypes.find((t) => t.key === typeKey);
    if (!et) return {};

    const typeFilters = filters[typeKey];
    if (!typeFilters) return {};

    const apiFilters: Record<string, string> = {};
    for (const [key, filter] of Object.entries(typeFilters)) {
      if (!filter.value) continue;
      const propDef = et.properties.find((p) => p.key === key);
      if (!propDef) continue;

      const dt = propDef.dataType;
      if (dt === 'string' || dt === 'date' || dt === 'datetime') {
        apiFilters[`${key}__contains`] = filter.value;
      } else if (dt === 'integer' || dt === 'float') {
        const op = filter.op ?? '=';
        if (op === '>=') apiFilters[`${key}__gte`] = filter.value;
        else if (op === '<=') apiFilters[`${key}__lte`] = filter.value;
        else apiFilters[key] = filter.value;
      } else if (dt === 'boolean') {
        apiFilters[key] = filter.value;
      }
    }
    return apiFilters;
  }, [schema]);

  // Initialize relation type visibility when schema loads (all ON by default)
  useEffect(() => {
    if (!schema) return;
    setVisibleRelationTypes(new Set(schema.relationTypes.map((rt) => rt.key)));
  }, [schema]);

  // Computed: loaded entity counts per type
  const loadedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of entities.values()) {
      counts.set(entity._entityTypeKey, (counts.get(entity._entityTypeKey) ?? 0) + 1);
    }
    return counts;
  }, [entities]);

  // Fetch relations for the current working set, filtered by visible types
  const fetchRelations = useCallback(async (
    entityMap: Map<string, EntityInstance>,
    enabledEntityTypes?: Set<string>,
    enabledRelationTypes?: Set<string>,
  ) => {
    if (!ontologyKey || !schema || entityMap.size === 0) {
      setRelations(new Map());
      return;
    }

    const activeEntityTypes = enabledEntityTypes ?? visibleEntityTypesRef.current;
    const activeRelationTypes = enabledRelationTypes ?? visibleRelationTypesRef.current;
    const entityIds = new Set(entityMap.keys());
    const newRelations = new Map<string, RelationInstance>();
    const newRelTotals = new Map<string, number>();

    await Promise.all(
      schema.relationTypes.map(async (rt) => {
        // Skip relation types that are toggled off
        if (!activeRelationTypes.has(rt.key)) return;
        // Skip if either endpoint type is not enabled
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

    setRelations(newRelations);
    setRelationTypeTotals(newRelTotals);
  }, [ontologyKey, schema]);

  // Load entities for a specific type, with optional API filters
  const loadEntitiesForType = useCallback(async (typeKey: string, filters?: Record<string, Record<string, PropertyFilter>>): Promise<EntityInstance[]> => {
    if (!ontologyKey) return [];

    const apiFilters = buildApiFilters(typeKey, filters ?? propertyFiltersRef.current);

    setTypeLoading((prev) => new Set(prev).add(typeKey));
    try {
      const params: ListEntityParams = {
        limit: PER_TYPE_LIMIT,
        sort: '_createdAt',
        order: 'desc',
      };
      if (Object.keys(apiFilters).length > 0) params.filters = apiFilters;

      const res = await runtimeApi.listEntities(ontologyKey, typeKey, params);
      setTypeTotals((prev) => new Map(prev).set(typeKey, res.total));
      return res.items;
    } catch {
      toast.error(`Failed to load ${typeKey} entities`);
      return [];
    } finally {
      setTypeLoading((prev) => {
        const next = new Set(prev);
        next.delete(typeKey);
        return next;
      });
    }
  }, [ontologyKey, buildApiFilters]);

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

  // Remove entity from working set
  const removeEntity = useCallback((entityId: string) => {
    setEntities((prev) => {
      const next = new Map(prev);
      next.delete(entityId);
      return next;
    });
    setSelection(null);
  }, []);

  // Toggle entity type: ON → load, OFF → remove all of that type
  const toggleEntityType = useCallback(async (key: string) => {
    const wasEnabled = visibleEntityTypesRef.current.has(key);

    if (wasEnabled) {
      // Toggle OFF: remove all entities of this type
      const newVisible = new Set(visibleEntityTypesRef.current);
      newVisible.delete(key);
      setVisibleEntityTypes(newVisible);

      setEntities((prev) => {
        const next = new Map(prev);
        for (const [id, entity] of prev) {
          if (entity._entityTypeKey === key) next.delete(id);
        }
        // Re-fetch relations with updated entity set
        setTimeout(() => fetchRelations(next, newVisible), 0);
        return next;
      });
    } else {
      // Toggle ON: load entities for this type
      const newVisible = new Set(visibleEntityTypesRef.current);
      newVisible.add(key);
      setVisibleEntityTypes(newVisible);

      const loaded = await loadEntitiesForType(key);
      if (loaded.length > 0) {
        setEntities((prev) => {
          const next = new Map(prev);
          for (const entity of loaded) {
            if (next.size >= MAX_WORKING_SET && !next.has(entity._id)) break;
            next.set(entity._id, entity);
          }
          setTimeout(() => fetchRelations(next, newVisible), 0);
          return next;
        });
      } else {
        fetchRelations(entitiesRef.current, newVisible);
      }
    }
  }, [loadEntitiesForType, fetchRelations]);

  // Show all / hide all entity types
  const handleShowAllEntities = useCallback(async () => {
    if (!schema) return;
    const allKeys = schema.entityTypes.map((et) => et.key);
    const newVisible = new Set(allKeys);
    setVisibleEntityTypes(newVisible);

    // Load entities for all types in parallel
    const results = await Promise.all(allKeys.map((key) => loadEntitiesForType(key)));
    const allLoaded = results.flat();
    if (allLoaded.length > 0) {
      setEntities((prev) => {
        const next = new Map(prev);
        for (const entity of allLoaded) {
          if (next.size >= MAX_WORKING_SET && !next.has(entity._id)) break;
          next.set(entity._id, entity);
        }
        setTimeout(() => fetchRelations(next, newVisible), 0);
        return next;
      });
    }
  }, [schema, loadEntitiesForType, fetchRelations]);

  const handleHideAllEntities = useCallback(() => {
    setVisibleEntityTypes(new Set());
    setEntities(new Map());
    setRelations(new Map());
  }, []);

  const toggleRelationType = useCallback((key: string) => {
    setVisibleRelationTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Re-fetch relations with updated visibility
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
      // Ensure the neighbor's types are visible
      const newTypes = new Set(visibleEntityTypesRef.current);
      for (const n of neighborEntities) newTypes.add(n._entityTypeKey);
      setVisibleEntityTypes(newTypes);
      setTimeout(() => fetchRelations(entitiesRef.current, newTypes), 100);
      toast.success(`Added ${neighborEntities.length} neighbor(s)`);
    } else {
      toast.info('No new neighbors found');
    }
  }, [ontologyKey, schema, addEntities, fetchRelations]);

  // Auto-refresh: discover new entities and detect updates/deletions
  useEffect(() => {
    if (!autoRefresh || !ontologyKey || !schema) return;

    const controller = new AbortController();

    const tick = async () => {
      const currentEntities = entitiesRef.current;
      const enabledTypes = visibleEntityTypesRef.current;
      if (enabledTypes.size === 0) return;

      let changed = false;
      const updatedMap = new Map(currentEntities);

      // Part 1: Discover new + detect updates for each enabled type
      for (const typeKey of enabledTypes) {
        if (controller.signal.aborted) return;
        try {
          const apiFilters = buildApiFilters(typeKey, propertyFiltersRef.current);
          const params: ListEntityParams = {
            limit: 10,
            sort: '_createdAt',
            order: 'desc',
          };
          if (Object.keys(apiFilters).length > 0) params.filters = apiFilters;
          const res = await runtimeApi.listEntities(ontologyKey, typeKey, params);
          // Update total counts
          setTypeTotals((prev) => new Map(prev).set(typeKey, res.total));

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

      // Part 2: Spot-check a batch of existing entities for deletions
      if (!controller.signal.aborted) {
        const allIds = [...updatedMap.entries()];
        const batch = allIds.slice(0, 10);
        for (const [id, entity] of batch) {
          if (controller.signal.aborted) return;
          try {
            await runtimeApi.getEntity(ontologyKey, entity._entityTypeKey, id);
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
  }, [autoRefresh, ontologyKey, schema, fetchRelations, buildApiFilters]);

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

  // Re-fetch all visible types with current filters
  const reloadAllVisibleTypes = useCallback(async (filters: Record<string, Record<string, PropertyFilter>>) => {
    const enabledTypes = visibleEntityTypesRef.current;
    if (enabledTypes.size === 0) return;

    const results = await Promise.all(
      [...enabledTypes].map((key) => loadEntitiesForType(key, filters)),
    );
    const allLoaded = results.flat();
    const next = new Map<string, EntityInstance>();
    for (const entity of allLoaded) {
      if (next.size >= MAX_WORKING_SET) break;
      next.set(entity._id, entity);
    }
    setEntities(next);
    setTimeout(() => fetchRelations(next), 0);
  }, [loadEntitiesForType, fetchRelations]);

  const handlePropertyFilterChange = useCallback((entityTypeKey: string, propertyKey: string, filter: PropertyFilter) => {
    setPropertyFilters((prev) => {
      const next: Record<string, Record<string, PropertyFilter>> = {
        ...prev,
        [entityTypeKey]: { ...prev[entityTypeKey], [propertyKey]: filter },
      };
      // Debounce re-fetch
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
      filterDebounceRef.current = setTimeout(() => reloadAllVisibleTypes(next), 300);
      return next;
    });
  }, [reloadAllVisibleTypes]);

  const handleClearPropertyFilters = useCallback(() => {
    setPropertyFilters({});
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => reloadAllVisibleTypes({}), 300);
  }, [reloadAllVisibleTypes]);

  // Handle drag-to-connect: find valid relation types between two entities
  const handleConnectEntities = useCallback((sourceEntityId: string, targetEntityId: string) => {
    if (!schema) return;
    const sourceEntity = entities.get(sourceEntityId);
    const targetEntity = entities.get(targetEntityId);
    if (!sourceEntity || !targetEntity) return;

    const sourceType = sourceEntity._entityTypeKey;
    const targetType = targetEntity._entityTypeKey;

    // Check forward direction (source→target) and reverse (target→source)
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

    // Prefer forward (user's drag direction), fall back to reverse with swapped from/to
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
        propertyFilters={propertyFilters}
        onPropertyFilterChange={handlePropertyFilterChange}
        onClearPropertyFilters={handleClearPropertyFilters}
        typeTotals={typeTotals}
        loadedCounts={loadedCounts}
        typeLoading={typeLoading}
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
          {entities.size === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-lg font-medium mb-2">No entities loaded</p>
              <p className="text-sm">Toggle entity types above to load data.</p>
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
