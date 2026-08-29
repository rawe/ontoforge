/**
 * Runtime schema cache (`docs/architecture.md#schema-cache`).
 *
 * Each lens is assembled once — lazily, on first use — from the runtime
 * store's own schema reads (runtime never calls modeling; the schema is a
 * VALUE to runtime, which is what makes this cache possible) and held in
 * memory: its scoped schema, the full schema, and its agent configurations
 * and saved queries (typed values from `core/ai.ts`).
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

import type { AgentConfig, SavedQueryConfig, SavedQueryParameter, StepConfig } from "../core/ai.js";
import { NotFoundError } from "../core/exceptions.js";
import type { RuntimeStore } from "../core/ports.js";
import type { PropertyDef } from "../core/schemas.js";

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
 * Load the lens for a lens key: from the cache, or built from the
 * runtime store's schema reads on a miss. Unknown key -> not found.
 */
export async function loadSchema(
  lensKey: string,
  store: RuntimeStore,
): Promise<LoadedSchema> {
  const cached = loadedSchemaCache.get(lensKey);
  if (cached !== undefined) {
    return cached;
  }

  const schema = await store.getFullSchema(lensKey);
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

  const agentRows = await store.getAiAgentConfigs(lensKey);
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

  const loaded: LoadedSchema = { scoped, full, agentConfigs, savedQueries };
  loadedSchemaCache.set(lensKey, loaded);
  return loaded;
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
    minScore: (s.minScore as number | undefined) ?? null,
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

function buildSchemaCacheFromRaw(
  lens: Row,
  entityTypesRaw: Row[],
  relationTypesRaw: Row[],
): SchemaCacheValue {
  const cache: SchemaCacheValue = {
    lensId: lens.lensId as string,
    lensKey: lens.key as string,
    lensName: lens.name as string,
    lensDescription: (lens.description as string | undefined) ?? null,
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
