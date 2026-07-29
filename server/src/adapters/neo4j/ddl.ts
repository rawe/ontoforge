/**
 * Neo4j naming conventions and schema-object DDL.
 *
 * Adapter-private. Labels, index names, and the PascalCase/UPPER_SNAKE_CASE
 * conventions are implementation details of this adapter and must not leak
 * through the persistence port. The reserved-key sets below are the one
 * exception: they cross the port as plain type keys (never as labels), so
 * the modeling service can reject colliding keys without knowing why they
 * collide.
 *
 * Vector-index DDL is not part of this module yet (semantic search is a
 * later slice); only the unconditional constraints and indexes live here.
 */

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
 * Constraints and indexes created unconditionally at startup. Names and
 * definitions match the Python reference (`adapters/neo4j/driver.py`).
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
