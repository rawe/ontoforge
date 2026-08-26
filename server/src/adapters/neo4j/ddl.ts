/**
 * Neo4j naming conventions, vector-index DDL, and index-metadata limits.
 *
 * Adapter-private. Labels, index names, and the PascalCase/UPPER_SNAKE_CASE
 * conventions are implementation details of this adapter and must not leak
 * through the persistence port. The reserved-key sets below are the one
 * exception: they cross the port as plain type keys (never as labels), so
 * the modeling service can reject colliding keys without knowing why they
 * collide.
 */

import type { Driver } from "neo4j-driver";

import { ValidationError } from "../../core/exceptions.js";
import {
  ALL_ENTITY_TYPES_SCOPE,
  documentPropertyScope,
  entityTypeScope,
  reportWidthMismatch,
  reportWidthRecreate,
  SAVED_QUERY_SCOPE,
} from "../../core/vectorDrift.js";
import { runSession } from "./errors.js";

/** Node labels this adapter uses to store schema objects. */
export const SCHEMA_LABELS: ReadonlySet<string> = new Set([
  "Ontology",
  "EntityType",
  "RelationType",
  "PropertyDefinition",
  "AiAgentConfig",
  "SavedQuery",
]);

/** Relationship types this adapter uses to connect schema objects. */
export const SCHEMA_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set([
  "INCLUDES_TYPE",
  "HAS_PROPERTY",
  "RELATES_FROM",
  "RELATES_TO",
  "HAS_AI_AGENT",
  "HAS_SAVED_QUERY",
]);

// The internal names `_Entity`, `_Chunk` and `_HAS_CHUNK` need no reserved
// key: the type key pattern forbids a leading underscore, so no key can
// convert to them.

/** Convert a snake_case key to its PascalCase label. */
export function toPascalCase(key: string): string {
  return key
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

/** Convert a PascalCase label to the snake_case key that produces it. */
export function toSnakeCase(pascal: string): string {
  return pascal.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();
}

/** Convert a snake_case key to its UPPER_SNAKE_CASE relationship type. */
export function toUpperSnakeCase(key: string): string {
  return key.toUpperCase();
}

/** Virtual chunk label for a document property.
 * E.g. ('person', 'bio') -> 'PersonDocumentBio'. */
export function documentVirtualLabel(entityTypeKey: string, propertyKey: string): string {
  return `${toPascalCase(entityTypeKey)}Document${toPascalCase(propertyKey)}`;
}

/** Vector index name for a document property's chunks. */
export function documentIndexName(entityTypeKey: string, propertyKey: string): string {
  return `${entityTypeKey}_document_${propertyKey}_embedding`;
}

/**
 * Entity type keys whose physical label would collide with a schema label.
 *
 * Derived — not copied — by applying the inverse naming transformation to
 * the labels this adapter actually uses, so the set can never drift from
 * the physical naming that makes the collision real.
 */
export function reservedEntityTypeKeys(): ReadonlySet<string> {
  return new Set([...SCHEMA_LABELS].map(toSnakeCase));
}

/**
 * Relation type keys whose physical relationship type would collide with a
 * schema relationship type. Derived from the physical names, as above.
 */
export function reservedRelationTypeKeys(): ReadonlySet<string> {
  return new Set([...SCHEMA_RELATIONSHIP_TYPES].map((relType) => relType.toLowerCase()));
}

/**
 * Constraints and indexes created unconditionally at startup.
 */
export const CONSTRAINTS: readonly string[] = [
  "CREATE CONSTRAINT ontology_id_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.ontologyId IS UNIQUE",
  "CREATE CONSTRAINT ontology_key_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.key IS UNIQUE",
  "CREATE CONSTRAINT ontology_name_unique IF NOT EXISTS FOR (o:Ontology) REQUIRE o.name IS UNIQUE",
  "CREATE CONSTRAINT entity_type_id_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.entityTypeId IS UNIQUE",
  "CREATE CONSTRAINT entity_type_key_unique IF NOT EXISTS FOR (et:EntityType) REQUIRE et.key IS UNIQUE",
  "CREATE CONSTRAINT relation_type_id_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.relationTypeId IS UNIQUE",
  "CREATE CONSTRAINT relation_type_key_unique IF NOT EXISTS FOR (rt:RelationType) REQUIRE rt.key IS UNIQUE",
  "CREATE CONSTRAINT property_id_unique IF NOT EXISTS FOR (pd:PropertyDefinition) REQUIRE pd.propertyId IS UNIQUE",
  "CREATE CONSTRAINT entity_instance_id_unique IF NOT EXISTS FOR (n:_Entity) REQUIRE n._id IS UNIQUE",
  "CREATE INDEX entity_type_key_index IF NOT EXISTS FOR (n:_Entity) ON (n._entityTypeKey)",
  "CREATE CONSTRAINT agent_config_id_unique IF NOT EXISTS FOR (ac:AiAgentConfig) REQUIRE ac.agentConfigId IS UNIQUE",
  "CREATE CONSTRAINT saved_query_id_unique IF NOT EXISTS FOR (sq:SavedQuery) REQUIRE sq.savedQueryId IS UNIQUE",
];

// ---------------------------------------------------------------------------
// Vector-index metadata limits
// ---------------------------------------------------------------------------

/** The engine's indexed-property size ceiling: a per-type vector index
 * stores property values as filter metadata, so indexed string values may
 * not exceed it (`docs/storage-adapters.md`, engine constraints). */
export const MAX_VECTOR_FILTER_VALUE_BYTES = 32766;

export const ENTITY_VECTOR_INDEX_NAME = "entity_embedding";

/**
 * Reject string values too large for vector-index filter metadata.
 *
 * Raised as a domain validation error naming the property, never the
 * engine — enforced only when an embedding provider is configured, since
 * the constraint exists to protect the index.
 */
export function validateVectorIndexedProperties(
  entityTypeKey: string,
  properties: Record<string, unknown>,
  filterProperties: string[],
  entityId: string | null = null,
): void {
  for (const propertyKey of filterProperties) {
    const value = properties[propertyKey];
    if (value === null || value === undefined || typeof value !== "string") {
      continue;
    }
    const valueBytes = Buffer.byteLength(value, "utf8");
    if (valueBytes <= MAX_VECTOR_FILTER_VALUE_BYTES) {
      continue;
    }

    const entityRef = entityId ? ` on entity '${entityId}'` : "";
    throw new ValidationError(
      `Property '${propertyKey}'${entityRef} is too large for semantic indexing ` +
        `on type '${entityTypeKey}' (${valueBytes} bytes > ` +
        `${MAX_VECTOR_FILTER_VALUE_BYTES} bytes)`,
      {
        fields: {
          [propertyKey]:
            "Value exceeds the indexed property size limit " +
            `(${valueBytes} bytes > ${MAX_VECTOR_FILTER_VALUE_BYTES} bytes)`,
        },
      },
    );
  }
}

async function validateExistingVectorIndexedProperties(
  driver: Driver,
  pascalLabel: string,
  entityTypeKey: string,
  filterProperties: string[],
): Promise<void> {
  if (filterProperties.length === 0) {
    return;
  }

  await runSession(driver, async (session) => {
    const result = await session.run(
      `MATCH (n:${pascalLabel}) RETURN n._id AS entity_id, n {.*} AS properties`,
    );
    for (const record of result.records) {
      validateVectorIndexedProperties(
        entityTypeKey,
        (record.get("properties") as Record<string, unknown>) ?? {},
        filterProperties,
        record.get("entity_id") as string,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Vector-index lifecycle
// ---------------------------------------------------------------------------

/** A failed index is silently useless: a create-if-absent would skip over
 * it forever, so it is dropped before recreate. */
async function dropFailedIndexIfExists(driver: Driver, indexName: string): Promise<void> {
  await runSession(driver, async (session) => {
    const result = await session.run(
      "SHOW INDEXES YIELD name, state WHERE name = $name RETURN state",
      { name: indexName },
    );
    const record = result.records[0];
    if (record !== undefined && record.get("state") === "FAILED") {
      await session.run(`DROP INDEX ${indexName} IF EXISTS`);
      console.warn(`Dropped failed vector index before recreate: ${indexName}`);
    }
  });
}

/** The vector width an existing index is configured for, or null if absent. */
export async function existingVectorIndexDimensions(
  driver: Driver,
  indexName: string,
): Promise<number | null> {
  return runSession(driver, async (session) => {
    const result = await session.run(
      "SHOW VECTOR INDEXES YIELD name, options WHERE name = $name RETURN options",
      { name: indexName },
    );
    const record = result.records[0];
    if (record === undefined) {
      return null;
    }
    const options = (record.get("options") as Record<string, unknown> | null) ?? {};
    const indexConfig = (options.indexConfig as Record<string, unknown> | undefined) ?? {};
    const configured = indexConfig["vector.dimensions"];
    return configured === null || configured === undefined ? null : Number(configured);
  });
}

/**
 * Handle an existing index whose width no longer matches the model.
 *
 * A vector index fixes its width at creation, and `CREATE ... IF NOT
 * EXISTS` is a no-op against one that already exists — so changing the
 * embedding model leaves an index that rejects every vector the new model
 * produces. Nothing else notices: the index is ONLINE, so the failed-index
 * check above does not see it, and the symptom only appears later, as a
 * storage failure on the first semantic search.
 *
 * On startup this only warns: dropping an index destroys the vectors it
 * holds, and that is the operator's call. The rebuild path passes
 * `recreateOnMismatch`, because there the drop is followed immediately by
 * regeneration at the new width — the operator asked for exactly that.
 *
 * Only the detection is here. What the operator is told — the wording
 * and the API-scope vocabulary every backend shares — is
 * `core/vectorDrift.ts`.
 */
export async function reconcileIndexDimensions(
  driver: Driver,
  indexName: string,
  describes: string,
  dimensions: number,
  recreateOnMismatch: boolean,
): Promise<void> {
  const existing = await existingVectorIndexDimensions(driver, indexName);
  if (existing === null || existing === dimensions) {
    return;
  }

  if (!recreateOnMismatch) {
    reportWidthMismatch(describes, existing, dimensions);
    return;
  }

  await runSession(driver, async (session) => {
    await session.run(`DROP INDEX ${indexName} IF EXISTS`);
  });
  reportWidthRecreate(describes, existing, dimensions);
}

/**
 * Create vector indexes for all existing entity types (IF NOT EXISTS).
 *
 * New indexes include a WITH clause listing all current non-document
 * properties for in-index filtering. Existing indexes are left untouched
 * unless their width no longer matches `dimensions`, in which case they
 * are reported — or, with `recreateOnMismatch`, dropped and recreated.
 * See `reconcileIndexDimensions`.
 */
export async function ensureVectorIndexes(
  driver: Driver,
  dimensions: number,
  recreateOnMismatch = false,
): Promise<void> {
  const entityTypes = await runSession(driver, async (session) => {
    const result = await session.run(
      `
      MATCH (et:EntityType)
      OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
      WHERE p.dataType <> 'document'
      RETURN et.key AS key, collect(p.key) AS property_keys
      `,
    );
    return result.records.map((record) => ({
      key: record.get("key") as string,
      propertyKeys: record.get("property_keys") as string[],
    }));
  });

  for (const et of entityTypes) {
    await createVectorIndex(driver, et.key, dimensions, et.propertyKeys, recreateOnMismatch);
  }

  // Chunk vector indexes for document properties (one per virtual type).
  const documentProperties = await runSession(driver, async (session) => {
    const result = await session.run(
      `
      MATCH (et:EntityType)-[:HAS_PROPERTY]->(p:PropertyDefinition {dataType: 'document'})
      RETURN et.key AS entity_type_key, p.key AS property_key
      `,
    );
    return result.records.map((record) => ({
      entityTypeKey: record.get("entity_type_key") as string,
      propertyKey: record.get("property_key") as string,
    }));
  });

  for (const { entityTypeKey, propertyKey } of documentProperties) {
    await createDocumentVectorIndex(
      driver,
      entityTypeKey,
      propertyKey,
      dimensions,
      recreateOnMismatch,
    );
  }

  // Cross-type entity vector index (semantic search across all types).
  await ensureEntityVectorIndex(driver, dimensions, recreateOnMismatch);

  // Saved-query vector index (semantic search over descriptions).
  await ensureSavedQueryVectorIndex(driver, dimensions, recreateOnMismatch);
}

/**
 * Create the cross-type vector index on the shared `_Entity` label
 * (IF NOT EXISTS). Type/scope filtering happens in the service layer, so
 * no in-index filter properties are needed.
 */
export async function ensureEntityVectorIndex(
  driver: Driver,
  dimensions: number,
  recreateOnMismatch = false,
): Promise<void> {
  await dropFailedIndexIfExists(driver, ENTITY_VECTOR_INDEX_NAME);
  await reconcileIndexDimensions(
    driver,
    ENTITY_VECTOR_INDEX_NAME,
    ALL_ENTITY_TYPES_SCOPE,
    dimensions,
    recreateOnMismatch,
  );
  const query =
    `CREATE VECTOR INDEX ${ENTITY_VECTOR_INDEX_NAME} IF NOT EXISTS ` +
    "FOR (n:_Entity) ON (n._embedding) " +
    `OPTIONS {indexConfig: {\`vector.dimensions\`: ${dimensions}, ` +
    "`vector.similarity_function`: 'cosine'}}";
  await runSession(driver, async (session) => {
    await session.run(query);
  });
  console.info(`Vector index ensured: ${ENTITY_VECTOR_INDEX_NAME}`);
}

/**
 * Create the vector index for SavedQuery descriptions (IF NOT EXISTS).
 * `_ontologyKey` is an in-index filter property so a description search
 * can be scoped to one ontology in a single query.
 */
export async function ensureSavedQueryVectorIndex(
  driver: Driver,
  dimensions: number,
  recreateOnMismatch = false,
): Promise<void> {
  await reconcileIndexDimensions(
    driver,
    "saved_query_embedding",
    SAVED_QUERY_SCOPE,
    dimensions,
    recreateOnMismatch,
  );
  const query =
    "CREATE VECTOR INDEX saved_query_embedding IF NOT EXISTS " +
    "FOR (sq:SavedQuery) ON (sq._embedding) " +
    "WITH [sq._ontologyKey] " +
    `OPTIONS {indexConfig: {\`vector.dimensions\`: ${dimensions}, ` +
    "`vector.similarity_function`: 'cosine'}}";
  await runSession(driver, async (session) => {
    await session.run(query);
  });
  console.info("Vector index ensured: saved_query_embedding");
}

/**
 * Create a vector index for the given entity type label. When
 * `filterProperties` is provided, the index is created with a WITH clause
 * so those properties are stored alongside vectors for in-index filtering.
 */
export async function createVectorIndex(
  driver: Driver,
  entityTypeKey: string,
  dimensions: number,
  filterProperties: string[] | null = null,
  recreateOnMismatch = false,
): Promise<void> {
  const pascalLabel = toPascalCase(entityTypeKey);
  const indexName = `${entityTypeKey}_embedding`;
  const selectedProperties = (filterProperties ?? []).filter((p) => p);
  await validateExistingVectorIndexedProperties(
    driver,
    pascalLabel,
    entityTypeKey,
    selectedProperties,
  );
  await dropFailedIndexIfExists(driver, indexName);
  await reconcileIndexDimensions(
    driver,
    indexName,
    entityTypeScope(entityTypeKey),
    dimensions,
    recreateOnMismatch,
  );
  let withClause = "";
  if (selectedProperties.length > 0) {
    const props = selectedProperties.map((p) => `n.${p}`).join(", ");
    withClause = `WITH [${props}] `;
  }
  const query =
    `CREATE VECTOR INDEX ${indexName} IF NOT EXISTS ` +
    `FOR (n:${pascalLabel}) ON (n._embedding) ` +
    withClause +
    `OPTIONS {indexConfig: {\`vector.dimensions\`: ${dimensions}, ` +
    "`vector.similarity_function`: 'cosine'}}";
  await runSession(driver, async (session) => {
    await session.run(query);
  });
  console.info(`Vector index ensured: ${indexName}`);
}

/** Create the vector index for a document property's chunk nodes. */
export async function createDocumentVectorIndex(
  driver: Driver,
  entityTypeKey: string,
  propertyKey: string,
  dimensions: number,
  recreateOnMismatch = false,
): Promise<void> {
  const indexName = documentIndexName(entityTypeKey, propertyKey);
  const virtualLabel = documentVirtualLabel(entityTypeKey, propertyKey);
  await dropFailedIndexIfExists(driver, indexName);
  await reconcileIndexDimensions(
    driver,
    indexName,
    documentPropertyScope(entityTypeKey, propertyKey),
    dimensions,
    recreateOnMismatch,
  );
  const query =
    `CREATE VECTOR INDEX ${indexName} IF NOT EXISTS ` +
    `FOR (c:${virtualLabel}) ON (c._embedding) ` +
    `OPTIONS {indexConfig: {\`vector.dimensions\`: ${dimensions}, ` +
    "`vector.similarity_function`: 'cosine'}}";
  await runSession(driver, async (session) => {
    await session.run(query);
  });
  console.info(`Vector index ensured: ${indexName}`);
}

/** Drop the vector index for a document property's chunk nodes. */
export async function dropDocumentVectorIndex(
  driver: Driver,
  entityTypeKey: string,
  propertyKey: string,
): Promise<void> {
  const indexName = documentIndexName(entityTypeKey, propertyKey);
  await runSession(driver, async (session) => {
    await session.run(`DROP INDEX ${indexName} IF EXISTS`);
  });
  console.info(`Vector index dropped: ${indexName}`);
}

/** Drop the vector index for the given entity type. */
export async function dropVectorIndex(driver: Driver, entityTypeKey: string): Promise<void> {
  const indexName = `${entityTypeKey}_embedding`;
  await runSession(driver, async (session) => {
    await session.run(`DROP INDEX ${indexName} IF EXISTS`);
  });
  console.info(`Vector index dropped: ${indexName}`);
}

/**
 * Drop and recreate the vector index with current properties. Called when
 * properties are added or removed from an entity type so that the
 * in-index filter properties stay in sync with the schema.
 */
export async function rebuildVectorIndex(
  driver: Driver,
  entityTypeKey: string,
  dimensions: number,
): Promise<void> {
  const propertyKeys = await runSession(driver, async (session) => {
    const result = await session.run(
      `
      MATCH (et:EntityType {key: $key})
      OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
      WHERE p.dataType <> 'document'
      RETURN collect(p.key) AS property_keys
      `,
      { key: entityTypeKey },
    );
    const record = result.records[0];
    return record === undefined ? [] : (record.get("property_keys") as string[]);
  });

  await validateExistingVectorIndexedProperties(
    driver,
    toPascalCase(entityTypeKey),
    entityTypeKey,
    propertyKeys,
  );
  await dropVectorIndex(driver, entityTypeKey);
  await createVectorIndex(driver, entityTypeKey, dimensions, propertyKeys);
}
