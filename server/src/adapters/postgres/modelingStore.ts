/**
 * `ModelingStore` on PostgreSQL.
 *
 * Operation mapping:
 *
 * - Every method is a single statement through the `runQuery` door; the
 *   exceptions are `getFullSchema`, whose coherent-snapshot obligation
 *   is honoured with one REPEATABLE READ transaction through
 *   `withTransaction`, `createEntityType`, which writes the type and
 *   its name property in one transaction, and the relation rules writes
 *   (`createRelationType`, `setRelationTypeRules`), which count the
 *   violators of the rules they set and then write, or refuse, in one
 *   transaction.
 * - Deletes are one `DELETE` each, `rowCount > 0` as the boolean —
 *   `ON DELETE CASCADE` carries the fan-out (property definitions,
 *   inclusions, agents, saved queries), and the endpoint FKs' `ON DELETE RESTRICT` backs the
 *   service's in-use rule.
 * - Upserts (agents, saved queries, re-added inclusions) ride
 *   `INSERT … ON CONFLICT … DO UPDATE` on the composite uniques, with
 *   `RETURNING (id = $freshId) AS created` as the created-detection.
 * - Every UPDATE that stamps `updatedAt` sets `updated_at = now()`
 *   explicitly (no triggers; advances on no-op updates).
 * - Ids from the wire pass the strict `isUuid()` guard (`rows.ts`)
 *   before any statement; off-format input short-circuits to the
 *   method's not-found shape.
 *
 * - `changeDesign` opens one transaction that holds the design
 *   exclusively and advances its revision (`design.ts`), and hands its
 *   work a store bound to that connection: every method above, and the
 *   search-index and navigator stores it hands out, run on it. Bound,
 *   `getFullSchema` reads at READ COMMITTED: the exclusive hold keeps the
 *   design still.
 *
 * The saved-query index methods are `ddl.ts`'s — physical naming and
 * index DDL live there, beside the init DDL. The vector-index inventory
 * is the saved-query index alone; search-index generations keep their
 * own (`searchIndexStore.ts`).
 */


import { toSql } from "pgvector";

import type {
  ModelingStore,
  NavigatorStore,
  RelationRule,
  RelationRules,
  RelationRulesWrite,
  RelationRuleViolation,
  Row,
  SearchIndexStore,
} from "../../core/ports.js";
import type { NewPropertyDef, ParentEnd, TypeKind } from "../../core/schemas.js";
import * as vectorDdl from "./ddl.js";
import { advanceDesign, holdDesignExclusive } from "./design.js";
import {
  IDENTITY_UNIQUE,
  runQuery,
  withBoundTransaction,
  withTransaction,
  type DbResult,
  type IsolationLevel,
  type Querier,
} from "./errors.js";
import { camelizeRow, camelizeRows, isUuid } from "./rows.js";
import { LENS_COLS, readTypesWithProperties, splitInclusions } from "./schemaRead.js";
import { PostgresNavigatorStore } from "./navigatorStore.js";
import { PostgresSearchIndexStore } from "./searchIndexStore.js";

// Read column lists — the port-visible shape of each object; owner ids,
// denormalized keys, and embeddings stay out of returned rows.
// (`LENS_COLS` comes from `schemaRead.ts`, shared with the runtime store.)
const ENTITY_TYPE_COLS =
  "entity_type_id, key, display_name, description, name_property, identity_properties, " +
  "created_at, updated_at";
const RELATION_TYPE_COLS =
  "relation_type_id, key, display_name, description, " +
  "source_entity_type_key, target_entity_type_key, parent, " +
  // A parent end always holds one per pair, whatever the column says.
  "(one_per_pair OR parent IS NOT NULL) AS one_per_pair, created_at, updated_at";
const PROPERTY_COLS =
  "property_id, key, display_name, description, data_type, required, default_value, " +
  "created_at, updated_at";
const AGENT_COLS =
  "assistant_agent_id, key, name, description, system_prompt, tools, created_at, updated_at";
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

/** The most violators of one relation rule a refusal names. */
const VIOLATORS_SHOWN = 5;

/**
 * The violators of the parent rules under a reading of the stored
 * relations: every stored parent relation, with each key of `readings`
 * replacing its stored flag. Each relation row of a parent relation is an
 * edge from child to parent. An entity with more than one edge has two
 * parents; an entity whose upward walk reaches itself is on a cycle. The
 * walk stops at a node already on its path, so it ends on any data, and
 * it starts only at entities that are a parent too, since a cycle passes
 * through no leaf. The first violators of each rule carry their type
 * from `entity`; only rules with violators come back.
 */
async function parentViolations(
  querier: Querier,
  readings: Record<string, ParentEnd>,
): Promise<RelationRuleViolation[]> {
  const keys = Object.keys(readings);
  const result = await querier.query(
    `WITH RECURSIVE reading (type_key, parent) AS (
       SELECT key, parent FROM relation_type
        WHERE parent IS NOT NULL AND NOT (key = ANY($1::text[]))
       UNION ALL
       SELECT * FROM unnest($1::text[], $2::text[])
     ),
     edge (child_id, parent_id) AS (
       SELECT CASE WHEN g.parent = 'source' THEN r.to_id ELSE r.from_id END,
              CASE WHEN g.parent = 'source' THEN r.from_id ELSE r.to_id END
         FROM relation r JOIN reading g ON g.type_key = r.type_key
     ),
     walk (start_id, node_id, path) AS (
       SELECT child_id, parent_id, ARRAY[child_id] FROM edge
        WHERE child_id IN (SELECT parent_id FROM edge)
       UNION ALL
       SELECT w.start_id, e.parent_id, w.path || w.node_id
         FROM walk w JOIN edge e ON e.child_id = w.node_id
        WHERE NOT (w.node_id = ANY(w.path))
     ),
     violator (rank, rule, id) AS (
       SELECT 1, 'two_parents'::text, child_id FROM edge GROUP BY child_id HAVING count(*) > 1
       UNION ALL
       SELECT DISTINCT 2, 'cycle'::text, start_id FROM walk WHERE node_id = start_id
     )
     SELECT rule, total, type_key, id FROM (
       SELECT v.rank, v.rule, v.id, e.type_key,
              count(*) OVER (PARTITION BY v.rank) AS total,
              row_number() OVER (PARTITION BY v.rank ORDER BY e.type_key, v.id) AS n
         FROM violator v JOIN entity e ON e.id = v.id
     ) ranked
     WHERE n <= $3
     ORDER BY rank, n`,
    [keys, keys.map((key) => readings[key]!), VIOLATORS_SHOWN],
  );
  return groupViolations(result.rows);
}

/** Violator rows (rule, total, type_key, id), in report order, as one
 * violation per rule. */
function groupViolations(rows: Row[]): RelationRuleViolation[] {
  const violations: RelationRuleViolation[] = [];
  for (const row of rows) {
    let violation = violations.at(-1);
    if (violation === undefined || violation.rule !== row.rule) {
      violation = { rule: row.rule as RelationRule, count: Number(row.total), entities: [] };
      violations.push(violation);
    }
    violation.entities.push({ type: row.type_key as string, id: row.id as string });
  }
  return violations;
}

/**
 * The pairs the stored relations of `keys` link more than once under one
 * key, as one `duplicate_pair` violation: their count and the sources of
 * the first pairs, ordered by type and id. Empty when there are none.
 */
async function duplicatePairs(querier: Querier, keys: string[]): Promise<RelationRuleViolation[]> {
  if (keys.length === 0) return [];
  const result = await querier.query(
    `SELECT 'duplicate_pair' AS rule, total, type_key, id FROM (
       SELECT e.type_key, d.from_id AS id,
              count(*) OVER () AS total,
              row_number() OVER (ORDER BY e.type_key, d.from_id, d.to_id) AS n
         FROM (SELECT from_id, to_id FROM relation WHERE type_key = ANY($1::text[])
                GROUP BY type_key, from_id, to_id HAVING count(*) > 1) d
         JOIN entity e ON e.id = d.from_id
     ) ranked
     WHERE n <= $2
     ORDER BY n`,
    [keys, VIOLATORS_SHOWN],
  );
  return groupViolations(result.rows);
}

/** The violators a rules write refuses with: the parent rules when it
 * sets or flips the parent end, one per pair when it turns that on. */
async function rulesViolations(
  querier: Querier,
  key: string,
  before: RelationRules,
  after: RelationRules,
): Promise<RelationRuleViolation[]> {
  const violations: RelationRuleViolation[] = [];
  if (after.parent !== null && after.parent !== before.parent) {
    violations.push(...(await parentViolations(querier, { [key]: after.parent })));
  }
  // A parent end checked just now already refuses a pair linked twice,
  // as a child with two parents.
  if (after.onePerPair && !before.onePerPair && violations.length === 0) {
    violations.push(...(await duplicatePairs(querier, [key])));
  }
  return violations;
}

/** The rules a relation type row carries. */
function rulesOf(row: Row): RelationRules {
  return { parent: (row.parent as ParentEnd | null) ?? null, onePerPair: row.onePerPair === true };
}

export class PostgresModelingStore implements ModelingStore {
  /** Bound to one ontology's namespace; unbound (tests only) runs against
   * the connection's default namespace. `bound`: the connection of the
   * design change `changeDesign` opened. */
  constructor(
    private readonly namespace?: string,
    private readonly ontologyKey: string = "",
    private readonly bound?: Querier,
  ) {}

  /** The search-index store of the same ontology. */
  searchIndices(): SearchIndexStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound modeling store has no search indices");
    }
    return new PostgresSearchIndexStore(this.namespace, this.ontologyKey, this.bound);
  }

  navigators(): NavigatorStore {
    if (this.namespace === undefined) {
      throw new Error("An unbound modeling store has no navigators");
    }
    return new PostgresNavigatorStore(this.namespace, this.bound);
  }

  changeDesign<T>(work: (store: ModelingStore) => Promise<T>): Promise<T> {
    if (this.bound !== undefined) return work(this);
    return withBoundTransaction(async (querier) => {
      await holdDesignExclusive(querier);
      await advanceDesign(querier);
      return work(new PostgresModelingStore(this.namespace, this.ontologyKey, querier));
    }, this.namespace);
  }

  /** Door one, carrying this store's binding. */
  private query(text: string, params?: unknown[]): Promise<DbResult> {
    if (this.bound !== undefined) return this.bound.query(text, params);
    return runQuery(text, params, this.namespace);
  }

  /** Door two, carrying this store's binding. A bound store runs `work`
   * on its own transaction, whatever the isolation asked for. */
  private tx<T>(
    work: (querier: Querier) => Promise<T>,
    isolation: IsolationLevel = "READ COMMITTED",
  ): Promise<T> {
    if (this.bound !== undefined) return work(this.bound);
    return withTransaction(work, isolation, this.namespace);
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
   * the endpoint FKs' RESTRICT backs the service's in-use rule. The
   * orphaned entities lose their identity in the same transaction, so
   * they never block a later type of the same key. */
  async deleteEntityType(entityTypeId: string): Promise<boolean> {
    if (!isUuid(entityTypeId)) {
      return false;
    }
    return this.tx(async (querier) => {
      const result = await querier.query(
        `DELETE FROM entity_type WHERE entity_type_id = $1 RETURNING key`,
        [entityTypeId],
      );
      const deleted = result.rows[0];
      if (deleted === undefined) return false;
      await querier.query(
        `UPDATE entity SET identity = NULL WHERE type_key = $1 AND identity IS NOT NULL`,
        [deleted.key],
      );
      return true;
    });
  }

  async setEntityTypeIdentity(
    entityTypeId: string,
    identityProperties: string[] | null,
  ): Promise<Row | null> {
    if (!isUuid(entityTypeId)) {
      return null;
    }
    const result = await this.query(
      `UPDATE entity_type SET identity_properties = $2, updated_at = now()
       WHERE entity_type_id = $1 RETURNING ${ENTITY_TYPE_COLS}`,
      [entityTypeId, identityProperties],
    );
    return firstRowOrNull(result.rows);
  }

  /** The values one at a time from the jsonb, so no document is read. */
  async readEntityValues(entityTypeKey: string, propertyKeys: string[]): Promise<{ id: string; values: Row }[]> {
    const result = await this.query(
      `SELECT id, (SELECT coalesce(jsonb_object_agg(k, props -> k), '{}'::jsonb)
                     FROM unnest($2::text[]) AS k WHERE props ? k) AS values
         FROM entity WHERE type_key = $1 ORDER BY id`,
      [entityTypeKey, propertyKeys],
    );
    return result.rows.map((row) => ({ id: row.id as string, values: row.values as Row }));
  }

  /** One statement per call: the identities as two parallel arrays. The
   * unique constraint is deferred to the end of the design change, so a
   * rewrite that swaps two identities passes. */
  async writeEntityIdentities(
    entityTypeKey: string,
    identities: { id: string; identity: string }[] | null,
  ): Promise<void> {
    if (identities === null) {
      await this.query(`UPDATE entity SET identity = NULL WHERE type_key = $1 AND identity IS NOT NULL`, [
        entityTypeKey,
      ]);
      return;
    }
    await this.tx(async (querier) => {
      await querier.query(`SET CONSTRAINTS ${IDENTITY_UNIQUE} DEFERRED`);
      await querier.query(
        `UPDATE entity e SET identity = w.identity
           FROM unnest($2::uuid[], $3::text[]) AS w (id, identity)
          WHERE e.id = w.id AND e.type_key = $1 AND e.identity IS DISTINCT FROM w.identity`,
        [entityTypeKey, identities.map((entry) => entry.id), identities.map((entry) => entry.identity)],
      );
    });
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
    rules: RelationRules,
  ): Promise<RelationRulesWrite> {
    return this.tx(async (querier) => {
      const violations = await rulesViolations(querier, key, { parent: null, onePerPair: false }, rules);
      if (violations.length > 0) {
        return { violations };
      }
      const result = await querier.query(
        `INSERT INTO relation_type
           (relation_type_id, key, display_name, description,
            source_entity_type_key, target_entity_type_key, parent, one_per_pair)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${RELATION_TYPE_COLS}`,
        [
          relationTypeId, key, displayName, description, sourceEntityTypeKey, targetEntityTypeKey,
          rules.parent, rules.onePerPair || rules.parent !== null,
        ],
      );
      return { row: camelizeRow(result.rows[0]!) };
    });
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

  /** One transaction: the type's stored rules, the violators of the rules
   * the write sets, then the update unless there are any. Clearing skips
   * the count. No lock: a racing relation write is accepted (A3). */
  async setRelationTypeRules(
    relationTypeId: string,
    rules: RelationRules,
  ): Promise<RelationRulesWrite | null> {
    if (!isUuid(relationTypeId)) {
      return null;
    }
    return this.tx(async (querier) => {
      const found = await querier.query(
        `SELECT ${RELATION_TYPE_COLS} FROM relation_type WHERE relation_type_id = $1`,
        [relationTypeId],
      );
      const before = firstRowOrNull(found.rows);
      if (before === null) {
        return null;
      }
      const violations = await rulesViolations(querier, before.key as string, rulesOf(before), rules);
      if (violations.length > 0) {
        return { violations };
      }
      const result = await querier.query(
        `UPDATE relation_type SET parent = $2, one_per_pair = $3, updated_at = now()
         WHERE relation_type_id = $1 RETURNING ${RELATION_TYPE_COLS}`,
        [relationTypeId, rules.parent, rules.onePerPair || rules.parent !== null],
      );
      const row = firstRowOrNull(result.rows);
      return row === null ? null : { row };
    });
  }

  async findRelationRuleViolations(readings: Record<string, RelationRules>): Promise<RelationRuleViolation[]> {
    const querier: Querier = { query: (text, params) => this.query(text, params) };
    const parents: Record<string, ParentEnd> = {};
    for (const [key, rules] of Object.entries(readings)) if (rules.parent !== null) parents[key] = rules.parent;
    const violations = Object.keys(parents).length > 0 ? await parentViolations(querier, parents) : [];
    // A pair linked twice under a parent relation is already a child with two parents.
    const pairKeys = Object.entries(readings)
      .filter(([, rules]) => rules.onePerPair && rules.parent === null)
      .map(([key]) => key);
    return [...violations, ...(await duplicatePairs(querier, pairKeys))];
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
  // Agent configs
  // ------------------------------------------------------------------

  async listAgents(lensId: string): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${AGENT_COLS} FROM assistant_agent WHERE lens_id = $1 ORDER BY name`,
      [lensId],
    );
    return camelizeRows(result.rows);
  }

  /** Upsert on the `(lens_id, key)` arbiter. `created` is detected
   * by whether the insert stamped this call's fresh id onto the row. */
  async upsertAgent(
    lensId: string,
    agentConfigId: string,
    key: string,
    name: string,
    description: string | null,
    systemPrompt: string | null,
    tools: string[] | null,
  ): Promise<[Row, boolean]> {
    const result = await this.query(
      `INSERT INTO assistant_agent
         (assistant_agent_id, lens_id, key, name, description, system_prompt, tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lens_id, key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         system_prompt = EXCLUDED.system_prompt,
         tools = EXCLUDED.tools,
         updated_at = now()
       RETURNING ${AGENT_COLS}, (assistant_agent_id = $1) AS created`,
      [agentConfigId, lensId, key, name, description, systemPrompt, tools],
    );
    const { created, ...row } = camelizeRow(result.rows[0]!);
    return [row, created as boolean];
  }

  /** Agents in the transfer shape — no ids, no timestamps. */
  async listAgentsForExport(lensId: string): Promise<Row[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const result = await this.query(
      `SELECT key, name, description, system_prompt, tools
       FROM assistant_agent WHERE lens_id = $1 ORDER BY name`,
      [lensId],
    );
    return camelizeRows(result.rows);
  }

  async deleteAgent(lensId: string, agentKey: string): Promise<boolean> {
    if (!isUuid(lensId)) {
      return false;
    }
    const result = await this.query(
      `DELETE FROM assistant_agent WHERE lens_id = $1 AND key = $2`,
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
   * (COALESCE). */
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

  /** No `updated_at` stamp: re-embedding is not a content change. */
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
