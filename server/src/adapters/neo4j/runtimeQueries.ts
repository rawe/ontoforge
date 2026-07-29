/**
 * Neo4j query functions for the runtime store.
 *
 * Adapter-private. Every function takes a `Session` as its first argument
 * and is invoked exclusively by `Neo4jRuntimeStore`, which owns the
 * session lifecycle and the physical naming. Cypher text ports the Python
 * reference (`adapters/neo4j/runtime_queries.py`) one-to-one; driver
 * temporals are converted to port-safe values at this boundary via
 * `temporal.ts`, and `_embedding` vectors are stripped so they never
 * appear in any response.
 */

import neo4j, { type Session } from "neo4j-driver";

import { convertNeo4jProperties } from "./temporal.js";

type Row = Record<string, unknown>;

function stripEmbedding(data: Row): Row {
  delete data._embedding;
  return data;
}

function toEntityRow(raw: unknown): Row {
  return stripEmbedding(convertNeo4jProperties(raw as Row));
}

// --- Schema reading (for the runtime schema cache) ---

/**
 * Read the full schema for one ontology by key: ALL entity and relation
 * types globally, plus this ontology's INCLUDES_TYPE edges for scope
 * filtering. Returns null when no matching ontology exists.
 */
export async function getFullSchema(session: Session, ontologyKey: string): Promise<Row | null> {
  const ontResult = await session.run(
    "MATCH (o:Ontology {key: $key}) RETURN o {.*} AS ontology",
    { key: ontologyKey },
  );
  const ontRecord = ontResult.records[0];
  if (ontRecord === undefined) {
    return null;
  }

  const ontology = convertNeo4jProperties(ontRecord.get("ontology") as Row);
  const ontologyId = ontology.ontologyId as string;

  const etResult = await session.run(
    `
    MATCH (et:EntityType)
    OPTIONAL MATCH (et)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    WITH et, collect(p {.*}) AS properties
    RETURN et {.*} AS entity_type, properties
    ORDER BY et.key
    `,
  );
  const entityTypes: Row[] = etResult.records.map((record) => {
    const et = convertNeo4jProperties(record.get("entity_type") as Row);
    et.properties = (record.get("properties") as Row[])
      .filter((p) => p)
      .map((p) => convertNeo4jProperties(p));
    return et;
  });

  const rtResult = await session.run(
    `
    MATCH (rt:RelationType)
    MATCH (rt)-[:RELATES_FROM]->(source:EntityType)
    MATCH (rt)-[:RELATES_TO]->(target:EntityType)
    OPTIONAL MATCH (rt)-[:HAS_PROPERTY]->(p:PropertyDefinition)
    WITH rt, source, target, collect(p {.*}) AS properties
    RETURN rt {.*} AS relation_type,
           source.key AS sourceKey,
           target.key AS targetKey,
           properties
    ORDER BY rt.key
    `,
  );
  const relationTypes: Row[] = rtResult.records.map((record) => {
    const rt = convertNeo4jProperties(record.get("relation_type") as Row);
    rt.sourceKey = record.get("sourceKey");
    rt.targetKey = record.get("targetKey");
    rt.properties = (record.get("properties") as Row[])
      .filter((p) => p)
      .map((p) => convertNeo4jProperties(p));
    return rt;
  });

  const incResult = await session.run(
    `
    MATCH (o:Ontology {ontologyId: $ontologyId})-[r:INCLUDES_TYPE]->(t)
    RETURN t.key AS key, labels(t)[0] AS label, r.properties AS properties
    `,
    { ontologyId },
  );
  const entityInclusions: Row[] = [];
  const relationInclusions: Row[] = [];
  for (const record of incResult.records) {
    const entry: Row = {
      key: record.get("key"),
      properties: record.get("properties") ?? null,
    };
    const label = record.get("label");
    if (label === "EntityType") {
      entityInclusions.push(entry);
    } else if (label === "RelationType") {
      relationInclusions.push(entry);
    }
  }

  return { ontology, entityTypes, relationTypes, entityInclusions, relationInclusions };
}

/** AiAgentConfig rows for one ontology, by key. */
export async function getAiAgentConfigs(session: Session, ontologyKey: string): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology {key: $ontologyKey})-[:HAS_AI_AGENT]->(ac:AiAgentConfig)
    RETURN ac.key AS key, ac.name AS name, ac.description AS description,
           ac.systemPrompt AS systemPrompt, ac.tools AS tools
    ORDER BY ac.name
    `,
    { ontologyKey },
  );
  return result.records.map((record) => convertNeo4jProperties(record.toObject() as Row));
}

/** SavedQuery rows for one ontology, by key. */
export async function getSavedQueries(session: Session, ontologyKey: string): Promise<Row[]> {
  const result = await session.run(
    `
    MATCH (o:Ontology {key: $ontologyKey})-[:HAS_SAVED_QUERY]->(sq:SavedQuery)
    RETURN sq.key AS key, sq.name AS name, sq.description AS description,
           sq.steps AS steps, sq.parameters AS parameters
    ORDER BY sq.name
    `,
    { ontologyKey },
  );
  return result.records.map((record) => convertNeo4jProperties(record.toObject() as Row));
}

// --- Entity instance CRUD ---

/** Create an entity node with dual labels: `_Entity` and the PascalCase
 * type label. System properties are set by the database, not the caller. */
export async function createEntity(
  session: Session,
  entityTypeKey: string,
  pascalLabel: string,
  entityId: string,
  properties: Row,
): Promise<Row> {
  const result = await session.run(
    `
    CREATE (n:_Entity:${pascalLabel} {
        _id: $entityId,
        _entityTypeKey: $entityTypeKey,
        _createdAt: datetime(),
        _updatedAt: datetime()
    })
    SET n += $properties
    RETURN n {.*} AS entity
    `,
    { entityId, entityTypeKey, properties },
  );
  return toEntityRow(result.records[0]?.get("entity"));
}

/** List entities with filtering, sorting, and pagination. */
export async function listEntities(
  session: Session,
  pascalLabel: string,
  entityTypeKey: string,
  whereClauses: string[],
  params: Record<string, unknown>,
  sortField: string,
  order: string,
  limit: number,
  offset: number,
): Promise<[Row[], number]> {
  const baseWhere = "n._entityTypeKey = $entity_type_key";
  const whereStr =
    whereClauses.length > 0
      ? `WHERE ${baseWhere} AND ${whereClauses.join(" AND ")}`
      : `WHERE ${baseWhere}`;

  params.entity_type_key = entityTypeKey;

  const countResult = await session.run(
    `MATCH (n:_Entity:${pascalLabel}) ${whereStr} RETURN count(n) AS total`,
    params,
  );
  // `disableLosslessIntegers` is set on the driver: counts arrive as numbers.
  const total = countResult.records[0]?.get("total") as number;

  if (total === 0) {
    return [[], 0];
  }

  params.offset = neo4j.int(offset);
  params.limit = neo4j.int(limit);
  const dataResult = await session.run(
    `
    MATCH (n:_Entity:${pascalLabel}) ${whereStr}
    RETURN n {.*} AS entity
    ORDER BY n.${sortField} ${order}
    SKIP $offset LIMIT $limit
    `,
    params,
  );
  const items = dataResult.records.map((record) => toEntityRow(record.get("entity")));
  return [items, total];
}

export async function getEntity(
  session: Session,
  pascalLabel: string,
  entityId: string,
): Promise<Row | null> {
  const result = await session.run(
    `MATCH (n:_Entity:${pascalLabel} {_id: $entityId}) RETURN n {.*} AS entity`,
    { entityId },
  );
  const record = result.records[0];
  return record === undefined ? null : toEntityRow(record.get("entity"));
}

export async function getEntityById(session: Session, entityId: string): Promise<Row | null> {
  const result = await session.run(
    "MATCH (n:_Entity {_id: $entityId}) RETURN n {.*} AS entity",
    { entityId },
  );
  const record = result.records[0];
  return record === undefined ? null : toEntityRow(record.get("entity"));
}

export async function updateEntity(
  session: Session,
  pascalLabel: string,
  entityId: string,
  setProperties: Row,
  removeProperties: string[],
): Promise<Row | null> {
  const setClause =
    Object.keys(setProperties).length > 0
      ? "SET n += $setProperties, n._updatedAt = datetime()"
      : "SET n._updatedAt = datetime()";
  const removeClause = removeProperties.map((k) => `REMOVE n.${k}`).join(" ");

  const result = await session.run(
    `
    MATCH (n:_Entity:${pascalLabel} {_id: $entityId})
    ${setClause}
    ${removeClause}
    RETURN n {.*} AS entity
    `,
    { entityId, setProperties },
  );
  const record = result.records[0];
  return record === undefined ? null : toEntityRow(record.get("entity"));
}

/** Delete an entity, its attached relations (DETACH) and its chunks. */
export async function deleteEntity(
  session: Session,
  pascalLabel: string,
  entityId: string,
): Promise<boolean> {
  const result = await session.run(
    `
    MATCH (n:_Entity:${pascalLabel} {_id: $entityId})
    OPTIONAL MATCH (n)-[:_HAS_CHUNK]->(c:_Chunk)
    DETACH DELETE c, n
    RETURN count(*) AS deleted
    `,
    { entityId },
  );
  const deleted = result.records[0]?.get("deleted") as number;
  return deleted > 0;
}
