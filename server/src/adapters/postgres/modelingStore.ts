import { ConflictError, NotFoundError } from "../../core/exceptions.js";
/**
 * `ModelingStore` on PostgreSQL.
 *
 * The reserved-key surface is final: under the jsonb mapping a type key
 * is only ever a value in a `type_key` column, never a table, column, or
 * index name, so both reserved sets are provably empty and
 * `findReservedTypeKeysInUse` answers without touching the database.
 *
 * Operation mapping:
 *
 * - Every method is a single statement through the `runQuery` door; the
 *   exceptions are `getFullSchema`, whose coherent-snapshot obligation
 *   is honoured with one REPEATABLE READ transaction through
 *   `withTransaction`, and `createEntityType`, which writes the type and
 *   its name property in one transaction.
 * - Deletes are one `DELETE` each, `rowCount > 0` as the boolean —
 *   `ON DELETE CASCADE` carries what the reference adapter needed
 *   explicit fan-out for (property definitions, inclusions, agents,
 *   saved queries), and the endpoint FKs' `ON DELETE RESTRICT` backs the
 *   service's in-use rule.
 * - Upserts (agents, saved queries, re-added inclusions) ride
 *   `INSERT … ON CONFLICT … DO UPDATE` on the composite uniques, with
 *   `RETURNING (id = $freshId) AS created` as the created-detection.
 * - Every UPDATE sets `updated_at = now()` explicitly where the
 *   reference adapter stamps `updatedAt` (no triggers; advances on no-op
 *   updates).
 * - Ids from the wire pass the strict `isUuid()` guard (`rows.ts`)
 *   before any statement; off-format input short-circuits to the
 *   method's not-found shape.
 *
 * The saved-query index methods are `ddl.ts`'s — physical naming and
 * index DDL live there, beside the init DDL. The adapter stores search
 * indices, so it implements none of the port's own-search-storage
 * methods (`core/ownSearch.ts`); its vector-index inventory is the
 * saved-query index alone.
 */

import type { KeywordLanguage } from "../../core/keywordLanguage.js";

import { toSql } from "pgvector";

import type { ModelingStore, ReservedTypeKeyInUse, Row, SearchIndexStore } from "../../core/ports.js";
import type { NewPropertyDef, TypeKind } from "../../core/schemas.js";
import * as vectorDdl from "./ddl.js";
import { runQuery, withTransaction, type DbResult, type IsolationLevel, type Querier } from "./errors.js";
import { camelizeRow, camelizeRows, isUuid } from "./rows.js";
import { LENS_COLS, readTypesWithProperties, splitInclusions } from "./schemaRead.js";
import { PostgresSearchIndexStore } from "./searchIndexStore.js";

const NO_RESERVED_KEYS: ReadonlySet<string> = new Set();

// Read column lists — the port-visible shape of each object; owner ids,
// denormalized keys, and embeddings stay out of returned rows.
// (`LENS_COLS` comes from `schemaRead.ts`, shared with the runtime store.)
const ENTITY_TYPE_COLS =
  "entity_type_id, key, display_name, description, name_property, created_at, updated_at";
const RELATION_TYPE_COLS =
  "relation_type_id, key, display_name, description, " +
  "source_entity_type_key, target_entity_type_key, created_at, updated_at";
const PROPERTY_COLS =
  "property_id, key, display_name, description, data_type, required, default_value, " +
  "created_at, updated_at";
const AGENT_COLS =
  "agent_config_id, key, name, description, system_prompt, tools, created_at, updated_at";
const SAVED_QUERY_COLS =
  "saved_query_id, key, name, description, steps, parameters, created_at, updated_at";

/** The polymorphic-owner column the port's `typeKind` selects. */
function ownerColumn(typeKind: TypeKind): "entity_type_id" | "relation_type_id" {
  return typeKind === "EntityType" ? "entity_type_id" : "relation_type_id";
}

/** The type table a `typeKind` names. */
function typeTable(typeKind: TypeKind): "entity_type" | "relation_type" {
  return typeKind === "EntityType" ? "entity_type" : "relation_type";
}

function firstRowOrNull(rows: Row[]): Row | null {
  const row = rows[0];
  return row ? camelizeRow(row) : null;
}

/** The optional-SET builder shared by the four update methods: starts
 * from the `updated_at = now()` stamp, then for each non-null field
 * pushes its value onto `params` and adds `col = $n` in field order. */
function buildUpdateSets(
  params: unknown[],
  fields: [column: string, value: unknown][],
): string[] {
  const sets = ["updated_at = now()"];
  for (const [column, value] of fields) {
    if (value !== null) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  return sets;
}

/** The `{key, typeId, properties}` shape of one scope inclusion. An
 * absent allowlist reads back as null; an empty one as `[]` — the
 * distinction is contract. */
function toIncludeRow(row: Row): Row {
  return {
    key: row.key as string,
    typeId: row.type_id as string,
    properties: (row.properties as string[] | null) ?? null,
  };
}

/** The one property-definition INSERT, shared by property creation and
 * entity type creation (its name property). */
async function insertProperty(
  querier: Querier,
  ownerId: string,
  typeKind: TypeKind,
  property: NewPropertyDef,
): Promise<Row> {
  const result = await querier.query(
    `INSERT INTO property_def
       (property_id, entity_type_id, relation_type_id, key, display_name,
        description, data_type, required, default_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PROPERTY_COLS}`,
    [
      property.propertyId,
      typeKind === "EntityType" ? ownerId : null,
      typeKind === "RelationType" ? ownerId : null,
      property.key,
      property.displayName,
      property.description,
      property.dataType,
      property.required,
      property.defaultValue,
    ],
  );
  return camelizeRow(result.rows[0]!);
}

export class PostgresModelingStore implements ModelingStore {
  /** Bound to one ontology's namespace; unbound (tests only) runs against
   * the connection's default namespace. */
  constructor(
    private readonly namespace?: string,
    public readonly textSearchLanguage: KeywordLanguage = "english",
    private readonly ontologyKey: string = "",
  ) {}

  /** The search-index store of the same ontology. */
  searchIndices(): SearchIndexStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound modeling store has no search indices");
    }
    return new PostgresSearchIndexStore(this.namespace, this.ontologyKey);
  }

  /** Door one, carrying this store's binding. */
  private query(text: string, params?: unknown[]): Promise<DbResult> {
    return runQuery(text, params, this.namespace);
  }

  /** Door two, carrying this store's binding. */
  private tx<T>(
    work: (querier: Querier) => Promise<T>,
    isolation: IsolationLevel = "READ COMMITTED",
  ): Promise<T> {
    return withTransaction(work, isolation, this.namespace);
  }

  async listRetrievers(lensId: string): Promise<Row[]> {
    return camelizeRows((await this.query("SELECT * FROM retriever_config WHERE lens_id=$1 ORDER BY name,key", [lensId])).rows);
  }

  async getRetriever(lensId: string, key: string): Promise<Row | null> {
    const row = (await this.query("SELECT * FROM retriever_config WHERE lens_id=$1 AND key=$2", [lensId, key])).rows[0];
    return row ? camelizeRow(row) : null;
  }

  async upsertRetriever(lensId: string, id: string, key: string, name: string, description: string | null, configVersion: number, config: unknown, createOnly = false): Promise<[
    Row,
    boolean
  ]> {
    return this.tx(async (q) => {
      if(!(await q.query("SELECT lens_id FROM lens WHERE lens_id=$1 FOR UPDATE", [lensId])).rows.length)
        throw new NotFoundError("Lens not found");
      if(createOnly && (await q.query("SELECT key FROM retriever_config WHERE lens_id=$1 AND key=$2", [lensId, key])).rows.length) {
        throw new ConflictError(`Retriever '${key}' already exists in the target lens`);
      }
      const conflict = createOnly
        ? "ON CONFLICT(lens_id,key) DO NOTHING"
        : `ON CONFLICT(lens_id,key) DO UPDATE SET name=EXCLUDED.name,
                description=EXCLUDED.description,config_version=EXCLUDED.config_version,
                config=EXCLUDED.config,updated_at=now()`;
      const result = await q.query(`INSERT INTO retriever_config
          (retriever_config_id,lens_id,key,name,description,config_version,config)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
          ${conflict}
          RETURNING *, retriever_config_id=$1 AS created`, [id, lensId, key, name, description, configVersion, JSON.stringify(config)]);
      if(!result.rows.length) throw new ConflictError(`Retriever '${key}' already exists in the target lens`);
      const row = camelizeRow(result.rows[0]!);
      return [row, row.created === true];
    });
  }

  async deleteRetriever(lensId: string, key: string): Promise<boolean> {
    return this.tx(async (q) => {
      await q.query("SELECT lens_id FROM lens WHERE lens_id=$1 FOR UPDATE", [lensId]);
      return (await q.query("DELETE FROM retriever_config WHERE lens_id=$1 AND key=$2", [lensId, key])).rowCount > 0;
    });
  }

  async transferRetriever(sourceLensId: string, sourceKey: string, targetLensId: string, targetKey: string, copyId: string | null, expectedConfig: string): Promise<Row> {
    return this.tx(async (q) => {
      const lenses = await q.query("SELECT lens_id FROM lens WHERE lens_id=ANY($1::uuid[]) ORDER BY lens_id FOR UPDATE", [[sourceLensId, targetLensId]]);
      if(lenses.rows.length !== new Set([sourceLensId, targetLensId]).size)
        throw new NotFoundError("Source or target lens not found");
      const source = (await q.query("SELECT * FROM retriever_config WHERE lens_id=$1 AND key=$2 FOR UPDATE", [sourceLensId, sourceKey])).rows[0];
      if(source && JSON.stringify([source.config_version, source.config]) !== expectedConfig)
        throw new ConflictError("Source retriever changed; reload before transfer");
      if(!source)
        throw new NotFoundError(`Retriever '${sourceKey}' not found`);
      if((await q.query("SELECT key FROM retriever_config WHERE lens_id=$1 AND key=$2", [targetLensId, targetKey])).rows.length)
        throw new ConflictError(`Retriever '${targetKey}' already exists in the target lens`);
      const result = copyId
        ? await q.query(`INSERT INTO retriever_config (retriever_config_id,lens_id,key,name,description,config_version,config)
              SELECT $1,$2,$3,name,description,config_version,config FROM retriever_config WHERE lens_id=$4 AND key=$5 RETURNING *`, [copyId, targetLensId, targetKey, sourceLensId, sourceKey])
        : await q.query("UPDATE retriever_config SET lens_id=$1,key=$2,updated_at=now() WHERE lens_id=$3 AND key=$4 RETURNING *", [targetLensId, targetKey, sourceLensId, sourceKey]);
      return camelizeRow(result.rows[0]!);
    });
  }

  // ------------------------------------------------------------------
  // Reserved keys
  // ------------------------------------------------------------------

  reservedEntityTypeKeys(): ReadonlySet<string> {
    return NO_RESERVED_KEYS;
  }

  reservedRelationTypeKeys(): ReadonlySet<string> {
    return NO_RESERVED_KEYS;
  }

  findReservedTypeKeysInUse(): Promise<ReservedTypeKeyInUse[]> {
    return Promise.resolve([]);
  }

  // ------------------------------------------------------------------
  // Lenses
  // ------------------------------------------------------------------

  async createLens(
    lensId: string,
    key: string,
    name: string,
    description: string | null,
  ): Promise<Row> {
    const result = await this.query(
      `INSERT INTO lens (lens_id, key, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING ${LENS_COLS}`,
      [lensId, key, name, description],
    );
    return camelizeRow(result.rows[0]!);
  }

  async listLenses(): Promise<Row[]> {
    const result = await this.query(`SELECT ${LENS_COLS} FROM lens ORDER BY name`);
    return camelizeRows(result.rows);
  }

  async getLens(lensId: string): Promise<Row | null> {
    if (!isUuid(lensId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${LENS_COLS} FROM lens WHERE lens_id = $1`,
      [lensId],
    );
    return firstRowOrNull(result.rows);
  }

  async getLensByName(name: string): Promise<Row | null> {
    const result = await this.query(`SELECT ${LENS_COLS} FROM lens WHERE name = $1`, [
      name,
    ]);
    return firstRowOrNull(result.rows);
  }

  async getLensByKey(key: string): Promise<Row | null> {
    const result = await this.query(`SELECT ${LENS_COLS} FROM lens WHERE key = $1`, [key]);
    return firstRowOrNull(result.rows);
  }

  async updateLens(
    lensId: string,
    name: string | null,
    description: string | null,
  ): Promise<Row | null> {
    if (!isUuid(lensId)) {
      return null;
    }
    const params: unknown[] = [lensId];
    const sets = buildUpdateSets(params, [
      ["name", name],
      ["description", description],
    ]);
    const result = await this.query(
      `UPDATE lens SET ${sets.join(", ")} WHERE lens_id = $1 RETURNING ${LENS_COLS}`,
      params,
    );
    return firstRowOrNull(result.rows);
  }

  /** One `DELETE`: agents, saved queries and inclusions go via CASCADE. */
  async deleteLens(lensId: string): Promise<boolean> {
    if (!isUuid(lensId)) {
      return false;
    }
    const result = await this.query(`DELETE FROM lens WHERE lens_id = $1`, [lensId]);
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Entity types
  // ------------------------------------------------------------------

  /** One transaction: the type, then its name property — the deferred
   * name-property FK is checked at commit, when both exist. */
  async createEntityType(
    entityTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
    nameProperty: NewPropertyDef,
  ): Promise<Row> {
    return this.tx(async (querier) => {
      const result = await querier.query(
        `INSERT INTO entity_type (entity_type_id, key, display_name, description, name_property)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ENTITY_TYPE_COLS}`,
        [entityTypeId, key, displayName, description, nameProperty.key],
      );
      await insertProperty(querier, entityTypeId, "EntityType", nameProperty);
      return camelizeRow(result.rows[0]!);
    });
  }

  async listEntityTypes(): Promise<Row[]> {
    const result = await this.query(`SELECT ${ENTITY_TYPE_COLS} FROM entity_type ORDER BY key`);
    return camelizeRows(result.rows);
  }

  async getEntityType(entityTypeId: string): Promise<Row | null> {
    if (!isUuid(entityTypeId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${ENTITY_TYPE_COLS} FROM entity_type WHERE entity_type_id = $1`,
      [entityTypeId],
    );
    return firstRowOrNull(result.rows);
  }

  async getEntityTypeByKey(key: string): Promise<Row | null> {
    const result = await this.query(
      `SELECT ${ENTITY_TYPE_COLS} FROM entity_type WHERE key = $1`,
      [key],
    );
    return firstRowOrNull(result.rows);
  }

  async updateEntityType(
    entityTypeId: string,
    displayName: string | null,
    description: string | null,
    nameProperty: string | null,
  ): Promise<Row | null> {
    if (!isUuid(entityTypeId)) {
      return null;
    }
    const params: unknown[] = [entityTypeId];
    const sets = buildUpdateSets(params, [
      ["display_name", displayName],
      ["description", description],
      ["name_property", nameProperty],
    ]);
    const result = await this.query(
      `UPDATE entity_type SET ${sets.join(", ")}
       WHERE entity_type_id = $1 RETURNING ${ENTITY_TYPE_COLS}`,
      params,
    );
    return firstRowOrNull(result.rows);
  }

  /** One `DELETE`: property definitions and inclusions go via CASCADE;
   * the endpoint FKs' RESTRICT backs the service's in-use rule. */
  async deleteEntityType(entityTypeId: string): Promise<boolean> {
    if (!isUuid(entityTypeId)) {
      return false;
    }
    const result = await this.query(`DELETE FROM entity_type WHERE entity_type_id = $1`, [
      entityTypeId,
    ]);
    return result.rowCount > 0;
  }

  async isEntityTypeReferenced(entityTypeId: string): Promise<boolean> {
    if (!isUuid(entityTypeId)) {
      return false;
    }
    const result = await this.query(
      `SELECT EXISTS (
         SELECT 1
         FROM relation_type rt
         JOIN entity_type et
           ON et.key IN (rt.source_entity_type_key, rt.target_entity_type_key)
         WHERE et.entity_type_id = $1
       ) AS referenced`,
      [entityTypeId],
    );
    return result.rows[0]!.referenced as boolean;
  }

  // ------------------------------------------------------------------
  // Relation types
  // ------------------------------------------------------------------

  async createRelationType(
    relationTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
    sourceEntityTypeKey: string,
    targetEntityTypeKey: string,
  ): Promise<Row> {
    const result = await this.query(
      `INSERT INTO relation_type
         (relation_type_id, key, display_name, description,
          source_entity_type_key, target_entity_type_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${RELATION_TYPE_COLS}`,
      [relationTypeId, key, displayName, description, sourceEntityTypeKey, targetEntityTypeKey],
    );
    return camelizeRow(result.rows[0]!);
  }

  async listRelationTypes(): Promise<Row[]> {
    const result = await this.query(
      `SELECT ${RELATION_TYPE_COLS} FROM relation_type ORDER BY key`,
    );
    return camelizeRows(result.rows);
  }

  async getRelationType(relationTypeId: string): Promise<Row | null> {
    if (!isUuid(relationTypeId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${RELATION_TYPE_COLS} FROM relation_type WHERE relation_type_id = $1`,
      [relationTypeId],
    );
    return firstRowOrNull(result.rows);
  }

  async getRelationTypeByKey(key: string): Promise<Row | null> {
    const result = await this.query(
      `SELECT ${RELATION_TYPE_COLS} FROM relation_type WHERE key = $1`,
      [key],
    );
    return firstRowOrNull(result.rows);
  }

  async updateRelationType(
    relationTypeId: string,
    displayName: string | null,
    description: string | null,
  ): Promise<Row | null> {
    if (!isUuid(relationTypeId)) {
      return null;
    }
    const params: unknown[] = [relationTypeId];
    const sets = buildUpdateSets(params, [
      ["display_name", displayName],
      ["description", description],
    ]);
    const result = await this.query(
      `UPDATE relation_type SET ${sets.join(", ")}
       WHERE relation_type_id = $1 RETURNING ${RELATION_TYPE_COLS}`,
      params,
    );
    return firstRowOrNull(result.rows);
  }

  /** One `DELETE`: property definitions and inclusions go via CASCADE. */
  async deleteRelationType(relationTypeId: string): Promise<boolean> {
    if (!isUuid(relationTypeId)) {
      return false;
    }
    const result = await this.query(`DELETE FROM relation_type WHERE relation_type_id = $1`, [
      relationTypeId,
    ]);
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Property definitions
  // ------------------------------------------------------------------

  async createProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
    key: string,
    displayName: string,
    description: string | null,
    dataType: string,
    required: boolean,
    defaultValue: string | null,
  ): Promise<Row> {
    return this.tx((querier) =>
      insertProperty(querier, ownerId, typeKind, {
        propertyId,
        key,
        displayName,
        description,
        dataType,
        required,
        defaultValue,
      }),
    );
  }

  async listProperties(ownerId: string, typeKind: TypeKind): Promise<Row[]> {
    if (!isUuid(ownerId)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${PROPERTY_COLS} FROM property_def
       WHERE ${ownerColumn(typeKind)} = $1 ORDER BY key`,
      [ownerId],
    );
    return camelizeRows(result.rows);
  }

  async getProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
  ): Promise<Row | null> {
    if (!isUuid(ownerId) || !isUuid(propertyId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${PROPERTY_COLS} FROM property_def
       WHERE ${ownerColumn(typeKind)} = $1 AND property_id = $2`,
      [ownerId, propertyId],
    );
    return firstRowOrNull(result.rows);
  }

  async getPropertyByKey(ownerId: string, typeKind: TypeKind, key: string): Promise<Row | null> {
    if (!isUuid(ownerId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${PROPERTY_COLS} FROM property_def
       WHERE ${ownerColumn(typeKind)} = $1 AND key = $2`,
      [ownerId, key],
    );
    return firstRowOrNull(result.rows);
  }

  async updateProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
    displayName: string | null,
    description: string | null,
    required: boolean | null,
    defaultValue: string | null,
    clearDefault: boolean,
  ): Promise<Row | null> {
    if (!isUuid(ownerId) || !isUuid(propertyId)) {
      return null;
    }
    const params: unknown[] = [ownerId, propertyId];
    const sets = buildUpdateSets(params, [
      ["display_name", displayName],
      ["description", description],
      ["required", required],
      ["default_value", clearDefault ? null : defaultValue],
    ]);
    if (clearDefault) {
      sets.push("default_value = NULL");
    }
    const result = await this.query(
      `UPDATE property_def SET ${sets.join(", ")}
       WHERE ${ownerColumn(typeKind)} = $1 AND property_id = $2
       RETURNING ${PROPERTY_COLS}`,
      params,
    );
    return firstRowOrNull(result.rows);
  }

  async deleteProperty(ownerId: string, typeKind: TypeKind, propertyId: string): Promise<boolean> {
    if (!isUuid(ownerId) || !isUuid(propertyId)) {
      return false;
    }
    const result = await this.query(
      `DELETE FROM property_def WHERE property_id = $2 AND ${ownerColumn(typeKind)} = $1`,
      [ownerId, propertyId],
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Scope inclusions (lifecycle)
  // ------------------------------------------------------------------

  /** Upsert on the composite unique — re-adding the same type replaces
   * the allowlist. Answers null when the lens or type is missing
   * (the `INSERT … SELECT` finds no source row). */
  async addIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeKey: string,
    properties: string[] | null,
  ): Promise<Row | null> {
    if (!isUuid(lensId)) {
      return null;
    }
    const owner = ownerColumn(typeKind);
    const result = await this.query(
      `INSERT INTO lens_includes (lens_id, ${owner}, properties)
       SELECT o.lens_id, t.${owner}, $3::text[]
       FROM lens o
       JOIN ${typeTable(typeKind)} t ON t.key = $2
       WHERE o.lens_id = $1
       ON CONFLICT (lens_id, ${owner}) DO UPDATE SET properties = EXCLUDED.properties
       RETURNING ${owner} AS type_id, properties`,
      [lensId, typeKey, properties],
    );
    const row = result.rows[0];
    return row ? toIncludeRow({ ...row, key: typeKey }) : null;
  }

  async listIncludesTypes(lensId: string, typeKind: TypeKind): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const owner = ownerColumn(typeKind);
    const result = await this.query(
      `SELECT t.key AS key, t.${owner} AS type_id, oi.properties AS properties
       FROM lens_includes oi
       JOIN ${typeTable(typeKind)} t ON t.${owner} = oi.${owner}
       WHERE oi.lens_id = $1
       ORDER BY t.key`,
      [lensId],
    );
    return result.rows.map(toIncludeRow);
  }

  /** Replace the properties allowlist on one inclusion. */
  async updateIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeId: string,
    properties: string[] | null,
  ): Promise<Row | null> {
    if (!isUuid(lensId) || !isUuid(typeId)) {
      return null;
    }
    const owner = ownerColumn(typeKind);
    const result = await this.query(
      `UPDATE lens_includes oi
       SET properties = $3::text[]
       FROM ${typeTable(typeKind)} t
       WHERE oi.lens_id = $1 AND oi.${owner} = $2 AND t.${owner} = oi.${owner}
       RETURNING t.key AS key, oi.${owner} AS type_id, oi.properties AS properties`,
      [lensId, typeId, properties],
    );
    const row = result.rows[0];
    return row ? toIncludeRow(row) : null;
  }

  async removeIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeId: string,
  ): Promise<boolean> {
    if (!isUuid(lensId) || !isUuid(typeId)) {
      return false;
    }
    const result = await this.query(
      `DELETE FROM lens_includes
       WHERE lens_id = $1 AND ${ownerColumn(typeKind)} = $2`,
      [lensId, typeId],
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Scope inclusions (cascade-protocol support)
  // ------------------------------------------------------------------

  async removeAllIncludesForType(typeKind: TypeKind, typeId: string): Promise<number> {
    if (!isUuid(typeId)) {
      return 0;
    }
    const result = await this.query(
      `DELETE FROM lens_includes WHERE ${ownerColumn(typeKind)} = $1`,
      [typeId],
    );
    return result.rowCount;
  }

  async findLensesIncludingType(typeKind: TypeKind, typeId: string): Promise<string[]> {
    if (!isUuid(typeId)) {
      return [];
    }
    const result = await this.query(
      `SELECT o.key FROM lens_includes oi
       JOIN lens o ON o.lens_id = oi.lens_id
       WHERE oi.${ownerColumn(typeKind)} = $1
       ORDER BY o.key`,
      [typeId],
    );
    return result.rows.map((row) => row.key as string);
  }

  /** Lens keys whose explicit allowlist for the type does NOT carry
   * the property key; lenses without an allowlist track automatically
   * and are never affected. */
  async findLensesWithExplicitProperty(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<string[]> {
    if (!isUuid(typeId)) {
      return [];
    }
    const result = await this.query(
      `SELECT o.key FROM lens_includes oi
       JOIN lens o ON o.lens_id = oi.lens_id
       WHERE oi.${ownerColumn(typeKind)} = $1
         AND oi.properties IS NOT NULL
         AND NOT (oi.properties @> ARRAY[$2::text])
       ORDER BY o.key`,
      [typeId, propertyKey],
    );
    return result.rows.map((row) => row.key as string);
  }

  async addPropertyToIncludesLists(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<number> {
    if (!isUuid(typeId)) {
      return 0;
    }
    const result = await this.query(
      `UPDATE lens_includes SET properties = properties || $2::text
       WHERE ${ownerColumn(typeKind)} = $1
         AND properties IS NOT NULL
         AND NOT (properties @> ARRAY[$2::text])`,
      [typeId, propertyKey],
    );
    return result.rowCount;
  }

  async removePropertyFromIncludesLists(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<number> {
    if (!isUuid(typeId)) {
      return 0;
    }
    const result = await this.query(
      `UPDATE lens_includes SET properties = array_remove(properties, $2::text)
       WHERE ${ownerColumn(typeKind)} = $1
         AND properties IS NOT NULL
         AND properties @> ARRAY[$2::text]`,
      [typeId, propertyKey],
    );
    return result.rowCount;
  }

  // ------------------------------------------------------------------
  // Full schema
  // ------------------------------------------------------------------

  /** The ontology's entire schema plus every lens with its inclusions, read
   * as one coherent snapshot: a single REPEATABLE READ transaction. */
  async getFullSchema(): Promise<Row> {
    return this.tx(async (querier) => {
      const { entityTypes, relationTypes } = await readTypesWithProperties(querier, true);

      const lensResult = await querier.query(`SELECT ${LENS_COLS} FROM lens ORDER BY name`);
      const incs = await querier.query(
        `SELECT oi.lens_id, oi.properties,
                et.key AS entity_type_key, rt.key AS relation_type_key
         FROM lens_includes oi
         LEFT JOIN entity_type et ON et.entity_type_id = oi.entity_type_id
         LEFT JOIN relation_type rt ON rt.relation_type_id = oi.relation_type_id
         WHERE oi.search_index_id IS NULL
         ORDER BY et.key, rt.key`,
      );

      const incsByLens = new Map<string, Row[]>();
      for (const raw of incs.rows) {
        const lensId = raw.lens_id as string;
        const bucket = incsByLens.get(lensId) ?? [];
        bucket.push(raw);
        incsByLens.set(lensId, bucket);
      }

      const lenses = lensResult.rows.map((raw) => {
        const lens = camelizeRow(raw);
        const { entityInclusions, relationInclusions } = splitInclusions(
          incsByLens.get(lens.lensId as string) ?? [],
        );
        lens.entityInclusions = entityInclusions;
        lens.relationInclusions = relationInclusions;
        return lens;
      });

      return { entityTypes, relationTypes, lenses };
    }, "REPEATABLE READ");
  }

  // ------------------------------------------------------------------
  // AI agent configs
  // ------------------------------------------------------------------

  async listAiAgents(lensId: string): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${AGENT_COLS} FROM ai_agent_config WHERE lens_id = $1 ORDER BY name`,
      [lensId],
    );
    return camelizeRows(result.rows);
  }

  /** Upsert on the `(lens_id, key)` arbiter. `created` is detected
   * by whether the insert stamped this call's fresh id onto the row. */
  async upsertAiAgent(
    lensId: string,
    agentConfigId: string,
    key: string,
    name: string,
    description: string | null,
    systemPrompt: string | null,
    tools: string[] | null,
  ): Promise<[Row, boolean]> {
    const result = await this.query(
      `INSERT INTO ai_agent_config
         (agent_config_id, lens_id, key, name, description, system_prompt, tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lens_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         system_prompt = EXCLUDED.system_prompt,
         tools = EXCLUDED.tools,
         updated_at = now()
       RETURNING ${AGENT_COLS}, (agent_config_id = $1) AS created`,
      [agentConfigId, lensId, key, name, description, systemPrompt, tools],
    );
    const { created, ...row } = camelizeRow(result.rows[0]!);
    return [row, created as boolean];
  }

  /** Agents in the transfer shape — no ids, no timestamps. */
  async listAiAgentsForExport(lensId: string): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const result = await this.query(
      `SELECT key, name, description, system_prompt, tools
       FROM ai_agent_config WHERE lens_id = $1 ORDER BY name`,
      [lensId],
    );
    return camelizeRows(result.rows);
  }

  async deleteAiAgent(lensId: string, agentKey: string): Promise<boolean> {
    if (!isUuid(lensId)) {
      return false;
    }
    const result = await this.query(
      `DELETE FROM ai_agent_config WHERE lens_id = $1 AND key = $2`,
      [lensId, agentKey],
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Saved query configs
  // ------------------------------------------------------------------

  async listSavedQueries(lensId: string): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${SAVED_QUERY_COLS} FROM saved_query WHERE lens_id = $1 ORDER BY name`,
      [lensId],
    );
    return camelizeRows(result.rows);
  }

  /** Saved queries in the transfer shape (key, name, description, plus
   * the stored steps/parameters JSON text) — no ids, no timestamps. */
  async listSavedQueriesForExport(lensId: string): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const result = await this.query(
      `SELECT key, name, description, steps, parameters
       FROM saved_query WHERE lens_id = $1 ORDER BY name`,
      [lensId],
    );
    return camelizeRows(result.rows);
  }

  /** Upsert on the `(lens_id, key)` arbiter. Steps and parameters
   * arrive as serialized text this store does not interpret. A null
   * `lensKey` or `embedding` leaves the stored value untouched
   * (COALESCE), mirroring the reference adapter's conditional SET. */
  async upsertSavedQuery(
    lensId: string,
    savedQueryId: string,
    key: string,
    name: string,
    description: string,
    stepsJson: string,
    parametersJson: string,
    lensKey: string | null = null,
    embedding: number[] | null = null,
  ): Promise<[Row, boolean]> {
    const result = await this.query(
      `INSERT INTO saved_query
         (saved_query_id, lens_id, lens_key, key, name, description,
          steps, parameters, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
       ON CONFLICT (lens_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         steps = EXCLUDED.steps,
         parameters = EXCLUDED.parameters,
         lens_key = COALESCE(EXCLUDED.lens_key, saved_query.lens_key),
         embedding = COALESCE(EXCLUDED.embedding, saved_query.embedding),
         updated_at = now()
       RETURNING ${SAVED_QUERY_COLS}, (saved_query_id = $1) AS created`,
      [
        savedQueryId,
        lensId,
        lensKey,
        key,
        name,
        description,
        stepsJson,
        parametersJson,
        embedding === null ? null : toSql(embedding),
      ],
    );
    const { created, ...row } = camelizeRow(result.rows[0]!);
    return [row, created as boolean];
  }

  async deleteSavedQuery(lensId: string, queryKey: string): Promise<boolean> {
    if (!isUuid(lensId)) {
      return false;
    }
    const result = await this.query(
      `DELETE FROM saved_query WHERE lens_id = $1 AND key = $2`,
      [lensId, queryKey],
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Embedding maintenance (rebuild support)
  // ------------------------------------------------------------------

  async listSavedQueryRefs(): Promise<Row[]> {
    const result = await this.query(`SELECT saved_query_id, description FROM saved_query`);
    return camelizeRows(result.rows);
  }

  /** No `updated_at` stamp: re-embedding is not a content change, and the
   * reference adapter leaves the timestamp untouched here too. */
  async setSavedQueryEmbedding(savedQueryId: string, embedding: number[]): Promise<void> {
    if (!isUuid(savedQueryId)) {
      return;
    }
    await this.query(`UPDATE saved_query SET embedding = $2::vector WHERE saved_query_id = $1`, [
      savedQueryId,
      toSql(embedding),
    ]);
  }

  // ------------------------------------------------------------------
  // Saved-query vector index — `ddl.ts`'s, the whole inventory here
  // ------------------------------------------------------------------

  ensureSavedQueryVectorIndex(dimensions: number): Promise<void> {
    return vectorDdl.ensureSavedQueryVectorIndex(dimensions, this.namespace);
  }

  dropMismatchedVectorIndexes(dimensions: number): Promise<void> {
    return vectorDdl.dropMismatchedSavedQueryVectorIndex(dimensions, this.namespace);
  }

  ensureVectorIndexes(dimensions: number): Promise<void> {
    return vectorDdl.ensureSavedQueryVectorIndex(dimensions, this.namespace);
  }
}
