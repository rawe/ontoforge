/**
 * PostgreSQL storage version — reaches past the persistence port on
 * purpose: storage at version 2 (the 5.x layout, before name properties
 * and search indices) is produced by dropping what the current code adds,
 * then the boot (`initSchema`) must bring it to exactly the layout of a
 * freshly created ontology, backfilling every entity type's name property
 * and the search settings, once,
 * however many servers start together; it must refuse storage older than
 * the previous major line and leave storage newer than the code
 * untouched. Requires the docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "../../../src/adapters/postgres/ddl.js";
import { runQuery, withTransaction } from "../../../src/adapters/postgres/errors.js";
import { STORAGE_VERSION } from "../../../src/adapters/postgres/storageVersion.js";
import { settings } from "../../../src/config.js";
import {
  closeStores,
  getModelingStore,
  getOntologyRegistry,
  initStores,
} from "../../../src/core/ports.js";
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

/** Storage of the previous major line (version 2): no name property, no
 * search-index tables, two lens inclusion kinds. */
async function makeVersion2(namespace: string): Promise<void> {
  await withTransaction(async (querier) => {
    await querier.query(
      `DROP TABLE ${namespace}.search_entry, ${namespace}.search_queue,
         ${namespace}.search_generation, ${namespace}.search_settings`,
    );
    await querier.query(
      `ALTER TABLE ${namespace}.lens_includes
         DROP CONSTRAINT lens_includes_one_type,
         DROP CONSTRAINT lens_includes_search_index_unique,
         DROP COLUMN search_index_id,
         ADD CONSTRAINT lens_includes_one_type CHECK (num_nonnulls(entity_type_id, relation_type_id) = 1)`,
    );
    await querier.query(`DROP TABLE ${namespace}.search_index`);
    await querier.query(`ALTER TABLE ${namespace}.entity_type DROP COLUMN name_property`);
  });
  await recordVersion(2);
}

/** Version-2 entity types with their properties in declaration order. */
async function seedVersion2Types(
  namespace: string,
  types: Record<string, [key: string, dataType: string][]>,
): Promise<void> {
  await withTransaction(async (querier) => {
    let tick = 0;
    for (const [typeKey, properties] of Object.entries(types)) {
      const typeId = randomUUID();
      await querier.query(
        `INSERT INTO ${namespace}.entity_type (entity_type_id, key, display_name) VALUES ($1, $2, $2)`,
        [typeId, typeKey],
      );
      for (const [key, dataType] of properties) {
        tick += 1;
        await querier.query(
          `INSERT INTO ${namespace}.property_def
             (property_id, entity_type_id, key, display_name, data_type, required, created_at)
           VALUES ($1, $2, $3, $3, $4, true, now() + make_interval(secs => $5))`,
          [randomUUID(), typeId, key, dataType, tick],
        );
      }
    }
  });
}

/** Every column, constraint and index of one namespace, namespace-free. */
async function layout(namespace: string): Promise<unknown> {
  const strip = (value: unknown) => String(value).replaceAll(`${namespace}.`, "");
  // Column order, not raw positions: a dropped column keeps its slot, and
  // `makeVersion2` drops one.
  const columns = await runQuery(
    `SELECT table_name, column_name, data_type, is_nullable, column_default,
            row_number() OVER (PARTITION BY table_name ORDER BY ordinal_position) AS position
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

  it("upgrades version-2 storage to exactly the layout of a fresh ontology", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "english");
    await makeVersion2("ont_older");

    await initSchema();

    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    // Created after the upgrade: storage at one version holds one layout.
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null, "english");
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });

  it("keeps an upgraded ontology's keyword language; a fresh one stems in both", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "german");
    await makeVersion2("ont_older");

    await initSchema();

    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null, "english");
    const settingsOf = async (namespace: string) =>
      (await runQuery(`SELECT keyword_languages, disabled_defaults FROM ${namespace}.search_settings`)).rows;
    expect(await settingsOf("ont_older")).toEqual([{ keyword_languages: ["german"], disabled_defaults: {} }]);
    expect(await settingsOf("ont_fresh")).toEqual([
      { keyword_languages: ["german", "english"], disabled_defaults: {} },
    ]);
  });

  it("gives every entity type a name property by the fallback chain", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "english");
    await makeVersion2("ont_older");
    await seedVersion2Types("ont_older", {
      article: [["summary", "string"], ["label", "string"], ["title", "string"]],
      empty: [],
      note: [["body", "document"], ["summary", "string"], ["code", "string"]],
      person: [["age", "integer"], ["name", "string"]],
      reading: [["name", "integer"], ["value", "float"]],
    });

    await initSchema();

    const named = await runQuery(
      `SELECT key, name_property FROM ont_older.entity_type ORDER BY key`,
    );
    expect(named.rows).toEqual([
      { key: "article", name_property: "title" },
      { key: "empty", name_property: "name" },
      { key: "note", name_property: "summary" },
      { key: "person", name_property: "name" },
      { key: "reading", name_property: "name_2" },
    ]);
    // Only the types without a string property got a new one.
    const created = await runQuery(
      `SELECT et.key AS type_key, p.key, p.display_name, p.data_type, p.required
         FROM ont_older.property_def p
         JOIN ont_older.entity_type et ON et.entity_type_id = p.entity_type_id
        WHERE p.key = et.name_property AND et.key IN ('empty', 'reading')
        ORDER BY et.key`,
    );
    expect(created.rows).toEqual([
      { type_key: "empty", key: "name", display_name: "Name", data_type: "string", required: false },
      { type_key: "reading", key: "name_2", display_name: "name_2", data_type: "string", required: false },
    ]);
    const counts = await runQuery(`SELECT count(*)::int AS n FROM ont_older.property_def`);
    expect(counts.rows[0]!["n"]).toBe(12);

    // The model reads them through the port.
    const modeling = await getModelingStore("older");
    const types = await modeling.listEntityTypes();
    expect(types.map((et) => [et.key, et.nameProperty])).toEqual([
      ["article", "title"],
      ["empty", "name"],
      ["note", "summary"],
      ["person", "name"],
      ["reading", "name_2"],
    ]);
  });

  it("refuses unversioned storage — older than the previous major line — and changes nothing", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "english");
    await runQuery(`DROP TABLE public.storage_version`);
    const before = await layout("ont_older");

    await expect(initSchema()).rejects.toThrow("previous major line first");

    expect(await layout("ont_older")).toEqual(before);
  });

  it("several servers starting together upgrade once", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null, "english");
    await makeVersion2("ont_older");
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
