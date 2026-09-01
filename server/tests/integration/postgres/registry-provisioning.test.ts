/**
 * PostgreSQL-physical registry tests — everything here reaches past the
 * persistence port on purpose: ontology creation provisions the
 * `ont_<key>` namespace with the ten tables in one transaction, a failed
 * create leaves no namespace and no registry row behind, and delete
 * drops the namespace in one cascade. Requires the docker-compose
 * PostgreSQL.
 *
 * The database-blind registry contract lives in
 * `tests/integration/ontology-registry.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import { ConflictError, StoreError } from "../../../src/core/exceptions.js";
import { closeStores, getOntologyRegistry, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";

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

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function namespaceExists(namespace: string): Promise<boolean> {
  const result = await runQuery(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [namespace]);
  return result.rowCount > 0;
}

async function tablesIn(namespace: string): Promise<string[]> {
  const result = await runQuery(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
    [namespace],
  );
  return result.rows.map((row) => row["table_name"] as string).sort();
}

async function registryRowCount(key: string): Promise<number> {
  const result = await runQuery(`SELECT 1 FROM public.ontology WHERE key = $1`, [key]);
  return result.rowCount;
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL registry provisioning", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
  });

  it("create provisions ont_<key> with the ten tables", async () => {
    await getOntologyRegistry().createOntology(ID_A, "crm", null, null);
    expect(await namespaceExists("ont_crm")).toBe(true);
    expect(await tablesIn("ont_crm")).toEqual([...ALL_TABLES].sort());
  });

  it("a failure after the namespace exists rolls everything back", async () => {
    // An invalid embedding width dies inside the provisioning transaction,
    // after CREATE SCHEMA and the ten-table DDL have already run.
    await expect(
      getOntologyRegistry().createOntology(ID_A, "doomed", null, -1),
    ).rejects.toThrow("Invalid embedding width");
    expect(await namespaceExists("ont_doomed")).toBe(false);
    expect(await registryRowCount("doomed")).toBe(0);
  });

  it("a failed CREATE SCHEMA rolls the registry row back", async () => {
    // An orphan namespace no registry row claims: the one state that makes
    // CREATE SCHEMA itself fail, after the registry INSERT succeeded.
    await runQuery(`CREATE SCHEMA ont_orphaned`);
    try {
      await expect(
        getOntologyRegistry().createOntology(ID_A, "orphaned", null, null),
      ).rejects.toThrow(StoreError);
      expect(await registryRowCount("orphaned")).toBe(0);
    } finally {
      await runQuery(`DROP SCHEMA IF EXISTS ont_orphaned CASCADE`);
    }
  });

  it("a display-name collision the pre-check missed translates to the conflict", async () => {
    // Straight to the port, bypassing the service pre-check: the race
    // backstop is the named constraint's translation.
    await getOntologyRegistry().createOntology(ID_A, "crm", "Customer Relations", null);
    await expect(
      getOntologyRegistry().createOntology(ID_B, "other", "Customer Relations", null),
    ).rejects.toThrow(ConflictError);
    expect(await namespaceExists("ont_other")).toBe(false);
    expect(await registryRowCount("other")).toBe(0);
  });

  it("delete drops the namespace and the registry row together", async () => {
    await getOntologyRegistry().createOntology(ID_A, "crm", null, null);
    expect(await getOntologyRegistry().deleteOntology("crm")).toBe(true);
    expect(await namespaceExists("ont_crm")).toBe(false);
    expect(await registryRowCount("crm")).toBe(0);
  });

  it("the server-wide home holds only the registry — no ontology tables", async () => {
    await getOntologyRegistry().createOntology(ID_A, "crm", null, null);
    // `public` is the server-wide home: the registry and nothing
    // ontology-scoped; the ten tables live only inside `ont_*`.
    const result = await runQuery(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema()`,
    );
    const names = result.rows.map((row) => row["table_name"] as string);
    for (const table of ALL_TABLES) {
      expect(names).not.toContain(table);
    }
    expect(names).toContain("ontology");
  });
});
