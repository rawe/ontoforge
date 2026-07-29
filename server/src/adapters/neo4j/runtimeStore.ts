/**
 * Neo4j implementation of the runtime store (instance-data persistence).
 *
 * Implements the runtime side of the persistence port (see
 * `core/ports.ts`). Each method owns its session — opened through
 * `runSession`, so driver failures surface as `StoreError` (rule 4) — and
 * delegates to the query functions in `runtimeQueries.ts`. Physical naming
 * (PascalCase labels, UPPER_SNAKE_CASE relationship types) is derived here
 * from the ontology-level type keys the service passes in.
 *
 * Write values cross the port in their port-safe forms (JS `Date` for
 * datetimes, ISO strings for dates, plain numbers for integers) and are
 * converted to driver-native types here, guided by the property
 * definitions the service supplies — the driver would otherwise store
 * every number as a float and every temporal as a string.
 */

import neo4j, { type Driver } from "neo4j-driver";

import type { PropertyDef } from "../../runtime/schemaCache.js";
import { toPascalCase } from "./ddl.js";
import { runSession } from "./errors.js";
import { buildFilterClauses, buildSearchClause, toNeo4jParameter } from "./filters.js";
import * as queries from "./runtimeQueries.js";

type Row = Record<string, unknown>;

/** Convert a property map to driver-native parameter values. Internal
 * `_doc_*_length` counters are integers; everything else follows its
 * property definition's data type. */
function toWriteProperties(
  properties: Row,
  propertyDefs: Record<string, PropertyDef>,
): Row {
  const converted: Row = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith("_doc_") && key.endsWith("_length")) {
      converted[key] = neo4j.int(value as number);
      continue;
    }
    const def = propertyDefs[key];
    converted[key] = def === undefined ? value : toNeo4jParameter(value, def.dataType);
  }
  return converted;
}

export class Neo4jRuntimeStore {
  constructor(private readonly driver: Driver) {}

  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  async getFullSchema(ontologyKey: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getFullSchema(session, ontologyKey));
  }

  async getAiAgentConfigs(ontologyKey: string): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.getAiAgentConfigs(session, ontologyKey),
    );
  }

  async getSavedQueries(ontologyKey: string): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.getSavedQueries(session, ontologyKey));
  }

  // ------------------------------------------------------------------
  // Entity instances
  // ------------------------------------------------------------------

  async createEntity(
    entityTypeKey: string,
    entityId: string,
    properties: Row,
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createEntity(
        session,
        entityTypeKey,
        toPascalCase(entityTypeKey),
        entityId,
        toWriteProperties(properties, propertyDefs),
      ),
    );
  }

  async listEntities(
    entityTypeKey: string,
    propertyDefs: Record<string, PropertyDef>,
    filters: Record<string, string>,
    search: string | null,
    searchPropertyKeys: string[],
    sortField: string,
    order: string,
    limit: number,
    offset: number,
  ): Promise<[Row[], number]> {
    const [whereClauses, params] = buildFilterClauses(filters, propertyDefs, entityTypeKey);
    if (search !== null && search !== undefined && searchPropertyKeys.length > 0) {
      const [clause, searchParams] = buildSearchClause(search, searchPropertyKeys);
      whereClauses.push(clause);
      Object.assign(params, searchParams);
    }
    return runSession(this.driver, (session) =>
      queries.listEntities(
        session,
        toPascalCase(entityTypeKey),
        entityTypeKey,
        whereClauses,
        params,
        sortField,
        order,
        limit,
        offset,
      ),
    );
  }

  async getEntity(entityTypeKey: string, entityId: string): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getEntity(session, toPascalCase(entityTypeKey), entityId),
    );
  }

  async getEntityById(entityId: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getEntityById(session, entityId));
  }

  async updateEntity(
    entityTypeKey: string,
    entityId: string,
    setProperties: Row,
    removeProperties: string[],
    propertyDefs: Record<string, PropertyDef>,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateEntity(
        session,
        toPascalCase(entityTypeKey),
        entityId,
        toWriteProperties(setProperties, propertyDefs),
        removeProperties,
      ),
    );
  }

  async deleteEntity(entityTypeKey: string, entityId: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteEntity(session, toPascalCase(entityTypeKey), entityId),
    );
  }
}
