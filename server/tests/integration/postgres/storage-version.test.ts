/**
 * PostgreSQL storage version — reaches past the persistence port on
 * purpose: storage at version 2 (the 5.x layout, before name properties
 * and search indices) is produced by dropping what the current code adds
 * and restoring the per-entity search storage it retires, then the boot
 * (`initSchema`) must bring it to exactly the layout of a freshly created
 * ontology, backfilling every entity type's name property, the search
 * settings and the managed search indices and dropping the retired
 * storage, once,
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

/** The per-type and per-document-property vector indexes of version 2,
 * named from schema-row uuids. */
const VEC_ENTITY_INDEX = "vec_entity_4f2d8a31111142228333444455556666";
const VEC_CHUNK_INDEX = "vec_document_chunk_0a1b2c3d999948888777666655554444";

/** Storage of the previous major line (version 2): no name property, no
 * search-index tables, two lens inclusion kinds, retrievers in
 * `retriever_config` — and the per-entity
 * search storage: search columns on `entity`, `document_chunk`, their
 * keyword indexes and per-type vector indexes — and the registry holding
 * each ontology's text-search language. */
async function makeVersion2(namespace: string, language = "english"): Promise<void> {
  await withTransaction(async (querier) => {
    await querier.query(
      `ALTER TABLE public.ontology ADD COLUMN IF NOT EXISTS text_search_language text NOT NULL
         DEFAULT 'english' CHECK (text_search_language IN ('english', 'german'))`,
    );
    await querier.query(`UPDATE public.ontology SET text_search_language = $1 WHERE namespace = $2`, [
      language,
      namespace,
    ]);
    await querier.query(
      `ALTER TABLE ${namespace}.entity
         ADD COLUMN property_text text NOT NULL DEFAULT '',
         ADD COLUMN keyword_text text NOT NULL DEFAULT '',
         ADD COLUMN keyword_segments jsonb,
         ADD COLUMN search_vector tsvector
           GENERATED ALWAYS AS (to_tsvector('english'::regconfig, keyword_text)) STORED,
         ADD COLUMN embedding vector`,
    );
    await querier.query(`CREATE INDEX entity_keyword_idx ON ${namespace}.entity USING gin (search_vector)`);
    await querier.query(
      `CREATE INDEX ${VEC_ENTITY_INDEX} ON ${namespace}.entity
         USING hnsw ((embedding::vector(3)) vector_cosine_ops) WHERE type_key = 'person'`,
    );
    await querier.query(
      `CREATE TABLE ${namespace}.document_chunk (
         id              uuid    CONSTRAINT document_chunk_pk PRIMARY KEY,
         entity_id       uuid    NOT NULL CONSTRAINT document_chunk_entity_fk
                                 REFERENCES ${namespace}.entity (id) ON DELETE CASCADE,
         entity_type_key text    NOT NULL,
         property_key    text    NOT NULL,
         chunk_index     integer NOT NULL,
         start_char      integer NOT NULL,
         char_length     integer NOT NULL,
         text            text    NOT NULL,
         search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text)) STORED,
         embedding       vector
       )`,
    );
    await querier.query(
      `CREATE INDEX document_keyword_idx ON ${namespace}.document_chunk USING gin (search_vector)`,
    );
    await querier.query(
      `CREATE INDEX document_chunk_entity_property_idx
         ON ${namespace}.document_chunk (entity_id, property_key)`,
    );
    await querier.query(
      `CREATE INDEX ${VEC_CHUNK_INDEX} ON ${namespace}.document_chunk
         USING hnsw ((embedding::vector(3)) vector_cosine_ops)
         WHERE entity_type_key = 'note' AND property_key = 'body'`,
    );
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
    await querier.query(`ALTER TABLE ${namespace}.retriever_agent DROP COLUMN warnings`);
    for (const [now, then] of [
      ["retriever_agent_pk", "retriever_config_pk"],
      ["retriever_agent_lens_fk", "retriever_config_lens_fk"],
      ["retriever_agent_key_unique", "retriever_config_key_unique"],
    ]) {
      await querier.query(`ALTER TABLE ${namespace}.retriever_agent RENAME CONSTRAINT ${now} TO ${then}`);
    }
    await querier.query(
      `ALTER TABLE ${namespace}.retriever_agent RENAME COLUMN retriever_agent_id TO retriever_config_id`,
    );
    await querier.query(`ALTER TABLE ${namespace}.retriever_agent RENAME TO retriever_config`);
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
    await runQuery(`ALTER TABLE public.ontology DROP COLUMN IF EXISTS text_search_language`);
  });

  it("a fresh database is recorded at the current version", async () => {
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
  });

  it("upgrades version-2 storage to exactly the layout of a fresh ontology", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion2("ont_older");

    await initSchema();

    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    // Created after the upgrade: storage at one version holds one layout.
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });

  it("keeps an upgraded ontology's keyword language; a fresh one stems in both", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion2("ont_older", "german");

    await initSchema();

    // The language moved into the ontology; the registry no longer holds one.
    const registryColumns = await runQuery(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ontology' ORDER BY ordinal_position`,
    );
    expect(registryColumns.rows.map((row) => row["column_name"])).toEqual([
      "ontology_id",
      "key",
      "display_name",
      "namespace",
      "created_at",
      "updated_at",
    ]);
    expect((await getOntologyRegistry().getOntology("older"))!).not.toHaveProperty("textSearchLanguage");

    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    const settingsOf = async (namespace: string) =>
      (await runQuery(`SELECT keyword_languages, disabled_defaults FROM ${namespace}.search_settings`)).rows;
    expect(await settingsOf("ont_older")).toEqual([{ keyword_languages: ["german"], disabled_defaults: {} }]);
    expect(await settingsOf("ont_fresh")).toEqual([
      { keyword_languages: ["german", "english"], disabled_defaults: {} },
    ]);
  });

  it("gives every entity type a name property by the fallback chain", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
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

  it("writes the managed search indices and includes them in the scoped lenses that show their types and documents", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion2("ont_older");
    await seedVersion2Types("ont_older", {
      note: [["body", "document"], ["summary", "string"]],
      person: [["age", "integer"], ["name", "string"]],
    });
    await withTransaction(async (querier) => {
      const ns = "ont_older";
      await querier.query(
        `INSERT INTO ${ns}.relation_type
           (relation_type_id, key, display_name, source_entity_type_key, target_entity_type_key)
         VALUES ($1, 'wrote', 'Wrote', 'person', 'note')`,
        [randomUUID()],
      );
      const lens = async (key: string) => {
        const id = randomUUID();
        await querier.query(`INSERT INTO ${ns}.lens (lens_id, key, name) VALUES ($1, $2, $2)`, [id, key]);
        return id;
      };
      await lens("everything");
      const people = await lens("people");
      await querier.query(
        `INSERT INTO ${ns}.lens_includes (lens_id, entity_type_id, properties)
         SELECT $1, entity_type_id, ARRAY['name'] FROM ${ns}.entity_type WHERE key = 'person'`,
        [people],
      );
      const writing = await lens("writing");
      await querier.query(
        `INSERT INTO ${ns}.lens_includes (lens_id, relation_type_id)
         SELECT $1, relation_type_id FROM ${ns}.relation_type WHERE key = 'wrote'`,
        [writing],
      );
      // A passage index needs its document property shown; a default index
      // only its type.
      for (const [key, properties] of [["brief", ["summary"]], ["reading", ["body"]]] as const) {
        await querier.query(
          `INSERT INTO ${ns}.lens_includes (lens_id, entity_type_id, properties)
           SELECT $1, entity_type_id, $2::text[] FROM ${ns}.entity_type WHERE key = 'note'`,
          [await lens(key), properties],
        );
      }
    });

    await initSchema();

    const indices = await runQuery(
      `SELECT si.key, si.kind, et.key AS entity_type, si.definition->'fields' AS fields
         FROM ont_older.search_index si
         JOIN ont_older.entity_type et ON et.entity_type_id = si.entity_type_id
        ORDER BY si.key`,
    );
    expect(indices.rows).toEqual([
      { key: "note~body", kind: "passage", entity_type: "note", fields: ["body"] },
      { key: "note~default", kind: "default", entity_type: "note", fields: ["summary"] },
      { key: "person~default", kind: "default", entity_type: "person", fields: ["name"] },
    ]);
    // An unscoped lens needs no inclusions; a lens with relation inclusions
    // only shows every type and property; a lens hiding `note.body` does
    // not get its passage index.
    const included = await runQuery(
      `SELECT l.key AS lens, si.key AS index
         FROM ont_older.lens_includes li
         JOIN ont_older.lens l ON l.lens_id = li.lens_id
         JOIN ont_older.search_index si ON si.search_index_id = li.search_index_id
        ORDER BY l.key, si.key`,
    );
    expect(included.rows).toEqual([
      { lens: "brief", index: "note~default" },
      { lens: "people", index: "person~default" },
      { lens: "reading", index: "note~body" },
      { lens: "reading", index: "note~default" },
      { lens: "writing", index: "note~body" },
      { lens: "writing", index: "note~default" },
      { lens: "writing", index: "person~default" },
    ]);
  });

  it("renames retrievers to retriever agents and converts their configurations to version 2", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion2("ont_older");
    await seedVersion2Types("ont_older", {
      note: [["body", "document"], ["title", "string"]],
      place: [["name", "string"]],
    });
    const lensId = randomUUID();
    const legacy = {
      buckets: [
        {
          entityTypeKey: "note",
          searchFields: ["title", "body"],
          answerFields: ["title"],
          conditions: [
            { id: "rule-1", mode: "hard", path: [{ relationTypeKey: "about", direction: "outgoing" }], targetField: "name", textFields: [] },
            { id: "rule-2", mode: "soft", path: [{ relationTypeKey: "about", direction: "outgoing" }], targetField: "name", textFields: ["name"] },
          ],
        },
      ],
      threshold: 0.4,
      answerFieldCharacters: 500,
    };
    await withTransaction(async (querier) => {
      await querier.query(
        `INSERT INTO ont_older.relation_type
           (relation_type_id, key, display_name, source_entity_type_key, target_entity_type_key)
         VALUES ($1, 'about', 'About', 'note', 'place')`,
        [randomUUID()],
      );
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(
        `INSERT INTO ont_older.retriever_config (retriever_config_id, lens_id, key, name, config_version, config)
         VALUES ($1, $3, 'notes', 'Notes', 1, $4::jsonb), ($2, $3, 'broken', 'Broken', 1, '{"buckets": 7}'::jsonb),
                ($5, $3, 'fair-search', 'Fair', 1, $4::jsonb), ($6, $3, 'fair_search', 'Fair too', 1, $4::jsonb)`,
        [randomUUID(), randomUUID(), lensId, JSON.stringify(legacy), randomUUID(), randomUUID()],
      );
    });

    await initSchema();

    const agents = await runQuery(
      `SELECT key, config_version, config, warnings FROM ont_older.retriever_agent ORDER BY key`,
    );
    const soft =
      "Soft condition 'rule-2' of note was dropped: it needs a custom index with relation group about (outgoing).";
    // Keys with '-' follow the key rules, unique in the lens.
    expect(agents.rows.filter((row) => String(row["key"]).startsWith("fair")).map((row) => [row["key"], row["warnings"]])).toEqual([
      ["fair_search", [soft]],
      ["fair_search_2", [soft, "Key renamed from 'fair-search' to 'fair_search_2'."]],
    ]);
    expect(agents.rows.filter((row) => !String(row["key"]).startsWith("fair"))).toEqual([
      // Not a readable version-1 shape: kept as it was; reads report it invalid.
      { key: "broken", config_version: 1, config: { buckets: 7 }, warnings: [] },
      {
        key: "notes",
        config_version: 2,
        config: {
          indices: [{ index: "note~default" }, { index: "note~body" }],
          filters: [
            { id: "rule-1", entityType: "note", path: [{ relationTypeKey: "about", direction: "outgoing" }], field: "name" },
          ],
          answerFields: { note: ["title"] },
          threshold: 0.4,
          answerFieldCharacters: 500,
        },
        warnings: [
          "Soft condition 'rule-2' of note was dropped: it needs a custom index with relation group about (outgoing).",
        ],
      },
    ]);
    // The agent reads through the port with its conversion notes.
    const indices = (await getModelingStore("older")).searchIndices!();
    expect((await indices.getRetrieverAgent(lensId, "notes"))!.warnings).toHaveLength(1);
  });

  it("drops the per-entity search storage and keeps every instance", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion2("ont_older");
    const ada = randomUUID();
    const note = randomUUID();
    await withTransaction(async (querier) => {
      await querier.query(
        `INSERT INTO ont_older.entity (id, type_key, props, keyword_text, property_text, embedding)
         VALUES ($1, 'person', '{"name": "Ada"}', 'Ada', 'person: name=Ada', '[1,0,0]'),
                ($2, 'note', '{"body": "Notes"}', '', 'note', NULL)`,
        [ada, note],
      );
      await querier.query(
        `INSERT INTO ont_older.relation (id, type_key, from_id, to_id) VALUES ($1, 'wrote', $2, $3)`,
        [randomUUID(), ada, note],
      );
      await querier.query(
        `INSERT INTO ont_older.document_chunk
           (id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text, embedding)
         VALUES ($1, $2, 'note', 'body', 0, 0, 5, 'Notes', '[0,1,0]')`,
        [randomUUID(), note],
      );
    });

    await initSchema();

    const retired = await runQuery(
      `SELECT to_regclass('ont_older.document_chunk') AS chunks,
              (SELECT count(*)::int FROM pg_indexes
                WHERE schemaname = 'ont_older' AND (indexname LIKE 'vec\\_%' OR indexname LIKE '%keyword_idx')) AS indexes,
              (SELECT count(*)::int FROM information_schema.columns
                WHERE table_schema = 'ont_older' AND table_name = 'entity'
                  AND column_name IN ('property_text', 'keyword_text', 'keyword_segments',
                                      'search_vector', 'embedding')) AS columns`,
    );
    expect(retired.rows).toEqual([{ chunks: null, indexes: 0, columns: 0 }]);
    const kept = await runQuery(`SELECT id, type_key, props FROM ont_older.entity ORDER BY type_key`);
    expect(kept.rows).toEqual([
      { id: note, type_key: "note", props: { body: "Notes" } },
      { id: ada, type_key: "person", props: { name: "Ada" } },
    ]);
    const relations = await runQuery(`SELECT count(*)::int AS n FROM ont_older.relation`);
    expect(relations.rows[0]!["n"]).toBe(1);
  });

  it("refuses unversioned storage — older than the previous major line — and changes nothing", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await runQuery(`DROP TABLE public.storage_version`);
    const before = await layout("ont_older");

    await expect(initSchema()).rejects.toThrow("previous major line first");

    expect(await layout("ont_older")).toEqual(before);
  });

  it("several servers starting together upgrade once", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion2("ont_older");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await Promise.all([initSchema(), initSchema(), initSchema()]);

    const upgrades = log.mock.calls.filter(([line]) => String(line).startsWith("Upgrading storage"));
    expect(upgrades).toHaveLength(1);
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
  });

  it("storage newer than the code stops the boot and stays untouched", async () => {
    await getOntologyRegistry().createOntology(ID_A, "newer", null, null);
    await recordVersion(STORAGE_VERSION + 1);
    const before = await layout("ont_newer");

    await expect(initSchema()).rejects.toThrow("Use a newer release");

    expect(await recordedVersion()).toBe(STORAGE_VERSION + 1);
    expect(await layout("ont_newer")).toEqual(before);
  });
});
