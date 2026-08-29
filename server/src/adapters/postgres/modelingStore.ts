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
 *   one exception is `getFullSchema`, whose coherent-snapshot obligation
 *   is honoured with one REPEATABLE READ transaction through
 *   `withTransaction`.
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
 *   updates). The two embedding setters deliberately do not — the
 *   reference adapter leaves `updatedAt` untouched there.
 * - Ids from the wire pass the strict `isUuid()` guard (`rows.ts`)
 *   before any statement; off-format input short-circuits to the
 *   method's not-found shape.
 *
 * The seven vector-index lifecycle methods are `ddl.ts`'s — physical
 * naming and index DDL live there, beside the init DDL.
 */

import { toSql } from "pgvector";

import type { ModelingStore, ReservedTypeKeyInUse, Row } from "../../core/ports.js";
import type { TypeKind } from "../../core/schemas.js";
import * as vectorDdl from "./ddl.js";
import { runQuery, withTransaction } from "./errors.js";
import { camelizeRow, camelizeRows, isUuid } from "./rows.js";
import { LENS_COLS, readTypesWithProperties, splitInclusions } from "./schemaRead.js";

const NO_RESERVED_KEYS: ReadonlySet<string> = new Set();

// Read column lists — the port-visible shape of each object; owner ids,
// denormalized keys, and embeddings stay out of returned rows.
// (`LENS_COLS` comes from `schemaRead.ts`, shared with the runtime store.)
const ENTITY_TYPE_COLS = "entity_type_id, key, display_name, description, created_at, updated_at";
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

export class PostgresModelingStore implements ModelingStore {
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
    const result = await runQuery(
      `INSERT INTO lens (lens_id, key, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING ${LENS_COLS}`,
      [lensId, key, name, description],
    );
    return camelizeRow(result.rows[0]!);
  }

  async listLenses(): Promise<Row[]> {
    const result = await runQuery(`SELECT ${LENS_COLS} FROM lens ORDER BY name`);
    return camelizeRows(result.rows);
  }

  async getLens(lensId: string): Promise<Row | null> {
    if (!isUuid(lensId)) {
      return null;
    }
    const result = await runQuery(
      `SELECT ${LENS_COLS} FROM lens WHERE lens_id = $1`,
      [lensId],
    );
    return firstRowOrNull(result.rows);
  }

  async getLensByName(name: string): Promise<Row | null> {
    const result = await runQuery(`SELECT ${LENS_COLS} FROM lens WHERE name = $1`, [
      name,
    ]);
    return firstRowOrNull(result.rows);
  }

  async getLensByKey(key: string): Promise<Row | null> {
    const result = await runQuery(`SELECT ${LENS_COLS} FROM lens WHERE key = $1`, [key]);
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
    const result = await runQuery(
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
    const result = await runQuery(`DELETE FROM lens WHERE lens_id = $1`, [lensId]);
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Entity types
  // ------------------------------------------------------------------

  async createEntityType(
    entityTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
  ): Promise<Row> {
    const result = await runQuery(
      `INSERT INTO entity_type (entity_type_id, key, display_name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING ${ENTITY_TYPE_COLS}`,
      [entityTypeId, key, displayName, description],
    );
    return camelizeRow(result.rows[0]!);
  }

  async listEntityTypes(): Promise<Row[]> {
    const result = await runQuery(`SELECT ${ENTITY_TYPE_COLS} FROM entity_type ORDER BY key`);
    return camelizeRows(result.rows);
  }

  async getEntityType(entityTypeId: string): Promise<Row | null> {
    if (!isUuid(entityTypeId)) {
      return null;
    }
    const result = await runQuery(
      `SELECT ${ENTITY_TYPE_COLS} FROM entity_type WHERE entity_type_id = $1`,
      [entityTypeId],
    );
    return firstRowOrNull(result.rows);
  }

  async getEntityTypeByKey(key: string): Promise<Row | null> {
    const result = await runQuery(
      `SELECT ${ENTITY_TYPE_COLS} FROM entity_type WHERE key = $1`,
      [key],
    );
    return firstRowOrNull(result.rows);
  }

  async updateEntityType(
    entityTypeId: string,
    displayName: string | null,
    description: string | null,
  ): Promise<Row | null> {
    if (!isUuid(entityTypeId)) {
      return null;
    }
    const params: unknown[] = [entityTypeId];
    const sets = buildUpdateSets(params, [
      ["display_name", displayName],
      ["description", description],
    ]);
    const result = await runQuery(
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
    const result = await runQuery(`DELETE FROM entity_type WHERE entity_type_id = $1`, [
      entityTypeId,
    ]);
    return result.rowCount > 0;
  }

  async isEntityTypeReferenced(entityTypeId: string): Promise<boolean> {
    if (!isUuid(entityTypeId)) {
      return false;
    }
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
      `SELECT ${RELATION_TYPE_COLS} FROM relation_type ORDER BY key`,
    );
    return camelizeRows(result.rows);
  }

  async getRelationType(relationTypeId: string): Promise<Row | null> {
    if (!isUuid(relationTypeId)) {
      return null;
    }
    const result = await runQuery(
      `SELECT ${RELATION_TYPE_COLS} FROM relation_type WHERE relation_type_id = $1`,
      [relationTypeId],
    );
    return firstRowOrNull(result.rows);
  }

  async getRelationTypeByKey(key: string): Promise<Row | null> {
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(`DELETE FROM relation_type WHERE relation_type_id = $1`, [
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
    const result = await runQuery(
      `INSERT INTO property_def
         (property_id, entity_type_id, relation_type_id, key, display_name,
          description, data_type, required, default_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${PROPERTY_COLS}`,
      [
        propertyId,
        typeKind === "EntityType" ? ownerId : null,
        typeKind === "RelationType" ? ownerId : null,
        key,
        displayName,
        description,
        dataType,
        required,
        defaultValue,
      ],
    );
    return camelizeRow(result.rows[0]!);
  }

  async listProperties(ownerId: string, typeKind: TypeKind): Promise<Row[]> {
    if (!isUuid(ownerId)) {
      return [];
    }
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
      `DELETE FROM lens_includes WHERE ${ownerColumn(typeKind)} = $1`,
      [typeId],
    );
    return result.rowCount;
  }

  async findLensesIncludingType(typeKind: TypeKind, typeId: string): Promise<string[]> {
    if (!isUuid(typeId)) {
      return [];
    }
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
      `UPDATE lens_includes SET properties = array_remove(properties, $2::text)
       WHERE ${ownerColumn(typeKind)} = $1
         AND properties IS NOT NULL
         AND properties @> ARRAY[$2::text]`,
      [typeId, propertyKey],
    );
    return result.rowCount;
  }

  // ------------------------------------------------------------------
  // Document-property cleanup
  // ------------------------------------------------------------------

  /** The chunk schema-cascade: called by the service's vector hook after
   * `deleteProperty`; type keys carry no FK by design, so this is the
   * one statement that removes a dropped document property's chunks. */
  async deleteChunksForTypeProperty(entityTypeKey: string, propertyKey: string): Promise<void> {
    await runQuery(
      `DELETE FROM document_chunk WHERE entity_type_key = $1 AND property_key = $2`,
      [entityTypeKey, propertyKey],
    );
  }

  // ------------------------------------------------------------------
  // Full schema
  // ------------------------------------------------------------------

  /** The entire global schema plus every lens with its inclusions, read
   * as one coherent snapshot: a single REPEATABLE READ transaction. */
  async getFullSchema(): Promise<Row> {
    return withTransaction(async (querier) => {
      const { entityTypes, relationTypes } = await readTypesWithProperties(querier, true);

      const lensResult = await querier.query(`SELECT ${LENS_COLS} FROM lens ORDER BY name`);
      const incs = await querier.query(
        `SELECT oi.lens_id, oi.properties,
                et.key AS entity_type_key, rt.key AS relation_type_key
         FROM lens_includes oi
         LEFT JOIN entity_type et ON et.entity_type_id = oi.entity_type_id
         LEFT JOIN relation_type rt ON rt.relation_type_id = oi.relation_type_id
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
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
    const result = await runQuery(
      `DELETE FROM saved_query WHERE lens_id = $1 AND key = $2`,
      [lensId, queryKey],
    );
    return result.rowCount > 0;
  }

  // ------------------------------------------------------------------
  // Embedding maintenance (rebuild support)
  // ------------------------------------------------------------------

  /** Every entity type key with its property definitions, aggregated in
   * one statement (jsonb) so the read stays on door one. */
  async getEntityTypesWithProperties(): Promise<Row[]> {
    const result = await runQuery(
      `SELECT et.key,
              coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'propertyId', p.property_id,
                    'key', p.key,
                    'displayName', p.display_name,
                    'description', p.description,
                    'dataType', p.data_type,
                    'required', p.required,
                    'defaultValue', p.default_value
                  ) ORDER BY p.key
                ) FILTER (WHERE p.property_id IS NOT NULL),
                '[]'::jsonb
              ) AS properties
       FROM entity_type et
       LEFT JOIN property_def p ON p.entity_type_id = et.entity_type_id
       GROUP BY et.key
       ORDER BY et.key`,
    );
    return result.rows;
  }

  /** No `updated_at` stamp: re-embedding is not a content change, and the
   * reference adapter leaves the timestamp untouched here too. */
  async setEntityEmbedding(entityId: string, embedding: number[]): Promise<void> {
    if (!isUuid(entityId)) {
      return;
    }
    await runQuery(`UPDATE entity SET embedding = $2::vector WHERE id = $1`, [
      entityId,
      toSql(embedding),
    ]);
  }

  async listSavedQueryRefs(): Promise<Row[]> {
    const result = await runQuery(`SELECT saved_query_id, description FROM saved_query`);
    return camelizeRows(result.rows);
  }

  /** No `updated_at` stamp — as `setEntityEmbedding`. */
  async setSavedQueryEmbedding(savedQueryId: string, embedding: number[]): Promise<void> {
    if (!isUuid(savedQueryId)) {
      return;
    }
    await runQuery(`UPDATE saved_query SET embedding = $2::vector WHERE saved_query_id = $1`, [
      savedQueryId,
      toSql(embedding),
    ]);
  }

  // ------------------------------------------------------------------
  // Vector-index DDL — every method is `ddl.ts`'s, unchanged
  // ------------------------------------------------------------------

  createVectorIndex(
    entityTypeKey: string,
    dimensions: number,
    filterProperties?: string[] | null,
  ): Promise<void> {
    return vectorDdl.createVectorIndex(entityTypeKey, dimensions, filterProperties);
  }

  dropVectorIndex(entityTypeKey: string): Promise<void> {
    return vectorDdl.dropVectorIndex(entityTypeKey);
  }

  rebuildVectorIndex(entityTypeKey: string, dimensions: number): Promise<void> {
    return vectorDdl.rebuildVectorIndex(entityTypeKey, dimensions);
  }

  createDocumentVectorIndex(
    entityTypeKey: string,
    propertyKey: string,
    dimensions: number,
  ): Promise<void> {
    return vectorDdl.createDocumentVectorIndex(entityTypeKey, propertyKey, dimensions);
  }

  dropDocumentVectorIndex(entityTypeKey: string, propertyKey: string): Promise<void> {
    return vectorDdl.dropDocumentVectorIndex(entityTypeKey, propertyKey);
  }

  ensureSavedQueryVectorIndex(dimensions: number): Promise<void> {
    return vectorDdl.ensureSavedQueryVectorIndex(dimensions);
  }

  ensureVectorIndexes(dimensions: number, recreateOnMismatch?: boolean): Promise<void> {
    return vectorDdl.ensureVectorIndexes(dimensions, recreateOnMismatch);
  }
}
