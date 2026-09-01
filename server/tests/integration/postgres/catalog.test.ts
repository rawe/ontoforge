/**
 * PostgreSQL-physical catalog tests — everything here reaches past the
 * persistence port on purpose: the physical skeleton one ontology's
 * provisioning leaves in its `ont_<key>` namespace (tables, named
 * constraints, fixed indexes), the server-wide `public` home, and the
 * wipe's whole-namespace drop, asserted against the system catalogs.
 * Requires the docker-compose PostgreSQL.
 *
 * The database-blind skeleton contract lives in
 * `tests/integration/skeleton.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import { closeStores, getOntologyRegistry, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";

/** The provisioned ontology every assertion reads, and its namespace. */
const ONTOLOGY_KEY = "catalog_ont";
const NAMESPACE = "ont_catalog_ont";

const ALL_TABLES = [
  "lens",
  "entity_type",
  "relation_type",
  "property_def",
  "lens_includes",
  "ai_agent_config",
  "saved_query",
  "entity",
  "relation",
  "document_chunk",
];

// Named constraints from the init DDL, with their pg_constraint type:
// p = primary key, u = unique, f = foreign key, c = check.
const EXPECTED_CONSTRAINTS: Record<string, string> = {
  lens_pk: "p",
  entity_type_pk: "p",
  relation_type_pk: "p",
  property_def_pk: "p",
  ai_agent_config_pk: "p",
  saved_query_pk: "p",
  entity_pk: "p",
  relation_pk: "p",
  document_chunk_pk: "p",
  // no lens_includes PK — identity rides its two composite uniques
  lens_key_unique: "u",
  lens_name_unique: "u",
  entity_type_key_unique: "u",
  relation_type_key_unique: "u",
  property_def_entity_key_unique: "u",
  property_def_relation_key_unique: "u",
  lens_includes_entity_unique: "u",
  lens_includes_relation_unique: "u",
  ai_agent_config_key_unique: "u",
  saved_query_key_unique: "u",
  relation_type_source_fk: "f",
  relation_type_target_fk: "f",
  property_def_entity_type_fk: "f",
  property_def_relation_type_fk: "f",
  lens_includes_lens_fk: "f",
  lens_includes_entity_type_fk: "f",
  lens_includes_relation_type_fk: "f",
  ai_agent_config_lens_fk: "f",
  saved_query_lens_fk: "f",
  relation_from_fk: "f",
  relation_to_fk: "f",
  document_chunk_entity_fk: "f",
  property_def_one_owner: "c",
  lens_includes_one_type: "c",
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
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [NAMESPACE],
  );
  return result.rows.map((row) => row.tablename as string);
}

async function constraintTypes(): Promise<Record<string, string>> {
  const result = await runQuery(
    `SELECT con.conname AS name, con.contype AS type
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = $1`,
    [NAMESPACE],
  );
  const map: Record<string, string> = {};
  for (const row of result.rows) {
    map[row.name as string] = row.type as string;
  }
  return map;
}

async function indexNames(): Promise<string[]> {
  const result = await runQuery(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1`,
    [NAMESPACE],
  );
  return result.rows.map((row) => row.indexname as string);
}

async function provisionOntology(): Promise<void> {
  await getOntologyRegistry().createOntology(randomUUID(), ONTOLOGY_KEY, null, null);
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
    await provisionOntology();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  it("provisioning created the ten tables, the named constraints, and the fixed indexes", async () => {
    await assertCatalogComplete();
  });

  it("boot only creates the server-wide home: public holds the registry, no ontology tables", async () => {
    const result = await runQuery(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(result.rows.map((row) => row.tablename)).toEqual(["ontology"]);
  });

  it("boot is idempotent across a close→boot cycle and leaves provisioned namespaces alone", async () => {
    await closeStores();
    await initStores(); // second boot runs the same server DDL against existing objects
    await assertCatalogComplete();
  });

  it("the pgvector extension is installed and embedding columns are dimensionless", async () => {
    const ext = await runQuery(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rowCount).toBe(1);
    // atttypmod -1 = no declared width; the width lives only in the HNSW
    // indexes, keeping init provider-independent. Ordinary tables only:
    // an HNSW index over the cast expression carries a column of the same
    // name, and that one is width-bearing on purpose (M4.1).
    const cols = await runQuery(
      `SELECT rel.relname AS table, att.atttypmod AS typmod
       FROM pg_attribute att
       JOIN pg_class rel ON rel.oid = att.attrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = $1 AND rel.relkind = 'r'
         AND att.attname = 'embedding' AND NOT att.attisdropped`,
      [NAMESPACE],
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
       WHERE nsp.nspname = $1 AND con.contype = 'f'`,
      [NAMESPACE],
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

  it("wipe drops every ont_ namespace whole and empties the registry", async () => {
    await wipeDatabase();

    const namespaces = await runQuery(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ont\\_%'`,
    );
    expect(namespaces.rows).toEqual([]);
    const registry = await runQuery(`SELECT count(*)::int AS total FROM public.ontology`);
    expect(registry.rows[0]!.total).toBe(0);

    // Re-provisioning after the wipe rebuilds the full skeleton.
    await provisionOntology();
    await assertCatalogComplete();
  });
});
