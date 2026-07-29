/**
 * Neo4j query functions for the modeling store.
 *
 * Adapter-private. Every function takes a `Session` as its first argument
 * and is invoked exclusively by `Neo4jModelingStore`, which owns the
 * session lifecycle. Cypher text ports the Python reference
 * (`backend/src/ontoforge_server/adapters/neo4j/modeling_queries.py`)
 * one-to-one; driver temporals are converted to port-safe values at this
 * boundary via `temporal.ts`.
 */

import type { Session } from "neo4j-driver";

import { convertNeo4jProperties } from "./temporal.js";

type Row = Record<string, unknown>;

/** The two schema labels that can own a property definition. */
export type OwnerLabel = "EntityType" | "RelationType";

function idField(ownerLabel: OwnerLabel): string {
  return ownerLabel === "EntityType" ? "entityTypeId" : "relationTypeId";
}

export interface ReservedTypeKeyInUse {
  kind: "entityType" | "relationType";
  key: string;
}

/**
 * Find stored types whose key is reserved (created before the check existed).
 *
 * The id filters keep this read correct in exactly the state it detects: an
 * instance of a collided type carries the schema label too, so an unfiltered
 * read would return counterfeit rows.
 */
export async function findReservedTypeKeysInUse(
  session: Session,
  entityTypeKeys: string[],
  relationTypeKeys: string[],
): Promise<ReservedTypeKeyInUse[]> {
  const result = await session.run(
    `
    MATCH (et:EntityType)
    WHERE et.entityTypeId IS NOT NULL AND et.key IN $entityTypeKeys
    RETURN 'entityType' AS kind, et.key AS key
    UNION
    MATCH (rt:RelationType)
    WHERE rt.relationTypeId IS NOT NULL AND rt.key IN $relationTypeKeys
    RETURN 'relationType' AS kind, rt.key AS key
    `,
    { entityTypeKeys, relationTypeKeys },
  );
  return result.records.map((record) => ({
    kind: record.get("kind") as ReservedTypeKeyInUse["kind"],
    key: record.get("key") as string,
  }));
}

// --- Ontology ---

export async function createOntology(
  session: Session,
  ontologyId: string,
  key: string,
  name: string,
  description: string | null,
): Promise<Row> {
  const result = await session.run(
    `
    CREATE (o:Ontology {
        ontologyId: $ontologyId,
        key: $key,
        name: $name,
        description: $description,
        createdAt: datetime(),
        updatedAt: datetime()
    })
    RETURN o {.*} AS ontology
    `,
    { ontologyId, key, name, description },
  );
  return convertNeo4jProperties(result.records[0]?.get("ontology") as Row);
}

export async function listOntologies(session: Session): Promise<Row[]> {
  const result = await session.run(
    "MATCH (o:Ontology) RETURN o {.*} AS ontology ORDER BY o.name",
  );
  return result.records.map((record) => convertNeo4jProperties(record.get("ontology") as Row));
}

export async function getOntology(session: Session, ontologyId: string): Promise<Row | null> {
  const result = await session.run(
    "MATCH (o:Ontology {ontologyId: $ontologyId}) RETURN o {.*} AS ontology",
    { ontologyId },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("ontology") as Row) : null;
}

export async function getOntologyByName(session: Session, name: string): Promise<Row | null> {
  const result = await session.run(
    "MATCH (o:Ontology {name: $name}) RETURN o {.*} AS ontology",
    { name },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("ontology") as Row) : null;
}

export async function getOntologyByKey(session: Session, key: string): Promise<Row | null> {
  const result = await session.run(
    "MATCH (o:Ontology {key: $key}) RETURN o {.*} AS ontology",
    { key },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("ontology") as Row) : null;
}

export async function updateOntology(
  session: Session,
  ontologyId: string,
  name: string | null,
  description: string | null,
): Promise<Row | null> {
  const setClauses = ["o.updatedAt = datetime()"];
  const params: Row = { ontologyId };
  if (name !== null) {
    setClauses.push("o.name = $name");
    params.name = name;
  }
  if (description !== null) {
    setClauses.push("o.description = $description");
    params.description = description;
  }

  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})
    SET ${setClauses.join(", ")}
    RETURN o {.*} AS ontology
    `,
    params,
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("ontology") as Row) : null;
}

/** Delete ontology and cascade to agent configs and saved queries. */
export async function deleteOntology(session: Session, ontologyId: string): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})
    OPTIONAL MATCH (o)-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
    OPTIONAL MATCH (o)-[:HAS_SAVED_QUERY]->(sq:SavedQuery)
    DETACH DELETE o, ac, sq
    RETURN count(o) AS deleted
    `,
    { ontologyId },
  );
  return (result.records[0]?.get("deleted") as number) > 0;
}

// --- Entity Type (Global) ---

export async function createEntityType(
  session: Session,
  entityTypeId: string,
  key: string,
  displayName: string,
  description: string | null,
): Promise<Row> {
  const result = await session.run(
    `
    CREATE (et:EntityType {
        entityTypeId: $entityTypeId,
        key: $key,
        displayName: $displayName,
        description: $description,
        createdAt: datetime(),
        updatedAt: datetime()
    })
    RETURN et {.*} AS entityType
    `,
    { entityTypeId, key, displayName, description },
  );
  return convertNeo4jProperties(result.records[0]?.get("entityType") as Row);
}

export async function listEntityTypes(session: Session): Promise<Row[]> {
  const result = await session.run(
    "MATCH (et:EntityType) RETURN et {.*} AS entityType ORDER BY et.key",
  );
  return result.records.map((record) =>
    convertNeo4jProperties(record.get("entityType") as Row),
  );
}

export async function getEntityType(
  session: Session,
  entityTypeId: string,
): Promise<Row | null> {
  const result = await session.run(
    "MATCH (et:EntityType {entityTypeId: $entityTypeId}) RETURN et {.*} AS entityType",
    { entityTypeId },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("entityType") as Row) : null;
}

export async function getEntityTypeByKey(session: Session, key: string): Promise<Row | null> {
  const result = await session.run(
    "MATCH (et:EntityType {key: $key}) RETURN et {.*} AS entityType",
    { key },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("entityType") as Row) : null;
}

export async function updateEntityType(
  session: Session,
  entityTypeId: string,
  displayName: string | null,
  description: string | null,
): Promise<Row | null> {
  const setClauses = ["et.updatedAt = datetime()"];
  const params: Row = { entityTypeId };
  if (displayName !== null) {
    setClauses.push("et.displayName = $displayName");
    params.displayName = displayName;
  }
  if (description !== null) {
    setClauses.push("et.description = $description");
    params.description = description;
  }

  const result = await session.run(
    `
    MATCH (et:EntityType {entityTypeId: $entityTypeId})
    SET ${setClauses.join(", ")}
    RETURN et {.*} AS entityType
    `,
    params,
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("entityType") as Row) : null;
}

/** Delete entity type and cascade to its property definitions only. */
export async function deleteEntityType(
  session: Session,
  entityTypeId: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (et:EntityType {entityTypeId: $entityTypeId})
    OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    DETACH DELETE et, p
    RETURN count(et) AS deleted
    `,
    { entityTypeId },
  );
  return (result.records[0]?.get("deleted") as number) > 0;
}

export async function isEntityTypeReferenced(
  session: Session,
  entityTypeId: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (rt:RelationType)-[:RELATES_FROM|RELATES_TO]->(et:EntityType {entityTypeId: $entityTypeId})
    RETURN count(rt) > 0 AS referenced
    `,
    { entityTypeId },
  );
  return result.records[0]?.get("referenced") as boolean;
}

// --- Relation Type (Global) ---

export async function createRelationType(
  session: Session,
  relationTypeId: string,
  key: string,
  displayName: string,
  description: string | null,
  sourceEntityTypeKey: string,
  targetEntityTypeKey: string,
): Promise<Row> {
  const result = await session.run(
    `
    MATCH (source:EntityType {key: $sourceEntityTypeKey})
    MATCH (target:EntityType {key: $targetEntityTypeKey})
    CREATE (rt:RelationType {
        relationTypeId: $relationTypeId,
        key: $key,
        displayName: $displayName,
        description: $description,
        createdAt: datetime(),
        updatedAt: datetime()
    })
    CREATE (rt)-[:RELATES_FROM]->(source)
    CREATE (rt)-[:RELATES_TO]->(target)
    RETURN rt {.*,
        sourceEntityTypeKey: source.key,
        targetEntityTypeKey: target.key
    } AS relationType
    `,
    { relationTypeId, key, displayName, description, sourceEntityTypeKey, targetEntityTypeKey },
  );
  return convertNeo4jProperties(result.records[0]?.get("relationType") as Row);
}

export async function listRelationTypes(session: Session): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (rt:RelationType)
    MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
    MATCH (rt)-[:RELATES_TO]->(target:EntityType)
    RETURN rt {.*,
        sourceEntityTypeKey: source.key,
        targetEntityTypeKey: target.key
    } AS relationType ORDER BY rt.key
    `,
  );
  return result.records.map((record) =>
    convertNeo4jProperties(record.get("relationType") as Row),
  );
}

export async function getRelationType(
  session: Session,
  relationTypeId: string,
): Promise<Row | null> {
  const result = await session.run(
    `
    MATCH (rt:RelationType {relationTypeId: $relationTypeId})
    MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
    MATCH (rt)-[:RELATES_TO]->(target:EntityType)
    RETURN rt {.*,
        sourceEntityTypeKey: source.key,
        targetEntityTypeKey: target.key
    } AS relationType
    `,
    { relationTypeId },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("relationType") as Row) : null;
}

export async function getRelationTypeByKey(
  session: Session,
  key: string,
): Promise<Row | null> {
  const result = await session.run(
    `
    MATCH (rt:RelationType {key: $key})
    MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
    MATCH (rt)-[:RELATES_TO]->(target:EntityType)
    RETURN rt {.*,
        sourceEntityTypeKey: source.key,
        targetEntityTypeKey: target.key
    } AS relationType
    `,
    { key },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("relationType") as Row) : null;
}

export async function updateRelationType(
  session: Session,
  relationTypeId: string,
  displayName: string | null,
  description: string | null,
): Promise<Row | null> {
  const setClauses = ["rt.updatedAt = datetime()"];
  const params: Row = { relationTypeId };
  if (displayName !== null) {
    setClauses.push("rt.displayName = $displayName");
    params.displayName = displayName;
  }
  if (description !== null) {
    setClauses.push("rt.description = $description");
    params.description = description;
  }

  const result = await session.run(
    `
    MATCH (rt:RelationType {relationTypeId: $relationTypeId})
    MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
    MATCH (rt)-[:RELATES_TO]->(target:EntityType)
    SET ${setClauses.join(", ")}
    RETURN rt {.*,
        sourceEntityTypeKey: source.key,
        targetEntityTypeKey: target.key
    } AS relationType
    `,
    params,
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("relationType") as Row) : null;
}

/** Delete relation type and cascade to its property definitions only. */
export async function deleteRelationType(
  session: Session,
  relationTypeId: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (rt:RelationType {relationTypeId: $relationTypeId})
    OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    DETACH DELETE rt, p
    RETURN count(rt) AS deleted
    `,
    { relationTypeId },
  );
  return (result.records[0]?.get("deleted") as number) > 0;
}

// --- Property Definition ---

export async function createProperty(
  session: Session,
  ownerId: string,
  ownerLabel: OwnerLabel,
  propertyId: string,
  key: string,
  displayName: string,
  description: string | null,
  dataType: string,
  required: boolean,
  defaultValue: string | null,
): Promise<Row> {
  const result = await session.run(
    `
    MATCH (owner:${ownerLabel} {${idField(ownerLabel)}: $ownerId})
    CREATE (owner)-[:HAS_PROPERTY]->(p:PropertyDefinition {
        propertyId: $propertyId,
        key: $key,
        displayName: $displayName,
        description: $description,
        dataType: $dataType,
        required: $required,
        defaultValue: $defaultValue,
        createdAt: datetime(),
        updatedAt: datetime()
    })
    RETURN p {.*} AS property
    `,
    { ownerId, propertyId, key, displayName, description, dataType, required, defaultValue },
  );
  return convertNeo4jProperties(result.records[0]?.get("property") as Row);
}

export async function listProperties(
  session: Session,
  ownerId: string,
  ownerLabel: OwnerLabel,
): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (owner:${ownerLabel} {${idField(ownerLabel)}: $ownerId})-[:HAS_PROPERTY]->(p:PropertyDefinition)
    RETURN p {.*} AS property ORDER BY p.key
    `,
    { ownerId },
  );
  return result.records.map((record) => convertNeo4jProperties(record.get("property") as Row));
}

export async function getProperty(
  session: Session,
  ownerId: string,
  ownerLabel: OwnerLabel,
  propertyId: string,
): Promise<Row | null> {
  const result = await session.run(
    `
    MATCH (owner:${ownerLabel} {${idField(ownerLabel)}: $ownerId})-[:HAS_PROPERTY]->(p:PropertyDefinition {propertyId: $propertyId})
    RETURN p {.*} AS property
    `,
    { ownerId, propertyId },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("property") as Row) : null;
}

export async function getPropertyByKey(
  session: Session,
  ownerId: string,
  ownerLabel: OwnerLabel,
  key: string,
): Promise<Row | null> {
  const result = await session.run(
    `
    MATCH (owner:${ownerLabel} {${idField(ownerLabel)}: $ownerId})-[:HAS_PROPERTY]->(p:PropertyDefinition {key: $key})
    RETURN p {.*} AS property
    `,
    { ownerId, key },
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("property") as Row) : null;
}

export async function updateProperty(
  session: Session,
  ownerId: string,
  ownerLabel: OwnerLabel,
  propertyId: string,
  displayName: string | null,
  description: string | null,
  required: boolean | null,
  defaultValue: string | null,
  clearDefault: boolean,
): Promise<Row | null> {
  const setClauses = ["p.updatedAt = datetime()"];
  const params: Row = { ownerId, propertyId };
  if (displayName !== null) {
    setClauses.push("p.displayName = $displayName");
    params.displayName = displayName;
  }
  if (description !== null) {
    setClauses.push("p.description = $description");
    params.description = description;
  }
  if (required !== null) {
    setClauses.push("p.required = $required");
    params.required = required;
  }
  if (clearDefault) {
    setClauses.push("p.defaultValue = null");
  } else if (defaultValue !== null) {
    setClauses.push("p.defaultValue = $defaultValue");
    params.defaultValue = defaultValue;
  }

  const result = await session.run(
    `
    MATCH (owner:${ownerLabel} {${idField(ownerLabel)}: $ownerId})-[:HAS_PROPERTY]->(p:PropertyDefinition {propertyId: $propertyId})
    SET ${setClauses.join(", ")}
    RETURN p {.*} AS property
    `,
    params,
  );
  const record = result.records[0];
  return record ? convertNeo4jProperties(record.get("property") as Row) : null;
}

export async function deleteProperty(
  session: Session,
  ownerId: string,
  ownerLabel: OwnerLabel,
  propertyId: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (owner:${ownerLabel} {${idField(ownerLabel)}: $ownerId})-[:HAS_PROPERTY]->(p:PropertyDefinition {propertyId: $propertyId})
    DETACH DELETE p
    RETURN count(p) AS deleted
    `,
    { ownerId, propertyId },
  );
  return (result.records[0]?.get("deleted") as number) > 0;
}

// --- Scope Management (INCLUDES_TYPE) ---

type IncludeRow = {
  key: string;
  typeId: string;
  properties: string[] | null;
};

function toIncludeRow(record: {
  get: (key: string) => unknown;
}): IncludeRow {
  return {
    key: record.get("key") as string,
    typeId: record.get("typeId") as string,
    // Absent allowlist (edge property missing) reads back as null; an
    // empty allowlist reads back as [] — the distinction is preserved.
    properties: (record.get("properties") as string[] | null) ?? null,
  };
}

/**
 * MERGE an INCLUDES_TYPE edge from ontology to a type node — adding the
 * same type again is an upsert that replaces the allowlist. Setting
 * `properties` to null removes the edge property (allowlist absent);
 * an empty array is stored as an empty list (allowlist empty).
 */
export async function addIncludesType(
  session: Session,
  ontologyId: string,
  typeLabel: OwnerLabel,
  typeKey: string,
  properties: string[] | null,
): Promise<IncludeRow | null> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})
    MATCH (t:${typeLabel} {key: $typeKey})
    MERGE (o)-[r:INCLUDES_TYPE]->(t)
    SET r.properties = $properties
    RETURN t.key AS key, t.${idField(typeLabel)} AS typeId, r.properties AS properties
    `,
    { ontologyId, typeKey, properties },
  );
  const record = result.records[0];
  return record ? toIncludeRow(record) : null;
}

/** List all INCLUDES_TYPE edges from ontology to a given type label. */
export async function listIncludesTypes(
  session: Session,
  ontologyId: string,
  typeLabel: OwnerLabel,
): Promise<IncludeRow[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[r:INCLUDES_TYPE]->(t:${typeLabel})
    RETURN t.key AS key, t.${idField(typeLabel)} AS typeId, r.properties AS properties
    ORDER BY t.key
    `,
    { ontologyId },
  );
  return result.records.map(toIncludeRow);
}

/** Get a single INCLUDES_TYPE edge. */
export async function getIncludesType(
  session: Session,
  ontologyId: string,
  typeLabel: OwnerLabel,
  typeId: string,
): Promise<IncludeRow | null> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    RETURN t.key AS key, t.${idField(typeLabel)} AS typeId, r.properties AS properties
    `,
    { ontologyId, typeId },
  );
  const record = result.records[0];
  return record ? toIncludeRow(record) : null;
}

/** Replace the properties allowlist on an INCLUDES_TYPE edge. */
export async function updateIncludesType(
  session: Session,
  ontologyId: string,
  typeLabel: OwnerLabel,
  typeId: string,
  properties: string[] | null,
): Promise<IncludeRow | null> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    SET r.properties = $properties
    RETURN t.key AS key, t.${idField(typeLabel)} AS typeId, r.properties AS properties
    `,
    { ontologyId, typeId, properties },
  );
  const record = result.records[0];
  return record ? toIncludeRow(record) : null;
}

/** Remove an INCLUDES_TYPE edge. */
export async function removeIncludesType(
  session: Session,
  ontologyId: string,
  typeLabel: OwnerLabel,
  typeId: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    DELETE r
    RETURN count(r) AS deleted
    `,
    { ontologyId, typeId },
  );
  return (result.records[0]?.get("deleted") as number) > 0;
}

// --- Scope inclusions (cascade-protocol support) ---

/** Remove all INCLUDES_TYPE edges pointing to a type (cascade delete). */
export async function removeAllIncludesForType(
  session: Session,
  typeLabel: OwnerLabel,
  typeId: string,
): Promise<number> {
  const result = await session.run(
    `
    MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    DELETE r
    RETURN count(r) AS deleted
    `,
    { typeId },
  );
  return result.records[0]?.get("deleted") as number;
}

/** Ontology keys with INCLUDES_TYPE edges to a specific type. */
export async function findOntologiesIncludingType(
  session: Session,
  typeLabel: OwnerLabel,
  typeId: string,
): Promise<string[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology)-[:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    RETURN o.key AS key
    ORDER BY o.key
    `,
    { typeId },
  );
  return result.records.map((record) => record.get("key") as string);
}

/**
 * Ontology keys whose explicit property allowlist for a type does NOT
 * contain the given property key. Ontologies without an allowlist track
 * the type's properties automatically and are never affected.
 */
export async function findOntologiesWithExplicitProperty(
  session: Session,
  typeLabel: OwnerLabel,
  typeId: string,
  propertyKey: string,
): Promise<string[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    WHERE r.properties IS NOT NULL AND NOT $propertyKey IN r.properties
    RETURN o.key AS key
    ORDER BY o.key
    `,
    { typeId, propertyKey },
  );
  return result.records.map((record) => record.get("key") as string);
}

/** Append a property key to every explicit allowlist for a type. */
export async function addPropertyToIncludesLists(
  session: Session,
  typeLabel: OwnerLabel,
  typeId: string,
  propertyKey: string,
): Promise<number> {
  const result = await session.run(
    `
    MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    WHERE r.properties IS NOT NULL AND NOT $propertyKey IN r.properties
    SET r.properties = r.properties + $propertyKey
    RETURN count(r) AS updated
    `,
    { typeId, propertyKey },
  );
  return result.records[0]?.get("updated") as number;
}

/** Remove a property key from every explicit allowlist for a type. */
export async function removePropertyFromIncludesLists(
  session: Session,
  typeLabel: OwnerLabel,
  typeId: string,
  propertyKey: string,
): Promise<number> {
  const result = await session.run(
    `
    MATCH (o:Ontology)-[r:INCLUDES_TYPE]->(t:${typeLabel} {${idField(typeLabel)}: $typeId})
    WHERE r.properties IS NOT NULL AND $propertyKey IN r.properties
    SET r.properties = [p IN r.properties WHERE p <> $propertyKey]
    RETURN count(r) AS updated
    `,
    { typeId, propertyKey },
  );
  return result.records[0]?.get("updated") as number;
}

// --- Document Property Cascade ---

/**
 * Delete all chunk nodes of a (entity type, document property) virtual
 * type. Modeling-side cascade for dropping a document property or its
 * entity type.
 */
export async function deleteChunksForTypeProperty(
  session: Session,
  entityTypeKey: string,
  propertyKey: string,
): Promise<void> {
  await session.run(
    `
    MATCH (c:_Chunk {_entityTypeKey: $entityTypeKey, _propertyKey: $propertyKey})
    DETACH DELETE c
    `,
    { entityTypeKey, propertyKey },
  );
}

// --- Full Schema (one coherent snapshot) ---

/** Load the entire global schema plus every ontology with its inclusions. */
export async function getFullSchema(session: Session): Promise<Row> {
  const etResult = await session.run(
    `
    MATCH (et:EntityType)
    OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    WITH et, collect(p {.*}) AS properties
    RETURN et {.*} AS entityType, properties
    ORDER BY et.key
    `,
  );
  const entityTypes = etResult.records.map((record) => {
    const et = convertNeo4jProperties(record.get("entityType") as Row);
    et.properties = (record.get("properties") as Row[])
      .filter((p) => p)
      .map(convertNeo4jProperties);
    return et;
  });

  const rtResult = await session.run(
    `
    MATCH (rt:RelationType)
    MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
    MATCH (rt)-[:RELATES_TO]->(target:EntityType)
    OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    WITH rt, source, target, collect(p {.*}) AS properties
    RETURN rt {.*} AS relationType,
           source.key AS sourceKey,
           target.key AS targetKey,
           properties
    ORDER BY rt.key
    `,
  );
  const relationTypes = rtResult.records.map((record) => {
    const rt = convertNeo4jProperties(record.get("relationType") as Row);
    rt.sourceKey = record.get("sourceKey") as string;
    rt.targetKey = record.get("targetKey") as string;
    rt.properties = (record.get("properties") as Row[])
      .filter((p) => p)
      .map(convertNeo4jProperties);
    return rt;
  });

  const ontResult = await session.run(
    `
    MATCH (o:Ontology)
    OPTIONAL MATCH (o)-[r:INCLUDES_TYPE]->(t)
    WITH o, collect({
        key: t.key,
        label: labels(t)[0],
        properties: r.properties
    }) AS inclusions
    RETURN o {.*} AS ontology, inclusions
    ORDER BY o.name
    `,
  );
  const ontologies = ontResult.records.map((record) => {
    const ont = convertNeo4jProperties(record.get("ontology") as Row);
    const rawInclusions = record.get("inclusions") as Row[];
    const entityInclusions: Row[] = [];
    const relationInclusions: Row[] = [];
    for (const inc of rawInclusions) {
      if (inc.key === null || inc.key === undefined) {
        continue;
      }
      const entry: Row = { key: inc.key, properties: inc.properties ?? null };
      if (inc.label === "EntityType") {
        entityInclusions.push(entry);
      } else if (inc.label === "RelationType") {
        relationInclusions.push(entry);
      }
    }
    ont.entityInclusions = entityInclusions;
    ont.relationInclusions = relationInclusions;
    return ont;
  });

  return { entityTypes, relationTypes, ontologies };
}

// --- Embedding maintenance (rebuild support) ---

/** List all entity type keys with their raw property definition rows. */
export async function getEntityTypesWithProperties(session: Session): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (et:EntityType)
    OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    WITH et, p ORDER BY et.key, p.key
    WITH et, collect(p {.*}) AS properties
    RETURN et.key AS key, properties
    ORDER BY et.key
    `,
  );
  return result.records.map((record) => ({
    key: record.get("key") as string,
    properties: (record.get("properties") as Row[])
      .filter((p) => p)
      .map((p) => convertNeo4jProperties(p)),
  }));
}

/** Set the embedding vector on a single entity instance. */
export async function setEntityEmbedding(
  session: Session,
  entityId: string,
  embedding: number[],
): Promise<void> {
  await session.run("MATCH (n:_Entity {_id: $id}) SET n._embedding = $embedding", {
    id: entityId,
    embedding,
  });
}

/** List all saved queries (id + description) across all ontologies. */
export async function listSavedQueryRefs(session: Session): Promise<Row[]> {
  const result = await session.run(
    "MATCH (sq:SavedQuery) " +
      "RETURN sq.savedQueryId AS savedQueryId, sq.description AS description",
  );
  return result.records.map((record) => ({
    savedQueryId: record.get("savedQueryId"),
    description: record.get("description"),
  }));
}

/** Set the embedding vector on a single saved query. */
export async function setSavedQueryEmbedding(
  session: Session,
  savedQueryId: string,
  embedding: number[],
): Promise<void> {
  await session.run(
    "MATCH (sq:SavedQuery {savedQueryId: $savedQueryId}) SET sq._embedding = $embedding",
    { savedQueryId, embedding },
  );
}

// --- AI Agent Config ---

export async function listAiAgents(session: Session, ontologyId: string): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
    RETURN ac {.*} AS agent
    ORDER BY ac.name
    `,
    { ontologyId },
  );
  return result.records.map((record) => convertNeo4jProperties(record.get("agent") as Row));
}

/** MERGE-based upsert. Returns `[record, created]` — created is detected by
 * whether ON CREATE stamped this call's fresh id onto the node. */
export async function upsertAiAgent(
  session: Session,
  ontologyId: string,
  agentConfigId: string,
  key: string,
  name: string,
  description: string | null,
  systemPrompt: string | null,
  tools: string[] | null,
): Promise<[Row, boolean]> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})
    MERGE (o)-[:HAS_AI_AGENT]->(ac:AiAgentConfig {key: $key})
    ON CREATE SET
        ac.agentConfigId = $agentConfigId,
        ac.name = $name,
        ac.description = $description,
        ac.systemPrompt = $systemPrompt,
        ac.tools = $tools,
        ac.createdAt = datetime(),
        ac.updatedAt = datetime()
    ON MATCH SET
        ac.name = $name,
        ac.description = $description,
        ac.systemPrompt = $systemPrompt,
        ac.tools = $tools,
        ac.updatedAt = datetime()
    RETURN ac {.*} AS agent, ac.agentConfigId = $agentConfigId AS created
    `,
    { ontologyId, agentConfigId, key, name, description, systemPrompt, tools },
  );
  const record = result.records[0]!;
  return [convertNeo4jProperties(record.get("agent") as Row), record.get("created") as boolean];
}

export async function deleteAiAgent(
  session: Session,
  ontologyId: string,
  agentKey: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[:HAS_AI_AGENT]->(ac:AiAgentConfig {key: $agentKey})
    DETACH DELETE ac
    RETURN count(ac) AS deleted
    `,
    { ontologyId, agentKey },
  );
  return ((result.records[0]?.get("deleted") as number) ?? 0) > 0;
}

// --- Saved Query Config ---

export async function listSavedQueries(session: Session, ontologyId: string): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[:HAS_SAVED_QUERY]->(sq:SavedQuery)
    RETURN sq {.*} AS query
    ORDER BY sq.name
    `,
    { ontologyId },
  );
  return result.records.map((record) => convertNeo4jProperties(record.get("query") as Row));
}

/** MERGE-based upsert. Steps and parameters arrive as serialized text this
 * store does not interpret; the denormalized `_ontologyKey` and the
 * description embedding support in-index scoping of saved-query search. */
export async function upsertSavedQuery(
  session: Session,
  ontologyId: string,
  savedQueryId: string,
  key: string,
  name: string,
  description: string,
  stepsJson: string,
  parametersJson: string,
  ontologyKey: string | null = null,
  embedding: number[] | null = null,
): Promise<[Row, boolean]> {
  const embeddingClause = embedding !== null ? ", sq._embedding = $embedding" : "";
  const ontologyKeyClause = ontologyKey !== null ? ", sq._ontologyKey = $ontologyKey" : "";
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})
    MERGE (o)-[:HAS_SAVED_QUERY]->(sq:SavedQuery {key: $key})
    ON CREATE SET
        sq.savedQueryId = $savedQueryId,
        sq.name = $name,
        sq.description = $description,
        sq.steps = $stepsJson,
        sq.parameters = $parametersJson,
        sq.createdAt = datetime(),
        sq.updatedAt = datetime()${ontologyKeyClause}${embeddingClause}
    ON MATCH SET
        sq.name = $name,
        sq.description = $description,
        sq.steps = $stepsJson,
        sq.parameters = $parametersJson,
        sq.updatedAt = datetime()${ontologyKeyClause}${embeddingClause}
    RETURN sq {.*} AS query, sq.savedQueryId = $savedQueryId AS created
    `,
    {
      ontologyId,
      savedQueryId,
      key,
      name,
      description,
      stepsJson,
      parametersJson,
      ontologyKey,
      embedding,
    },
  );
  const record = result.records[0]!;
  return [convertNeo4jProperties(record.get("query") as Row), record.get("created") as boolean];
}

export async function deleteSavedQuery(
  session: Session,
  ontologyId: string,
  queryKey: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[:HAS_SAVED_QUERY]->(sq:SavedQuery {key: $queryKey})
    DETACH DELETE sq
    RETURN count(sq) AS deleted
    `,
    { ontologyId, queryKey },
  );
  return ((result.records[0]?.get("deleted") as number) ?? 0) > 0;
}
