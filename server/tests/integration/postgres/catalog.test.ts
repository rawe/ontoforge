/**
 * PostgreSQL-physical catalog tests — everything here reaches past the
 * persistence port on purpose: the init DDL's tables, named constraints,
 * fixed indexes, and the wipe's `vec_%` index sweep, asserted against
 * the system catalogs. Requires the docker-compose PostgreSQL.
 *
 * The database-blind skeleton contract lives in
 * `tests/integration/skeleton.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import { closeStores, initStores, wipeDatabase } from "../../../src/core/ports.js";

const ALL_TABLES = [
  "ontology",
  "entity_type",
  "relation_type",
  "property_def",
  "ontology_includes",
  "ai_agent_config",
  "saved_query",
  "entity",
  "relation",
  "document_chunk",
];

// Named constraints from the init DDL, with their pg_constraint type:
// p = primary key, u = unique, f = foreign key, c = check.
const EXPECTED_CONSTRAINTS: Record<string, string> = {
  ontology_pk: "p",
  entity_type_pk: "p",
  relation_type_pk: "p",
  property_def_pk: "p",
  ai_agent_config_pk: "p",
  saved_query_pk: "p",
  entity_pk: "p",
  relation_pk: "p",
  document_chunk_pk: "p",
  // no ontology_includes PK — identity rides its two composite uniques
  ontology_key_unique: "u",
  ontology_name_unique: "u",
  entity_type_key_unique: "u",
  relation_type_key_unique: "u",
  property_def_entity_key_unique: "u",
  property_def_relation_key_unique: "u",
  ontology_includes_entity_unique: "u",
  ontology_includes_relation_unique: "u",
  ai_agent_config_key_unique: "u",
  saved_query_key_unique: "u",
  relation_type_source_fk: "f",
  relation_type_target_fk: "f",
  property_def_entity_type_fk: "f",
  property_def_relation_type_fk: "f",
  ontology_includes_ontology_fk: "f",
  ontology_includes_entity_type_fk: "f",
  ontology_includes_relation_type_fk: "f",
  ai_agent_config_ontology_fk: "f",
  saved_query_ontology_fk: "f",
  relation_from_fk: "f",
  relation_to_fk: "f",
  document_chunk_entity_fk: "f",
  property_def_one_owner: "c",
  ontology_includes_one_type: "c",
};

const FIXED_BTREE_INDEXES = [
  "entity_type_key_idx",
  "relation_type_key_idx",
  "relation_from_id_idx",
  "relation_to_id_idx",
  "document_chunk_entity_property_idx",
];

async function tableNames(): Promise<string[]> {
  const result = await runQuery(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`,
  );
  return result.rows.map((row) => row.tablename as string);
}

async function constraintTypes(): Promise<Record<string, string>> {
  const result = await runQuery(
    `SELECT con.conname AS name, con.contype AS type
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = current_schema()`,
  );
  const map: Record<string, string> = {};
  for (const row of result.rows) {
    map[row.name as string] = row.type as string;
  }
  return map;
}

async function indexNames(): Promise<string[]> {
  const result = await runQuery(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`,
  );
  return result.rows.map((row) => row.indexname as string);
}

async function assertCatalogComplete(): Promise<void> {
  const tables = await tableNames();
  for (const table of ALL_TABLES) {
    expect(tables).toContain(table);
  }
  const constraints = await constraintTypes();
  for (const [name, type] of Object.entries(EXPECTED_CONSTRAINTS)) {
    expect(constraints[name], `constraint ${name}`).toBe(type);
  }
  const indexes = await indexNames();
  for (const index of FIXED_BTREE_INDEXES) {
    expect(indexes).toContain(index);
  }
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL physical catalog", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  it("init created the ten tables, the named constraints, and the fixed indexes", async () => {
    await assertCatalogComplete();
  });

  it("init is idempotent across a close→boot cycle", async () => {
    await closeStores();
    await initStores(); // second boot runs the same DDL against existing objects
    await assertCatalogComplete();
  });

  it("the pgvector extension is installed and embedding columns are dimensionless", async () => {
    const ext = await runQuery(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rowCount).toBe(1);
    // atttypmod -1 = no declared width; the width lives only in the HNSW
    // indexes (M4), keeping init provider-independent.
    const cols = await runQuery(
      `SELECT rel.relname AS table, att.atttypmod AS typmod
       FROM pg_attribute att
       JOIN pg_class rel ON rel.oid = att.attrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = current_schema()
         AND att.attname = 'embedding' AND NOT att.attisdropped`,
    );
    expect(cols.rows.map((row) => row.table).sort()).toEqual([
      "document_chunk",
      "entity",
      "saved_query",
    ]);
    for (const row of cols.rows) {
      expect(row.typmod).toBe(-1);
    }
  });

  it("the delete rules back the truth table: endpoint FKs RESTRICT, the rest CASCADE", async () => {
    const result = await runQuery(
      `SELECT con.conname AS name, con.confdeltype AS del
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = current_schema() AND con.contype = 'f'`,
    );
    const rules = new Map(result.rows.map((row) => [row.name as string, row.del as string]));
    expect(rules.get("relation_type_source_fk")).toBe("r"); // RESTRICT
    expect(rules.get("relation_type_target_fk")).toBe("r");
    for (const [name, rule] of rules) {
      if (name !== "relation_type_source_fk" && name !== "relation_type_target_fk") {
        expect(rule, `delete rule of ${name}`).toBe("c"); // CASCADE
      }
    }
  });

  it("no fixed object claims the vec_ prefix reserved for dynamic indexes", async () => {
    const fixed = [
      ...(await tableNames()),
      ...(await indexNames()),
      ...Object.keys(await constraintTypes()),
    ];
    expect(fixed.filter((name) => name.startsWith("vec_"))).toEqual([]);
  });

  it("wipe drops vec_-prefixed indexes and keeps the fixed set", async () => {
    // Stage what only M4's lifecycle (or an orphaned import) would create:
    // a dynamically named index under the reserved prefix.
    const staged = `vec_entity_${"0".repeat(32)}`;
    await runQuery(`CREATE INDEX ${staged} ON entity (type_key)`);
    expect(await indexNames()).toContain(staged);

    await wipeDatabase();

    const after = await indexNames();
    expect(after).not.toContain(staged);
    for (const index of FIXED_BTREE_INDEXES) {
      expect(after).toContain(index);
    }
  });
});
