/**
 * PostgreSQL storage version — reaches past the persistence port on
 * purpose: an unversioned database in the layout before retrievers is
 * produced by dropping what the current code creates, then the boot
 * (`initSchema`) must bring it to exactly the layout of a freshly
 * created ontology, once, however many servers start together, and must
 * leave storage newer than the code untouched. Requires the
 * docker-compose PostgreSQL.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "../../../src/adapters/postgres/ddl.js";
import { runQuery, withTransaction } from "../../../src/adapters/postgres/errors.js";
import { STORAGE_VERSION } from "../../../src/adapters/postgres/storageVersion.js";
import { settings } from "../../../src/config.js";
import { closeStores, getOntologyRegistry, initStores } from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function recordedVersion(): Promise<number> {
  return (await runQuery(`SELECT version FROM public.storage_version`)).rows[0]!["version"] as number;
}

async function recordVersion(version: number): Promise<void> {
  await withTransaction(async (querier) => {
    await querier.query(`CREATE TABLE IF NOT EXISTS public.storage_version (version integer NOT NULL)`);
    await querier.query(`DELETE FROM public.storage_version`);
    await querier.query(`INSERT INTO public.storage_version (version) VALUES ($1)`, [version]);
  });
}

/** The storage before retrievers: no version table, no retriever table. */
async function makeUnversioned(namespace: string): Promise<void> {
  await withTransaction(async (querier) => {
    await querier.query(`DROP TABLE ${namespace}.retriever_config`);
    await querier.query(`DROP TABLE public.storage_version`);
  });
}

/** Every column, constraint and index of one namespace, namespace-free. */
async function layout(namespace: string): Promise<unknown> {
  const strip = (value: unknown) => String(value).replaceAll(`${namespace}.`, "");
  const columns = await runQuery(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns WHERE table_schema = $1
      ORDER BY table_name, ordinal_position`,
    [namespace],
  );
  const constraints = await runQuery(
    `SELECT t.relname, c.conname, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 ORDER BY t.relname, c.conname`,
    [namespace],
  );
  const indexes = await runQuery(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
    [namespace],
  );
  return {
    columns: columns.rows,
    constraints: constraints.rows.map((row) => ({ ...row, definition: strip(row["definition"]) })),
    indexes: indexes.rows.map((row) => ({ ...row, indexdef: strip(row["indexdef"]) })),
  };
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL storage version", () => {
  beforeAll(async () => {
    await initStores();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await recordVersion(STORAGE_VERSION);
  });

  it("a fresh database is recorded at the current version", async () => {
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
  });

  it("upgrades unversioned storage to exactly the layout of a fresh ontology", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "english");
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null, "english");
    await makeUnversioned("ont_older");

    await initSchema();

    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });

  it("several servers starting together upgrade once", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "english");
    await makeUnversioned("ont_older");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await Promise.all([initSchema(), initSchema(), initSchema()]);

    const upgrades = log.mock.calls.filter(([line]) => String(line).startsWith("Upgrading storage"));
    expect(upgrades).toHaveLength(1);
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
  });

  it("storage newer than the code stops the boot and stays untouched", async () => {
    await getOntologyRegistry().createOntology(ID_A, "newer", null, null, "english");
    await recordVersion(STORAGE_VERSION + 1);
    const before = await layout("ont_newer");

    await expect(initSchema()).rejects.toThrow("Use a newer release");

    expect(await recordedVersion()).toBe(STORAGE_VERSION + 1);
    expect(await layout("ont_newer")).toEqual(before);
  });
});
