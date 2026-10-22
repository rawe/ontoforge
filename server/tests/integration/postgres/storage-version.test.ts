/**
 * PostgreSQL storage version — reaches past the persistence port on
 * purpose. Real 5.1.0 storage (unversioned, version 1), frozen in
 * `tests/fixtures/storage-5.1.0.sql`, must be brought by the boot
 * (`initSchema`) to exactly the layout of a freshly created ontology,
 * every instance kept, every entity type given its name property, the
 * keyword language, the managed search indices and an empty retriever
 * table set up, and the retired search storage dropped. Storage of the
 * 6.x line (version 3) is produced by giving the assistant tables their
 * 6.x names back; the 7.0 step names them after their kind again, every
 * agent and retriever kept. Storage at version 7 is produced by dropping
 * the changeset tables and the write access of rulesets; step 8 adds
 * them back, every row kept. Storage at version 6 is produced by dropping
 * the parent end of relation types and the ruleset table; step 7 adds them
 * back, every row kept. Storage at version 5 is produced by putting
 * the `assistant` table of step 5 in place of the navigator table; the
 * step to version 6 names it after its kind, every navigator kept. Storage
 * at version 4 has neither table; the steps to 5 and 6 create it. Storage at
 * the unreleased version 2 (development storage with retrievers) is
 * produced by dropping what the current code adds and restoring the
 * per-entity search storage it retires; the same step upgrades it,
 * converting its retrievers. The upgrade runs once however many servers
 * start together; storage newer than the code stays untouched. Requires
 * the docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema, SAVED_QUERY_INDEX } from "../../../src/adapters/postgres/ddl.js";
import { type Querier, runQuery, withTransaction } from "../../../src/adapters/postgres/errors.js";
import { STORAGE_VERSION } from "../../../src/adapters/postgres/storageVersion.js";
import {
  closeStores,
  getModelingStore,
  getOntologyRegistry,
  getRuntimeStore,
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

/** Storage made by the 5.1.0 server: its registry table, still holding
 * each ontology's text-search language, and the namespaces of `legacy`
 * (English) and `legacy_de` (German) — and no version table. */
async function loadRelease510(): Promise<void> {
  await runQuery(`DROP TABLE public.storage_version`);
  await runQuery(`DROP TABLE public.ontology`);
  await runQuery(readFileSync(new URL("../../fixtures/storage-5.1.0.sql", import.meta.url), "utf8"));
}

/** Every entity and relation of a namespace, as stored. */
async function instances(namespace: string): Promise<unknown> {
  const entities = await runQuery(
    `SELECT id, type_key, props, created_at, updated_at FROM ${namespace}.entity ORDER BY id`,
  );
  const relations = await runQuery(
    `SELECT id, type_key, from_id, to_id, props, created_at, updated_at
       FROM ${namespace}.relation ORDER BY id`,
  );
  return { entities: entities.rows, relations: relations.rows };
}

/** Rename a table, its id column and every constraint the way the
 * storage of an older layout names them — NOT NULL constraints included,
 * which PostgreSQL 18 names after table and column. */
async function renameTable(
  querier: Querier,
  namespace: string,
  [table, id]: [string, string],
  [then, thenId]: [string, string],
): Promise<void> {
  await querier.query(`ALTER TABLE ${namespace}.${table} RENAME COLUMN ${id} TO ${thenId}`);
  const constraints = await querier.query(
    `SELECT c.conname, c.contype, a.attname FROM pg_constraint c
       LEFT JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = '${namespace}.${table}'::regclass`,
  );
  for (const row of constraints.rows) {
    const name = row["conname"] as string;
    const renamed =
      row["contype"] === "n" ? `${then}_${row["attname"] as string}_not_null` : name.replace(table, then);
    await querier.query(`ALTER TABLE ${namespace}.${table} RENAME CONSTRAINT ${name} TO ${renamed}`);
  }
  await querier.query(`ALTER TABLE ${namespace}.${table} RENAME TO ${then}`);
}

/** Storage at version 5: the navigators in the `assistant` table, with a
 * `kind` column, as step 5 creates it. Records no version. */
async function makeVersion5Layout(namespace: string): Promise<void> {
  await makeVersion4Layout(namespace);
  await runQuery(`CREATE TABLE ${namespace}.assistant (
  assistant_id   uuid        CONSTRAINT assistant_pk PRIMARY KEY,
  lens_id        uuid        NOT NULL CONSTRAINT assistant_lens_fk
                             REFERENCES ${namespace}.lens (lens_id) ON DELETE CASCADE,
  kind           text        NOT NULL,
  key            text        NOT NULL,
  name           text        NOT NULL,
  description    text,
  config_version integer     NOT NULL,
  config         jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_key_unique UNIQUE (lens_id, kind, key)
)`);
}

/** Storage at version 7: no changeset tables, no write access on
 * rulesets. Records no version — every older layout builds on it. */
async function makeVersion7Layout(namespace: string): Promise<void> {
  await runQuery(`DROP TABLE ${namespace}.changeset_write`);
  await runQuery(`DROP TABLE ${namespace}.changeset`);
  await runQuery(`ALTER TABLE ${namespace}.ruleset DROP COLUMN write_access`);
}

/** Storage at version 6: no parent end on relation types, no ruleset
 * table. Records no version — every older layout builds on it. */
async function makeVersion6Layout(namespace: string): Promise<void> {
  await makeVersion7Layout(namespace);
  await runQuery(`ALTER TABLE ${namespace}.relation_type DROP COLUMN parent`);
  await runQuery(`DROP TABLE ${namespace}.ruleset`);
}

/** Storage at version 4: no table for navigators. Records no version —
 * `makeVersion3Layout` builds on it. */
async function makeVersion4Layout(namespace: string): Promise<void> {
  await makeVersion6Layout(namespace);
  await runQuery(`DROP TABLE ${namespace}.assistant_navigator`);
}

/** Storage of the 6.x line (version 3): the assistant tables under their
 * 6.x names. Records no version — `makeVersion2` builds on it. */
async function makeVersion3Layout(namespace: string): Promise<void> {
  await makeVersion4Layout(namespace);
  await withTransaction(async (querier) => {
    await renameTable(querier, namespace, ["assistant_agent", "assistant_agent_id"], ["ai_agent_config", "agent_config_id"]);
    await renameTable(
      querier,
      namespace,
      ["assistant_retriever", "assistant_retriever_id"],
      ["retriever_agent", "retriever_agent_id"],
    );
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
  await makeVersion3Layout(namespace);
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
    // Version 2 created the table as `retriever_config`: its NOT NULL
    // constraints carry that name.
    const notNull = await querier.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = '${namespace}.retriever_agent'::regclass AND contype = 'n'`,
    );
    for (const row of notNull.rows) {
      const name = row["conname"] as string;
      await querier.query(
        `ALTER TABLE ${namespace}.retriever_agent RENAME CONSTRAINT ${name}
           TO ${name.replaceAll("retriever_agent", "retriever_config")}`,
      );
    }
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

interface Layout {
  columns: unknown[];
  constraints: unknown[];
  indexes: { indexname: string; indexdef: string }[];
}

/** Every column, constraint and index of one namespace, namespace-free. */
async function layout(namespace: string): Promise<Layout> {
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
    indexes: indexes.rows.map((row) => ({
      indexname: row["indexname"] as string,
      indexdef: strip(row["indexdef"]),
    })),
  };
}

/** A layout without the saved-query vector index, which exists once an
 * embedding provider set its width: the 5.1.0 storage was made with one,
 * this test server runs without. */
function withoutProviderIndex(of: Layout): Layout {
  return { ...of, indexes: of.indexes.filter((index) => index.indexname !== SAVED_QUERY_INDEX) };
}

describe("PostgreSQL storage version", () => {
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

  it("upgrades real 5.1.0 storage to exactly the layout of a fresh ontology, keeping every instance", async () => {
    await loadRelease510();
    const before = [await instances("ont_legacy"), await instances("ont_legacy_de")];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 1 to 8 (2 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    expect([await instances("ont_legacy"), await instances("ont_legacy_de")]).toEqual(before);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    const fresh = await layout("ont_fresh");
    expect(withoutProviderIndex(await layout("ont_legacy"))).toEqual(fresh);
    expect(withoutProviderIndex(await layout("ont_legacy_de"))).toEqual(fresh);
    // The retired search storage went with its keyword and vector indexes.
    const retired = await runQuery(
      `SELECT count(*)::int AS n FROM pg_indexes
        WHERE schemaname LIKE 'ont\\_legacy%' AND (indexname LIKE 'vec\\_%' OR indexname LIKE '%keyword_idx')`,
    );
    expect(retired.rows[0]!["n"]).toBe(0);
    // A second start finds the storage current and changes nothing.
    log.mockClear();
    await initSchema();
    expect(log).not.toHaveBeenCalled();
    expect(withoutProviderIndex(await layout("ont_legacy"))).toEqual(fresh);
  });

  it("gives real 5.1.0 storage its name properties, keyword languages, managed indices and retrievers", async () => {
    await loadRelease510();

    await initSchema();

    const registry = getOntologyRegistry();
    expect((await registry.listOntologies()).map((ontology) => ontology.key).sort()).toEqual([
      "legacy",
      "legacy_de",
    ]);
    // By the fallback chain, in property creation order: `ticket` was built
    // property by property, `zeta` before `alpha`.
    const named = async (key: string) =>
      (await (await getModelingStore(key)).listEntityTypes()).map((et) => [et.key, et.nameProperty]);
    expect(await named("legacy")).toEqual([
      ["article", "title"],
      ["empty", "name"],
      ["gauge", "name"],
      ["memo", "code"],
      ["reading", "name_2"],
      ["tag", "label"],
      ["ticket", "zeta"],
    ]);
    expect(await named("legacy_de")).toEqual([
      ["dokument", "titel"],
      ["ort", "bezeichnung"],
    ]);
    const languages = async (namespace: string) =>
      (await runQuery(`SELECT keyword_languages FROM ${namespace}.search_settings`)).rows;
    expect(await languages("ont_legacy")).toEqual([{ keyword_languages: ["english"] }]);
    expect(await languages("ont_legacy_de")).toEqual([{ keyword_languages: ["german"] }]);

    const included = async (namespace: string) =>
      (
        await runQuery(
          `SELECT coalesce(l.key || ':' || si.key, si.key) AS inclusion
             FROM ${namespace}.search_index si
             LEFT JOIN ${namespace}.lens_includes li ON li.search_index_id = si.search_index_id
             LEFT JOIN ${namespace}.lens l ON l.lens_id = li.lens_id
            ORDER BY 1`,
        )
      ).rows.map((row) => row["inclusion"]);
    // Unscoped lenses need no inclusion; `brief` hides `article.body`,
    // `full` shows only `memo.body`, `gauges` shows no property of its
    // type, `links` has relation inclusions only and so shows every type;
    // `kurz` hides `dokument.inhalt`.
    expect(await included("ont_legacy")).toEqual([
      "brief:article~default",
      "brief:tag~default",
      "full:article~body",
      "full:article~default",
      "full:memo~body",
      "full:memo~default",
      "gauges:gauge~default",
      "links:article~body",
      "links:article~default",
      "links:empty~default",
      "links:gauge~default",
      "links:memo~body",
      "links:memo~default",
      "links:reading~default",
      "links:tag~default",
      "links:ticket~default",
      "links:ticket~notes",
    ]);
    expect(await included("ont_legacy_de")).toEqual([
      "dokument~inhalt",
      "kurz:dokument~default",
      "kurz:ort~default",
    ]);
    // 5.1.0 has no retrievers: an empty retriever table; no assistants either.
    expect((await runQuery(`SELECT count(*)::int AS n FROM ont_legacy.assistant_retriever`)).rows).toEqual([
      { n: 0 },
    ]);
    expect((await runQuery(`SELECT count(*)::int AS n FROM ont_legacy.assistant_navigator`)).rows).toEqual([{ n: 0 }]);
  });

  it("upgrades 6.x storage to exactly the layout of a fresh ontology, keeping every agent and retriever", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    const lensId = randomUUID();
    const agentId = randomUUID();
    const retrieverId = randomUUID();
    const config = { indices: [], filters: [], answerFields: {}, threshold: 0.4, answerFieldCharacters: 500 };
    await withTransaction(async (querier) => {
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(
        `INSERT INTO ont_older.assistant_agent (assistant_agent_id, lens_id, key, name, system_prompt, tools)
         VALUES ($1, $2, 'helper', 'Helper', 'Be brief.', '{search}')`,
        [agentId, lensId],
      );
      await querier.query(
        `INSERT INTO ont_older.assistant_retriever (assistant_retriever_id, lens_id, key, name, config_version, config)
         VALUES ($1, $2, 'finder', 'Finder', 2, $3::jsonb)`,
        [retrieverId, lensId, JSON.stringify(config)],
      );
    });
    await makeVersion3Layout("ont_older");
    await recordVersion(3);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 3 to 8 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
    const agents = await runQuery(`SELECT assistant_agent_id, key, system_prompt, tools FROM ont_older.assistant_agent`);
    expect(agents.rows).toEqual([
      { assistant_agent_id: agentId, key: "helper", system_prompt: "Be brief.", tools: ["search"] },
    ]);
    // Both read through the port.
    const modeling = await getModelingStore("older");
    expect((await modeling.listAgents(lensId)).map((agent) => agent.key)).toEqual(["helper"]);
    const retriever = (await modeling.searchIndices!().getRetriever(lensId, "finder"))!;
    expect([retriever.retrieverId, retriever.config]).toEqual([retrieverId, config]);
  });

  it("upgrades 7.0 storage (version 4) by creating the navigator table, keeping every retriever", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    const lensId = randomUUID();
    await withTransaction(async (querier) => {
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(
        `INSERT INTO ont_older.assistant_retriever (assistant_retriever_id, lens_id, key, name, config_version, config)
         VALUES ($1, $2, 'finder', 'Finder', 2, '{}'::jsonb)`,
        [randomUUID(), lensId],
      );
    });
    await makeVersion4Layout("ont_older");
    await recordVersion(4);
    expect((await runQuery(`SELECT to_regclass('ont_older.assistant_navigator') AS t`)).rows).toEqual([{ t: null }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 4 to 8 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
    const retrievers = await runQuery(`SELECT key FROM ont_older.assistant_retriever`);
    expect(retrievers.rows).toEqual([{ key: "finder" }]);
    // The new table works through the port and goes with its lens.
    const navigators = (await getModelingStore("older")).navigators();
    const [saved, created] = await navigators.saveNavigator(
      lensId,
      { navigatorId: randomUUID(), key: "walker", name: "Walker", description: null, configVersion: 1, config: { hops: 2 } },
      false,
    );
    expect([saved.key, saved.config, created]).toEqual(["walker", { hops: 2 }, true]);
    await runQuery(`DELETE FROM ont_older.lens WHERE lens_id = $1`, [lensId]);
    expect(await navigators.listNavigators(lensId)).toEqual([]);
  });

  it("upgrades version-5 storage by naming the navigator table after its kind, keeping every navigator", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion5Layout("ont_older");
    const lensId = randomUUID();
    const navigatorId = randomUUID();
    await withTransaction(async (querier) => {
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(
        `INSERT INTO ont_older.assistant (assistant_id, lens_id, kind, key, name, description, config_version, config)
         VALUES ($1, $2, 'navigators', 'walker', 'Walker', 'Walks', 1, '{"hops": 3}'::jsonb)`,
        [navigatorId, lensId],
      );
    });
    await recordVersion(5);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 5 to 8 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    expect((await runQuery(`SELECT to_regclass('ont_older.assistant') AS t`)).rows).toEqual([{ t: null }]);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
    // The navigator is kept and reads through the port.
    const navigators = (await getModelingStore("older")).navigators();
    const kept = (await navigators.getNavigator(lensId, "walker"))!;
    expect([kept.navigatorId, kept.name, kept.description, kept.configVersion, kept.config]).toEqual([
      navigatorId, "Walker", "Walks", 1, { hops: 3 },
    ]);
    // One key per lens.
    await expect(navigators.saveNavigator(
      lensId,
      { navigatorId: randomUUID(), key: "walker", name: "Again", description: null, configVersion: 1, config: {} },
      true,
    )).rejects.toThrow("Navigator 'walker' already exists in the target lens");
  });

  it("upgrades version-6 storage by adding the parent end and the ruleset table, keeping every row", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion6Layout("ont_older");
    const [acme, p1, p2] = [randomUUID(), randomUUID(), randomUUID()];
    await withTransaction(async (querier) => {
      for (const key of ["customer", "project"]) {
        const typeId = randomUUID();
        await querier.query(
          `INSERT INTO ont_older.entity_type (entity_type_id, key, display_name, name_property)
           VALUES ($1, $2, $2, 'name')`,
          [typeId, key],
        );
        await querier.query(
          `INSERT INTO ont_older.property_def (property_id, entity_type_id, key, display_name, data_type, required)
           VALUES ($1, $2, 'name', 'Name', 'string', false)`,
          [randomUUID(), typeId],
        );
      }
      await querier.query(
        `INSERT INTO ont_older.relation_type
           (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key)
         VALUES ($1, 'has_project', 'Has Project', 'Ownership', 'customer', 'project')`,
        [randomUUID()],
      );
      await querier.query(
        `INSERT INTO ont_older.entity (id, type_key, props)
         VALUES ($1, 'customer', '{"name": "ACME"}'), ($2, 'project', '{"name": "P1"}'),
                ($3, 'project', '{"name": "P2"}')`,
        [acme, p1, p2],
      );
      await querier.query(
        `INSERT INTO ont_older.relation (id, type_key, from_id, to_id, props)
         VALUES ($1, 'has_project', $3, $4, '{}'), ($2, 'has_project', $3, $5, '{}')`,
        [randomUUID(), randomUUID(), acme, p1, p2],
      );
    });
    await recordVersion(6);
    const relationTypes = () =>
      runQuery(
        `SELECT relation_type_id, key, display_name, description, source_entity_type_key,
                target_entity_type_key, created_at, updated_at
           FROM ont_older.relation_type ORDER BY key`,
      );
    const before = { relationTypes: (await relationTypes()).rows, instances: await instances("ont_older") };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 6 to 8 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
    expect({ relationTypes: (await relationTypes()).rows, instances: await instances("ont_older") }).toEqual(before);
    expect((await runQuery(`SELECT count(*)::int AS n FROM ont_older.ruleset`)).rows).toEqual([{ n: 0 }]);
    // The kept relation type reads through the port as an ordinary one,
    // and takes a parent end.
    const modeling = await getModelingStore("older");
    const kept = (await modeling.getRelationTypeByKey("has_project"))!;
    expect(kept.parent).toBeNull();
    const flagged = await modeling.setRelationTypeParent(kept.relationTypeId as string, "source");
    expect(flagged).toMatchObject({ row: { parent: "source" } });
  });

  it("upgrades version-7 storage by adding the changeset tables and the write access, keeping every row", async () => {
    expect(STORAGE_VERSION).toBe(8);
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion7Layout("ont_older");
    const [acme, p1, lensId] = [randomUUID(), randomUUID(), randomUUID()];
    await withTransaction(async (querier) => {
      for (const key of ["customer", "project"]) {
        const typeId = randomUUID();
        await querier.query(
          `INSERT INTO ont_older.entity_type (entity_type_id, key, display_name, name_property)
           VALUES ($1, $2, $2, 'name')`,
          [typeId, key],
        );
        await querier.query(
          `INSERT INTO ont_older.property_def (property_id, entity_type_id, key, display_name, data_type, required)
           VALUES ($1, $2, 'name', 'Name', 'string', false)`,
          [randomUUID(), typeId],
        );
      }
      await querier.query(
        `INSERT INTO ont_older.relation_type
           (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, parent)
         VALUES ($1, 'has_project', 'Has Project', 'Ownership', 'customer', 'project', 'source')`,
        [randomUUID()],
      );
      await querier.query(
        `INSERT INTO ont_older.entity (id, type_key, props)
         VALUES ($1, 'customer', '{"name": "ACME"}'), ($2, 'project', '{"name": "P1"}')`,
        [acme, p1],
      );
      await querier.query(
        `INSERT INTO ont_older.relation (id, type_key, from_id, to_id, props)
         VALUES ($1, 'has_project', $2, $3, '{}')`,
        [randomUUID(), acme, p1],
      );
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(
        `INSERT INTO ont_older.ruleset (key, anchor_type_key, anchor_id) VALUES ('agent-a', 'project', $1)`,
        [p1],
      );
    });
    await recordVersion(7);
    const kept = async () => ({
      relationTypes: (await runQuery(`SELECT key, parent FROM ont_older.relation_type`)).rows,
      lenses: (await runQuery(`SELECT lens_id, key FROM ont_older.lens`)).rows,
      rulesets: (
        await runQuery(`SELECT key, anchor_type_key, anchor_id, created_at, updated_at FROM ont_older.ruleset`)
      ).rows,
      instances: await instances("ont_older"),
    });
    const before = await kept();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 7 to 8 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
    expect(await kept()).toEqual(before);
    // The existing ruleset has write access full; the new tables start empty.
    expect((await runQuery(`SELECT key, write_access FROM ont_older.ruleset`)).rows).toEqual([
      { key: "agent-a", write_access: "full" },
    ]);
    // The NOT NULL constraints carry the ruleset table's names; no CHECK.
    const constraints = await runQuery(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'ont_older.ruleset'::regclass ORDER BY conname`,
    );
    expect(constraints.rows).toEqual([
      { conname: "ruleset_created_at_not_null", contype: "n" },
      { conname: "ruleset_key_not_null", contype: "n" },
      { conname: "ruleset_pk", contype: "p" },
      { conname: "ruleset_updated_at_not_null", contype: "n" },
      { conname: "ruleset_write_access_not_null", contype: "n" },
    ]);
    const empty = await runQuery(
      `SELECT (SELECT count(*)::int FROM ont_older.changeset) AS changesets,
              (SELECT count(*)::int FROM ont_older.changeset_write) AS writes`,
    );
    expect(empty.rows).toEqual([{ changesets: 0, writes: 0 }]);
    // The ruleset still reads through the port.
    const ruleset = (await (await getRuntimeStore("older")).rulesets().get("agent-a"))!;
    expect(ruleset).toMatchObject({ key: "agent-a", anchor: { type: "project", id: p1 }, writeAccess: "full" });
  });

  it("a lens delete removes its changesets and their writes; a ruleset delete leaves them", async () => {
    await getOntologyRegistry().createOntology(ID_A, "fresh", null, null);
    const [lensId, p1, viaRuleset, plain] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await withTransaction(async (querier) => {
      await querier.query(`INSERT INTO ont_fresh.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(`INSERT INTO ont_fresh.entity (id, type_key) VALUES ($1, 'project')`, [p1]);
      await querier.query(
        `INSERT INTO ont_fresh.ruleset (key, anchor_type_key, anchor_id, write_access)
         VALUES ('agent-a', 'project', $1, 'propose')`,
        [p1],
      );
      await querier.query(
        `INSERT INTO ont_fresh.changeset (changeset_id, lens_id, ruleset_key, version)
         VALUES ($1, $3, 'agent-a', 1), ($2, $3, NULL, 1)`,
        [viaRuleset, plain, lensId],
      );
      await querier.query(
        `INSERT INTO ont_fresh.changeset_write (changeset_id, seq, operation, arguments, minted_id, type_key, bytes)
         VALUES ($1, 1, 'create_entity', '{"name": "T9"}', $3, 'task', 13),
                ($2, 1, 'create_entity', '{"name": "T10"}', $4, 'task', 14)`,
        [viaRuleset, plain, randomUUID(), randomUUID()],
      );
    });
    const counts = async () =>
      (
        await runQuery(
          `SELECT (SELECT count(*)::int FROM ont_fresh.changeset) AS changesets,
                  (SELECT count(*)::int FROM ont_fresh.changeset_write) AS writes`,
        )
      ).rows[0];

    expect(await (await getRuntimeStore("fresh")).rulesets().delete("agent-a")).toBe(true);
    expect(await counts()).toEqual({ changesets: 2, writes: 2 });

    expect(await (await getModelingStore("fresh")).deleteLens(lensId)).toBe(true);
    expect(await counts()).toEqual({ changesets: 0, writes: 0 });
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

  it("renames the retriever table and converts its configurations to version 2", async () => {
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

    const retrievers = await runQuery(
      `SELECT key, config_version, config, warnings FROM ont_older.assistant_retriever ORDER BY key`,
    );
    const soft =
      "Soft condition 'rule-2' of note was dropped: it needs a custom index with relation group about (outgoing).";
    // Keys with '-' follow the key rules, unique in the lens.
    expect(retrievers.rows.filter((row) => String(row["key"]).startsWith("fair")).map((row) => [row["key"], row["warnings"]])).toEqual([
      ["fair_search", [soft]],
      ["fair_search_2", [soft, "Key renamed from 'fair-search' to 'fair_search_2'."]],
    ]);
    expect(retrievers.rows.filter((row) => !String(row["key"]).startsWith("fair"))).toEqual([
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
    // The retriever reads through the port with its conversion notes.
    const indices = (await getModelingStore("older")).searchIndices!();
    expect((await indices.getRetriever(lensId, "notes"))!.warnings).toHaveLength(1);
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
