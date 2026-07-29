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
