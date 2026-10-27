/**
 * Runtime schema cache (`docs/architecture.md#schema-cache`).
 *
 * Each lens is assembled once — lazily, on first use — from the runtime
 * store's own schema reads (runtime never calls modeling; the schema is a
 * VALUE to runtime, which is what makes this cache possible) and held in
 * memory: its scoped schema, the full schema, and its agent configurations
 * and saved queries (typed values from `core/ai.ts`).
 *
 * The cache is per process, and every entry is tagged with the design
 * revision its schema was read with (`DesignRevision`, from the same
 * snapshot). Every use reads the ontology's current revision first — one
 * statement — and uses an entry only while it is still that revision, so
 * a design change made by any server process is seen by the next request
 * here, with no signal between processes. A fill never replaces an entry
 * of a newer revision, so a slow fill finishing late does no harm. The
 * entries live in a bounded least-recently-used map.
 *
 * Beside the lenses it caches, per ontology, the search context: the
 * index definitions with the dependency map derived from them
 * (`core/searchDependencies.ts`), tagged and used the same way.
 *
 * Scope filtering implements the four-row scoping matrix of
 * `docs/capabilities/ontology-lenses.md#the-scoping-matrix`, including the
 * inferred-relations row and the silent skipping of inclusion keys that no
 * longer resolve.
 */

import type { AgentConfig, SavedQueryConfig, SavedQueryParameter, StepConfig } from "../core/ai.js";
import { NotFoundError } from "../core/exceptions.js";
import { sameDesign } from "../core/designRevision.js";
import type { DesignRevision, RuntimeStore, SearchIndexRecord, SearchIndexStore } from "../core/ports.js";
import type { ParentEnd, PropertyDef } from "../core/schemas.js";
import {
  deriveSearchDependencies,
  type SearchDependencies,
} from "../core/searchDependencies.js";

export interface EntityTypeDef {
  key: string;
  displayName: string;
  description: string | null;
  /** Key of the name property; null in a scoped schema whose lens hides it. */
  nameProperty: string | null;
  /** The ordered keys of the identity properties; null when the type has
   * no identity, and in a scoped schema whose lens hides one of them. */
  identityProperties: string[] | null;
  properties: Record<string, PropertyDef>;
}

export interface RelationTypeDef {
  key: string;
  displayName: string;
  description: string | null;
  fromEntityTypeKey: string;
  toEntityTypeKey: string;
  /** The parent end; null for an ordinary relation type. */
  parent: ParentEnd | null;
  /** One per pair; always true with a parent end. */
  onePerPair: boolean;
  properties: Record<string, PropertyDef>;
}

export interface SchemaCacheValue {
  lensId: string;
  lensKey: string;
  lensName: string;
  lensDescription: string | null;
  entityTypes: Record<string, EntityTypeDef>;
  relationTypes: Record<string, RelationTypeDef>;
}

export interface LoadedSchema {
  /** Types and properties visible through this lens. */
  scoped: SchemaCacheValue;
  /** All types and properties — consulted for defaults and endpoint checks. */
  full: SchemaCacheValue;
  /** Agent configurations keyed by agent key. */
  agentConfigs: Record<string, AgentConfig>;
  /** Saved-query pipelines keyed by query key. */
  savedQueries: Record<string, SavedQueryConfig>;
  /** Whether the lens has type inclusions, and the search indices it
   * includes by key (`core/searchQuery.ts` decides availability). */
  searchIndexScope: { scoped: boolean; includedIndices: string[] };
  /** The design revision the schema was read with. */
  design: DesignRevision;
}

type Row = Record<string, unknown>;

interface InclusionRow {
  key: string;
  properties: string[] | null;
}

/** One ontology's search indices against its full schema. */
export interface SearchContext {
  /** Every type and property, unscoped. */
  schema: Pick<SchemaCacheValue, "entityTypes" | "relationTypes">;
  indices: SearchIndexRecord[];
  dependencies: SearchDependencies;
  /** The design revision it was read with. */
  design: DesignRevision;
}

/** At most this many lenses and search contexts are held; the least
 * recently used goes first. */
const MAX_LENSES = 512;
const MAX_SEARCH_CONTEXTS = 128;

/** A bounded map of tagged entries, least recently used first. */
class DesignCache<V extends { design: DesignRevision }> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  /** The entry, if it is still the design `current`. */
  get(key: string, current: DesignRevision): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined || !sameDesign(entry.design, current)) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  /** Keep a fill — unless the entry held is of the same ontology and of
   * its revision or a newer one. */
  publish(key: string, value: V): void {
    const held = this.entries.get(key);
    if (
      held !== undefined &&
      held.design.ontologyId === value.design.ontologyId &&
      held.design.revision >= value.design.revision
    ) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

const loadedSchemaCache = new DesignCache<LoadedSchema>(MAX_LENSES);
const searchContextCache = new DesignCache<SearchContext>(MAX_SEARCH_CONTEXTS);

/** Clear the whole loaded-schema cache, search contexts included. Never
 * needed for correctness — every use checks the design revision — but
 * tests start from an empty cache with it. */
export function invalidateLoadedSchemaCache(): void {
  loadedSchemaCache.clear();
  searchContextCache.clear();
}

/** Forget the search context of one ontology (or of all); tests only, as
 * `invalidateLoadedSchemaCache`. */
export function invalidateSearchContext(ontologyKey?: string): void {
  if (ontologyKey === undefined) {
    searchContextCache.clear();
  } else {
    searchContextCache.delete(ontologyKey);
  }
}

/** How many lenses and search contexts are held (tests). */
export function cachedEntryCounts(): { lenses: number; searchContexts: number } {
  return { lenses: loadedSchemaCache.size, searchContexts: searchContextCache.size };
}

/** The search context of an ontology: from the cache while it is still
 * the design `current` (read now when not given), or read from its
 * search-index store. */
export async function loadSearchContext(
  ontologyKey: string,
  store: SearchIndexStore,
  current?: DesignRevision,
): Promise<SearchContext> {
  const design = current ?? (await store.designRevision());
  const cached = searchContextCache.get(ontologyKey, design);
  if (cached !== undefined) {
    return cached;
  }
  const context = await loadSearchContextUncached(store);
  searchContextCache.publish(ontologyKey, context);
  return context;
}

/** The cache-free read: index definitions and the full schema, now, in
 * one snapshot. */
export async function loadSearchContextUncached(store: SearchIndexStore): Promise<SearchContext> {
  const raw = await store.readFullSchema();
  const indices = raw.indices as SearchIndexRecord[];
  const schema = buildTypesFromRaw(raw.entityTypes as Row[], raw.relationTypes as Row[]);
  return {
    schema,
    indices,
    dependencies: deriveSearchDependencies(
      indices.map(({ searchIndexId, definition }) => ({ searchIndexId, definition })),
      schema,
    ),
    design: raw.design as DesignRevision,
  };
}

/**
 * Load the lens for a lens key: from the cache while it is still the
 * design `current` (read now when not given), or built from the runtime
 * store's schema reads. Unknown key -> not found.
 *
 * The cache key is ontology + lens: a lens key identifies a lens only
 * within one ontology, and the store carries its ontology binding — the
 * same lens key in two ontologies yields two independent entries. An
 * ontology deleted and created again under its key has another id, so
 * its predecessor's entries are never used.
 */
export async function loadSchema(
  lensKey: string,
  store: RuntimeStore,
  current?: DesignRevision,
): Promise<LoadedSchema> {
  const cacheKey = `${store.ontologyKey}/${lensKey}`;
  const design = current ?? (await store.designRevision());
  const cached = loadedSchemaCache.get(cacheKey, design);
  if (cached !== undefined) {
    return cached;
  }
  const loaded = await loadSchemaUncached(lensKey, store);
  loadedSchemaCache.publish(cacheKey, loaded);
  return loaded;
}

/**
 * The cache-free build: the lens assembled fresh from the bound store's
 * schema reads. Unknown key -> not found.
 *
 * The schema and its revision come from one snapshot; the agents and
 * saved queries are read after it, so they are never older than the
 * revision the build is tagged with.
 */
export async function loadSchemaUncached(
  lensKey: string,
  store: RuntimeStore,
): Promise<LoadedSchema> {
  const schema = await store.getFullSchemaWithLensInclusions(lensKey);
  if (schema === null) {
    throw new NotFoundError(`Lens '${lensKey}' not found or has no schema loaded`);
  }

  const full = buildSchemaCacheFromRaw(
    schema.lens as Row,
    schema.entityTypes as Row[],
    schema.relationTypes as Row[],
  );
  const scoped = applyScopeFiltering(
    full,
    schema.entityInclusions as InclusionRow[],
    schema.relationInclusions as InclusionRow[],
  );

  const agentRows = await store.getAgentConfigs(lensKey);
  const agentConfigs: Record<string, AgentConfig> = {};
  for (const row of agentRows) {
    agentConfigs[row.key as string] = {
      key: row.key as string,
      name: row.name as string,
      description: (row.description as string | undefined) ?? null,
      systemPrompt: (row.systemPrompt as string | undefined) ?? null,
      tools: (row.tools as string[] | undefined) ?? null,
    };
  }

  const queryRows = await store.getSavedQueries(lensKey);
  const savedQueries: Record<string, SavedQueryConfig> = {};
  for (const row of queryRows) {
    savedQueries[row.key as string] = toSavedQueryConfig(row);
  }

  const entityInclusions = schema.entityInclusions as InclusionRow[];
  const relationInclusions = schema.relationInclusions as InclusionRow[];
  const searchIndexScope = {
    scoped: entityInclusions.length > 0 || relationInclusions.length > 0,
    includedIndices: (schema.searchIndexInclusions as string[] | undefined) ?? [],
  };

  return { scoped, full, agentConfigs, savedQueries, searchIndexScope, design: schema.design as DesignRevision };
}

/** Deserialize one stored saved-query row: `steps` and `parameters` are
 * held as serialized text the store does not interpret. */
function toSavedQueryConfig(row: Row): SavedQueryConfig {
  const stepsRaw = row.steps ?? "[]";
  const stepsList = (
    typeof stepsRaw === "string" ? JSON.parse(stepsRaw) : (stepsRaw ?? [])
  ) as Row[];
  const paramsRaw = row.parameters ?? "[]";
  const paramsList = (
    typeof paramsRaw === "string" ? JSON.parse(paramsRaw) : (paramsRaw ?? [])
  ) as Row[];
  const steps: StepConfig[] = stepsList.map((s) => ({
    name: s.name as string,
    type: s.type as string,
    oql: (s.oql as string | undefined) ?? null,
    entityTypeKey: (s.entityTypeKey as string | undefined) ?? null,
    query: (s.query as string | undefined) ?? null,
    limit: (s.limit as number | undefined) ?? null,
    bindings: (s.bindings as Record<string, string> | undefined) ?? null,
  }));
  const parameters: SavedQueryParameter[] = paramsList.map((p) => ({
    name: p.name as string,
    description: p.description as string,
    dataType: p.dataType as string,
  }));
  return {
    key: row.key as string,
    name: row.name as string,
    description: row.description as string,
    steps,
    parameters,
  };
}

function toPropertyDefs(rows: Row[] | undefined): Record<string, PropertyDef> {
  const defs: Record<string, PropertyDef> = {};
  for (const p of rows ?? []) {
    defs[p.key as string] = {
      key: p.key as string,
      displayName: p.displayName as string,
      description: (p.description as string | undefined) ?? null,
      dataType: p.dataType as string,
      required: p.required as boolean,
      defaultValue: (p.defaultValue as string | undefined) ?? null,
    };
  }
  return defs;
}

export function buildSchemaCacheFromRaw(
  lens: Row,
  entityTypesRaw: Row[],
  relationTypesRaw: Row[],
): SchemaCacheValue {
  return {
    lensId: lens.lensId as string,
    lensKey: lens.key as string,
    lensName: lens.name as string,
    lensDescription: (lens.description as string | undefined) ?? null,
    ...buildTypesFromRaw(entityTypesRaw, relationTypesRaw),
  };
}

/** The types of a schema read, keyed by type key. */
function buildTypesFromRaw(
  entityTypesRaw: Row[],
  relationTypesRaw: Row[],
): Pick<SchemaCacheValue, "entityTypes" | "relationTypes"> {
  const cache: Pick<SchemaCacheValue, "entityTypes" | "relationTypes"> = {
    entityTypes: {},
    relationTypes: {},
  };
  for (const et of entityTypesRaw) {
    cache.entityTypes[et.key as string] = {
      key: et.key as string,
      displayName: et.displayName as string,
      description: (et.description as string | undefined) ?? null,
      nameProperty: (et.nameProperty as string | undefined) ?? null,
      identityProperties: (et.identityProperties as string[] | null | undefined) ?? null,
      properties: toPropertyDefs(et.properties as Row[] | undefined),
    };
  }
  for (const rt of relationTypesRaw) {
    cache.relationTypes[rt.key as string] = {
      key: rt.key as string,
      displayName: rt.displayName as string,
      description: (rt.description as string | undefined) ?? null,
      fromEntityTypeKey: rt.sourceKey as string,
      toEntityTypeKey: rt.targetKey as string,
      parent: (rt.parent as ParentEnd | null | undefined) ?? null,
      onePerPair: rt.onePerPair === true,
      properties: toPropertyDefs(rt.properties as Row[] | undefined),
    };
  }
  return cache;
}

function filterProperties(
  properties: Record<string, PropertyDef>,
  allowlist: string[] | null,
): Record<string, PropertyDef> {
  if (allowlist === null) {
    return properties;
  }
  const allowed = new Set(allowlist);
  const filtered: Record<string, PropertyDef> = {};
  for (const [pk, pv] of Object.entries(properties)) {
    if (allowed.has(pk)) {
      filtered[pk] = pv;
    }
  }
  return filtered;
}

/**
 * The four-row scoping matrix. Entity and relation scoping are independent
 * dimensions; the inferred row admits every relation type whose source AND
 * target entity types are both exposed. Inclusion keys that no longer
 * resolve are skipped silently, and so is a relation inclusion whose source
 * or target entity type the lens does not expose (validation reports it):
 * no relation type of a lens leads to an entity type the lens hides.
 */
export function applyScopeFiltering(
  full: SchemaCacheValue,
  entityInclusions: InclusionRow[],
  relationInclusions: InclusionRow[],
): SchemaCacheValue {
  const hasEntityScope = entityInclusions.length > 0;
  const hasRelationScope = relationInclusions.length > 0;

  const scoped: SchemaCacheValue = {
    lensId: full.lensId,
    lensKey: full.lensKey,
    lensName: full.lensName,
    lensDescription: full.lensDescription,
    entityTypes: {},
    relationTypes: {},
  };

  // --- Entity types ---
  if (!hasEntityScope) {
    for (const [key, etDef] of Object.entries(full.entityTypes)) {
      scoped.entityTypes[key] = structuredClone(etDef);
    }
  } else {
    for (const inclusion of entityInclusions) {
      const etDef = full.entityTypes[inclusion.key];
      if (etDef === undefined) {
        continue; // dead inclusion key: skipped silently
      }
      const copy = structuredClone(etDef);
      copy.properties = filterProperties(copy.properties, inclusion.properties);
      // A lens that hides the name property shows the type without one.
      if (copy.nameProperty !== null && !(copy.nameProperty in copy.properties)) {
        copy.nameProperty = null;
      }
      // Nor does one that hides part of the identity show one: an identity
      // the lens shows only in part would leak what it hides.
      if (copy.identityProperties?.some((key) => !(key in copy.properties))) {
        copy.identityProperties = null;
      }
      scoped.entityTypes[inclusion.key] = copy;
    }
  }

  const includedEtKeys = new Set(Object.keys(scoped.entityTypes));

  // --- Relation types ---
  if (!hasEntityScope && !hasRelationScope) {
    // Row 1: fully unscoped — all relation types.
    for (const [key, rtDef] of Object.entries(full.relationTypes)) {
      scoped.relationTypes[key] = structuredClone(rtDef);
    }
  } else if (hasEntityScope && !hasRelationScope) {
    // Row 2: inferred — only relations whose BOTH endpoints are in scope.
    for (const [key, rtDef] of Object.entries(full.relationTypes)) {
      if (
        includedEtKeys.has(rtDef.fromEntityTypeKey) &&
        includedEtKeys.has(rtDef.toEntityTypeKey)
      ) {
        scoped.relationTypes[key] = structuredClone(rtDef);
      }
    }
  } else {
    // Rows 3 and 4: only explicitly included relation types — and in row 4
    // only those whose both endpoint types are exposed: a relation type
    // into a hidden entity type would reach entities the lens hides.
    for (const inclusion of relationInclusions) {
      const rtDef = full.relationTypes[inclusion.key];
      if (rtDef === undefined) {
        continue; // dead inclusion key: skipped silently
      }
      if (!includedEtKeys.has(rtDef.fromEntityTypeKey) || !includedEtKeys.has(rtDef.toEntityTypeKey)) {
        continue; // an endpoint the lens hides: skipped silently, as a dead key
      }
      const copy = structuredClone(rtDef);
      copy.properties = filterProperties(copy.properties, inclusion.properties);
      scoped.relationTypes[inclusion.key] = copy;
    }
  }

  return scoped;
}
