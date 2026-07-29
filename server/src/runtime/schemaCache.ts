/**
 * Runtime schema cache (`docs/architecture.md#schema-cache`).
 *
 * Each lens is assembled once — lazily, on first use — from the runtime
 * store's own schema reads (runtime never calls modeling; the schema is a
 * VALUE to runtime, which is what makes this cache possible) and held in
 * memory: its scoped schema, the full schema, and its agent configurations
 * and saved queries (loaded but untyped until session 09).
 *
 * The cache is per process and cleared WHOLESALE by any modeling mutation —
 * every mutating modeling service path calls `invalidateLoadedSchemaCache`
 * (wired in sessions 02/03). Wholesale rather than selective, because one
 * schema change can affect many lenses and rebuilding is cheap.
 *
 * Scope filtering implements the four-row scoping matrix of
 * `docs/capabilities/ontology-lenses.md#the-scoping-matrix`, including the
 * inferred-relations row and the silent skipping of inclusion keys that no
 * longer resolve.
 */

import { NotFoundError } from "../core/exceptions.js";
import type { RuntimeStore } from "../core/ports.js";

export interface PropertyDef {
  key: string;
  displayName: string;
  description: string | null;
  dataType: string;
  required: boolean;
  defaultValue: string | null;
}

export interface EntityTypeDef {
  key: string;
  displayName: string;
  description: string | null;
  properties: Record<string, PropertyDef>;
}

export interface RelationTypeDef {
  key: string;
  displayName: string;
  description: string | null;
  fromEntityTypeKey: string;
  toEntityTypeKey: string;
  properties: Record<string, PropertyDef>;
}

export interface SchemaCacheValue {
  ontologyId: string;
  ontologyKey: string;
  ontologyName: string;
  ontologyDescription: string | null;
  entityTypes: Record<string, EntityTypeDef>;
  relationTypes: Record<string, RelationTypeDef>;
}

export interface LoadedSchema {
  /** Types and properties visible through this lens. */
  scoped: SchemaCacheValue;
  /** All types and properties — consulted for defaults and endpoint checks. */
  full: SchemaCacheValue;
  /** Raw agent-config rows keyed by agent key (typed in session 09). */
  agentConfigs: Record<string, Record<string, unknown>>;
  /** Raw saved-query rows keyed by query key (typed in session 09). */
  savedQueries: Record<string, Record<string, unknown>>;
}

type Row = Record<string, unknown>;

interface InclusionRow {
  key: string;
  properties: string[] | null;
}

const loadedSchemaCache = new Map<string, LoadedSchema>();

/** Clear the whole loaded-schema cache. Called by every modeling mutation. */
export function invalidateLoadedSchemaCache(): void {
  loadedSchemaCache.clear();
}

/**
 * Load the lens for an ontology key: from the cache, or built from the
 * runtime store's schema reads on a miss. Unknown key -> not found.
 */
export async function loadSchema(
  ontologyKey: string,
  store: RuntimeStore,
): Promise<LoadedSchema> {
  const cached = loadedSchemaCache.get(ontologyKey);
  if (cached !== undefined) {
    return cached;
  }

  const schema = await store.getFullSchema(ontologyKey);
  if (schema === null) {
    throw new NotFoundError(`Ontology '${ontologyKey}' not found or has no schema loaded`);
  }

  const full = buildSchemaCacheFromRaw(
    schema.ontology as Row,
    schema.entityTypes as Row[],
    schema.relationTypes as Row[],
  );
  const scoped = applyScopeFiltering(
    full,
    schema.entityInclusions as InclusionRow[],
    schema.relationInclusions as InclusionRow[],
  );

  const agentRows = await store.getAiAgentConfigs(ontologyKey);
  const agentConfigs: Record<string, Row> = {};
  for (const row of agentRows) {
    agentConfigs[row.key as string] = row;
  }

  const queryRows = await store.getSavedQueries(ontologyKey);
  const savedQueries: Record<string, Row> = {};
  for (const row of queryRows) {
    savedQueries[row.key as string] = row;
  }

  const loaded: LoadedSchema = { scoped, full, agentConfigs, savedQueries };
  loadedSchemaCache.set(ontologyKey, loaded);
  return loaded;
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

function buildSchemaCacheFromRaw(
  ontology: Row,
  entityTypesRaw: Row[],
  relationTypesRaw: Row[],
): SchemaCacheValue {
  const cache: SchemaCacheValue = {
    ontologyId: ontology.ontologyId as string,
    ontologyKey: ontology.key as string,
    ontologyName: ontology.name as string,
    ontologyDescription: (ontology.description as string | undefined) ?? null,
    entityTypes: {},
    relationTypes: {},
  };
  for (const et of entityTypesRaw) {
    cache.entityTypes[et.key as string] = {
      key: et.key as string,
      displayName: et.displayName as string,
      description: (et.description as string | undefined) ?? null,
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
 * resolve are skipped silently.
 */
function applyScopeFiltering(
  full: SchemaCacheValue,
  entityInclusions: InclusionRow[],
  relationInclusions: InclusionRow[],
): SchemaCacheValue {
  const hasEntityScope = entityInclusions.length > 0;
  const hasRelationScope = relationInclusions.length > 0;

  const scoped: SchemaCacheValue = {
    ontologyId: full.ontologyId,
    ontologyKey: full.ontologyKey,
    ontologyName: full.ontologyName,
    ontologyDescription: full.ontologyDescription,
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
    // Rows 3 and 4: only explicitly included relation types.
    for (const inclusion of relationInclusions) {
      const rtDef = full.relationTypes[inclusion.key];
      if (rtDef === undefined) {
        continue; // dead inclusion key: skipped silently
      }
      const copy = structuredClone(rtDef);
      copy.properties = filterProperties(copy.properties, inclusion.properties);
      scoped.relationTypes[inclusion.key] = copy;
    }
  }

  return scoped;
}
