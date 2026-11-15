/**
 * PostgreSQL storage version — reaches past the persistence port on
 * purpose. Real 7.1.1 storage (version 8, where the 7.x line ended),
 * frozen in `tests/fixtures/storage-7.1.1.sql`, must be brought by the
 * boot (`initSchema`) to exactly the layout of a freshly created
 * ontology, every stored row kept and its version recorded. Storage at
 * versions 9 to 13 is produced from a fresh ontology by dropping what the
 * later steps add (`makeVersion…Layout`); each upgrade lands on the fresh
 * layout too. The upgrade runs once however many servers start together;
 * a failing upgrade, storage older than the oldest upgradable version or
 * from before the version table, and storage newer than the code leave
 * the storage untouched. Requires the docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "../../../src/adapters/postgres/ddl.js";
import { runQuery, withTransaction } from "../../../src/adapters/postgres/errors.js";
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

/** The namespaces of the 7.1.1 fixture: `upgrade` (English) and
 * `upgrade_de` (German). */
const RELEASE_711 = ["ont_upgrade", "ont_upgrade_de"];

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

/** Storage made by the 7.1.1 server: its registry and version tables,
 * recorded at version 8, and both namespaces. */
async function loadRelease711(): Promise<void> {
  await runQuery(`DROP TABLE public.storage_version`);
  await runQuery(`DROP TABLE public.ontology`);
  await runQuery(readFileSync(new URL("../../fixtures/storage-7.1.1.sql", import.meta.url), "utf8"));
}

/** The columns of every table of a namespace, search-entry partitions
 * included, in column order. */
async function tableColumns(namespace: string): Promise<Map<string, string[]>> {
  const found = await runQuery(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
       JOIN pg_class t ON t.relname = c.table_name
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
      WHERE c.table_schema = $1 AND t.relkind = 'r'
      ORDER BY c.table_name, c.ordinal_position`,
    [namespace],
  );
  const columns = new Map<string, string[]>();
  for (const row of found.rows) {
    const table = row["table_name"] as string;
    columns.set(table, [...(columns.get(table) ?? []), row["column_name"] as string]);
  }
  return columns;
}

/** Every stored row of a namespace, table by table, read through the
 * given columns — those a table had before an upgrade — minus `omit`. */
async function storedRows(
  namespace: string,
  columns: Map<string, string[]>,
  omit: Record<string, string[]> = {},
): Promise<Record<string, string[]>> {
  const rows: Record<string, string[]> = {};
  for (const [table, all] of columns) {
    const read = all.filter((column) => !(omit[table] ?? []).includes(column)).map((c) => `"${c}"`);
    const found = await runQuery(
      `SELECT row_to_json(r)::text AS row FROM (SELECT ${read.join(", ")} FROM ${namespace}."${table}") r ORDER BY 1`,
    );
    rows[table] = found.rows.map((row) => row["row"] as string);
  }
  return rows;
}

/** Storage at version 13: step 13's table of search trees in place of the
 * search-profile table. Records no version. */
async function makeVersion13Layout(namespace: string): Promise<void> {
  await makeVersion12Layout(namespace);
  await runQuery(`CREATE TABLE ${namespace}.named_search (
  named_search_id uuid        CONSTRAINT named_search_pk PRIMARY KEY,
  lens_id         uuid        NOT NULL CONSTRAINT named_search_lens_fk
                              REFERENCES ${namespace}.lens (lens_id) ON DELETE CASCADE,
  key             text        NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  tree            jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT named_search_key_unique UNIQUE (lens_id, key)
)`);
}

/** Storage at version 12 — and 11, whose step only rewrites data: no
 * search-profile table. Records no version — every older layout builds on
 * it. */
async function makeVersion12Layout(namespace: string): Promise<void> {
  await runQuery(`DROP TABLE ${namespace}.search_profile`);
}

/** Storage at version 10: no one per pair on relation types, and no index
 * of staged values by value. Records no version — `makeVersion9Layout`
 * builds on it. */
async function makeVersion10Layout(namespace: string): Promise<void> {
  await makeVersion12Layout(namespace);
  await runQuery(`ALTER TABLE ${namespace}.relation_type DROP COLUMN one_per_pair`);
  await runQuery(`DROP INDEX ${namespace}.changeset_value_match_idx`);
}

/** Storage at version 9: no entity identity. Records no version —
 * `makeVersion8Layout` builds on it. */
async function makeVersion9Layout(namespace: string): Promise<void> {
  await makeVersion10Layout(namespace);
  await runQuery(`ALTER TABLE ${namespace}.entity DROP CONSTRAINT entity_identity_unique`);
  await runQuery(`ALTER TABLE ${namespace}.entity DROP COLUMN identity`);
  await runQuery(`ALTER TABLE ${namespace}.entity_type DROP COLUMN identity_properties`);
}

/** Storage at version 8 — where the 7.x line ended: no design revision.
 * Records no version. */
async function makeVersion8Layout(namespace: string): Promise<void> {
  await makeVersion9Layout(namespace);
  await runQuery(`DROP TABLE ${namespace}.design_revision`);
}

interface Layout {
  columns: unknown[];
  constraints: unknown[];
  indexes: { indexname: string; indexdef: string }[];
}

/** Every column, constraint and index of one namespace, namespace-free.
 * The search-entry partitions are left out: each belongs to a generation,
 * whose lifecycle is its own, not the storage version's. */
async function layout(namespace: string): Promise<Layout> {
  const strip = (value: unknown) => String(value).replaceAll(`${namespace}.`, "");
  const partitions = `SELECT t.relname FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
                       WHERE n.nspname = $1 AND t.relispartition`;
  // Column order, not raw positions: a dropped column keeps its slot, and
  // `makeVersion…Layout` drops some.
  const columns = await runQuery(
    `SELECT table_name, column_name, data_type, is_nullable, column_default,
            row_number() OVER (PARTITION BY table_name ORDER BY ordinal_position) AS position
       FROM information_schema.columns WHERE table_schema = $1 AND table_name NOT IN (${partitions})
      ORDER BY table_name, ordinal_position`,
    [namespace],
  );
  const constraints = await runQuery(
    `SELECT t.relname, c.conname, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND NOT t.relispartition ORDER BY t.relname, c.conname`,
    [namespace],
  );
  const indexes = await runQuery(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = $1 AND tablename NOT IN (${partitions}) ORDER BY indexname`,
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
  });

  it("a fresh database is recorded at the current version", async () => {
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
  });

  it("upgrades real 7.1.1 storage to exactly the layout of a fresh ontology, keeping every row", async () => {
    await loadRelease711();
    const columns = await Promise.all(RELEASE_711.map((namespace) => tableColumns(namespace)));
    // Step 12 rewrites the steps of saved queries; every other value stays.
    const omit = { saved_query: ["steps"] };
    const before = await Promise.all(RELEASE_711.map((namespace, i) => storedRows(namespace, columns[i]!, omit)));
    expect(before[0]!["entity"]).toHaveLength(9);
    expect(before[0]!["changeset_value"]).toHaveLength(5);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 8 to 14 (2 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    expect(await Promise.all(RELEASE_711.map((namespace, i) => storedRows(namespace, columns[i]!, omit)))).toEqual(
      before,
    );
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    const fresh = await layout("ont_fresh");
    expect(await layout("ont_upgrade")).toEqual(fresh);
    expect(await layout("ont_upgrade_de")).toEqual(fresh);
    // A second start finds the storage current and changes nothing.
    log.mockClear();
    await initSchema();
    expect(log).not.toHaveBeenCalled();
    expect(await layout("ont_upgrade")).toEqual(fresh);
  });

  it("gives real 7.1.1 storage its design revisions, entity searches and rules, read through the port", async () => {
    await loadRelease711();

    await initSchema();

    // The design revision starts at 1 under the registry's id.
    const registry = await getOntologyRegistry().listOntologies();
    for (const { key, ontologyId } of registry) {
      expect(await (await getRuntimeStore(key)).designRevision()).toEqual({ ontologyId, revision: 1 });
    }
    expect(registry.map((ontology) => ontology.key).sort()).toEqual(["upgrade", "upgrade_de"]);
    // The search step of a saved query became an entity search.
    const steps = await runQuery(`SELECT key, steps FROM ont_upgrade.saved_query ORDER BY key`);
    expect(steps.rows.map((row) => [row["key"], JSON.parse(row["steps"] as string)])).toEqual([
      ["open_tasks", [{ name: "main", type: "oql", oql: "MATCH (t:task) WHERE t.done = false RETURN t" }]],
      [
        "projects_of",
        [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (c:customer)-[:has_project]->(p:project) WHERE c.name = $customer RETURN p",
          },
        ],
      ],
      [
        "tasks_by_text",
        [
          { name: "found", type: "search", types: ["task"], query: "$q", limit: 5 },
          {
            name: "tasks",
            type: "oql",
            oql: "MATCH (t:task) WHERE t._id IN $ids RETURN t.name",
            bindings: { ids: "{{found._id}}" },
          },
        ],
      ],
    ]);
    // No entity type has identity properties, no entity an identity, no
    // lens a search profile.
    const added = await runQuery(
      `SELECT (SELECT count(*)::int FROM ont_upgrade.entity_type WHERE identity_properties IS NOT NULL) AS types,
              (SELECT count(*)::int FROM ont_upgrade.entity WHERE identity IS NOT NULL) AS entities,
              (SELECT count(*)::int FROM ont_upgrade.search_profile) AS profiles`,
    );
    expect(added.rows).toEqual([{ types: 0, entities: 0, profiles: 0 }]);
    // One per pair reads as on under a parent end, off elsewhere.
    const modeling = await getModelingStore("upgrade");
    expect((await modeling.listRelationTypes()).map((rt) => [rt.key, rt.parent, rt.onePerPair])).toEqual([
      ["assigned_to", null, false],
      ["has_project", "source", true],
      ["has_task", "source", true],
    ]);
    // Rulesets and assistants still read through the port.
    const ruleset = (await (await getRuntimeStore("upgrade")).rulesets().get("bridge_crew"))!;
    expect(ruleset).toMatchObject({ key: "bridge_crew", anchor: { type: "project" }, writeAccess: "propose" });
    const lensId = (await runQuery(`SELECT lens_id FROM ont_upgrade.lens WHERE key = 'all'`)).rows[0]!["lens_id"] as string;
    expect((await modeling.navigators().getNavigator(lensId, "walker"))!.config).toMatchObject({ hops: 2 });
    expect((await modeling.searchIndices!().getRetriever(lensId, "task_finder"))!.configVersion).toBe(2);
    expect((await modeling.listAgents(lensId)).map((agent) => agent.key)).toEqual(["helper"]);
  });

  it("upgrades version-8 storage by adding the design revision at 1, under the registry's id", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await getOntologyRegistry().createOntology(ID_B, "other", null, null);
    await makeVersion8Layout("ont_older");
    await makeVersion8Layout("ont_other");
    await recordVersion(8);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 8 to 14 (2 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    expect((await runQuery(`SELECT ontology_id, revision FROM ont_older.design_revision`)).rows).toEqual([
      { ontology_id: ID_A, revision: 1 },
    ]);
    expect((await runQuery(`SELECT ontology_id, revision FROM ont_other.design_revision`)).rows).toEqual([
      { ontology_id: ID_B, revision: 1 },
    ]);
    // Read through the port, and advanced by a design change.
    expect(await (await getRuntimeStore("older")).designRevision()).toEqual({ ontologyId: ID_A, revision: 1 });
    await (await getModelingStore("older")).changeDesign(async () => undefined);
    expect(await (await getRuntimeStore("older")).designRevision()).toEqual({ ontologyId: ID_A, revision: 2 });
    const fresh = randomUUID();
    await getOntologyRegistry().createOntology(fresh, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });


  it("upgrades version-9 storage by adding entity identity: no type has one, every entity keeps its row", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion9Layout("ont_older");
    const [typeId, entityId] = [randomUUID(), randomUUID()];
    await withTransaction(async (querier) => {
      await querier.query(
        `INSERT INTO ont_older.entity_type (entity_type_id, key, display_name, name_property)
         VALUES ($1, 'part', 'Part', 'name')`,
        [typeId],
      );
      await querier.query(
        `INSERT INTO ont_older.property_def (property_id, entity_type_id, key, display_name, data_type, required)
         VALUES ($1, $2, 'name', 'Name', 'string', false)`,
        [randomUUID(), typeId],
      );
      await querier.query(`INSERT INTO ont_older.entity (id, type_key, props) VALUES ($1, 'part', '{"name": "Bolt"}')`, [
        entityId,
      ]);
    });
    await recordVersion(9);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 9 to 14 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    expect((await runQuery(`SELECT identity_properties FROM ont_older.entity_type`)).rows).toEqual([
      { identity_properties: null },
    ]);
    expect((await runQuery(`SELECT id, props, identity FROM ont_older.entity`)).rows).toEqual([
      { id: entityId, props: { name: "Bolt" }, identity: null },
    ]);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });


  it("upgrades version-10 storage by adding one per pair: off on ordinary relation types, read as on under a parent end", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion10Layout("ont_older");
    await withTransaction(async (querier) => {
      for (const key of ["company", "project"]) {
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
           (relation_type_id, key, display_name, source_entity_type_key, target_entity_type_key, parent)
         VALUES ($1, 'has_project', 'Has project', 'company', 'project', 'source'),
                ($2, 'works_with', 'Works with', 'company', 'company', NULL)`,
        [randomUUID(), randomUUID()],
      );
    });
    await recordVersion(10);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 10 to 14 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    const modeling = await getModelingStore("older");
    expect((await modeling.listRelationTypes()).map((rt) => [rt.key, rt.onePerPair])).toEqual([
      ["has_project", true],
      ["works_with", false],
    ]);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });


  it("upgrades version-11 storage by making search steps entity searches, deleting what binds more than references", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion12Layout("ont_older");
    const steps = (field: string) => [
      { name: "skills", type: "search", entityTypeKey: "skill", query: "$q", limit: 5 },
      { name: "people", type: "oql", oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p", bindings: { ids: `{{skills.${field}}}` } },
    ];
    const oqlOnly = [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" }];
    await withTransaction(async (querier) => {
      const lensId = randomUUID();
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      for (const [key, pipeline] of [["by-id", steps("_id")], ["by-title", steps("title")], ["oql-only", oqlOnly]] as const) {
        await querier.query(
          `INSERT INTO ont_older.saved_query (saved_query_id, lens_id, lens_key, key, name, description, steps, parameters)
           VALUES ($1, $2, 'all', $3, $3, 'd', $4, '[]')`,
          [randomUUID(), lensId, key, JSON.stringify(pipeline)],
        );
      }
    });
    await recordVersion(11);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 11 to 14 (1 ontologies).");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Deleting saved query 'by-title' of lens 'all'"));
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    const stored = await runQuery(`SELECT key, steps FROM ont_older.saved_query ORDER BY key`);
    expect(stored.rows.map((row) => [row["key"], JSON.parse(row["steps"] as string)])).toEqual([
      [
        "by-id",
        [
          { name: "skills", type: "search", types: ["skill"], query: "$q", limit: 5 },
          { name: "people", type: "oql", oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p", bindings: { ids: "{{skills._id}}" } },
        ],
      ],
      ["oql-only", oqlOnly],
    ]);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });


  it("upgrades version-12 storage by adding the search-profile table, deleted with its lens", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion12Layout("ont_older");
    await recordVersion(12);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 12 to 14 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
    // The table works: a search profile of a lens goes with the lens.
    const modeling = await getModelingStore("older");
    const lensId = randomUUID();
    await modeling.createLens(lensId, "all", "All", null);
    const tree = { kind: "cut", limit: 5, input: { kind: "keywordSearch", index: "x", text: "$query" } };
    const [row, created] = await modeling.upsertSearchProfile(lensId, randomUUID(), "find", "Find", "d", JSON.stringify(tree));
    expect([created, row["tree"]]).toEqual([true, tree]);
    expect(await modeling.deleteLens(lensId)).toBe(true);
    const left = await runQuery(`SELECT count(*)::int AS n FROM ont_older.search_profile`);
    expect(left.rows[0]!["n"]).toBe(0);
  });


  it("upgrades version-13 storage by replacing step 13's table, rows and all, with the search-profile table", async () => {
    await getOntologyRegistry().createOntology(ID_A, "older", null, null);
    await makeVersion13Layout("ont_older");
    const lensId = randomUUID();
    await withTransaction(async (querier) => {
      await querier.query(`INSERT INTO ont_older.lens (lens_id, key, name) VALUES ($1, 'all', 'All')`, [lensId]);
      await querier.query(
        `INSERT INTO ont_older.named_search (named_search_id, lens_id, key, name, description, tree)
         VALUES ($1, $2, 'find', 'Find', 'd', '{}'::jsonb)`,
        [randomUUID(), lensId],
      );
    });
    await recordVersion(13);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await initSchema();

    expect(log).toHaveBeenCalledWith("Upgrading storage from version 13 to 14 (1 ontologies).");
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
    const gone = await runQuery(`SELECT to_regclass('ont_older.named_search') IS NULL AS gone`);
    expect(gone.rows[0]!["gone"]).toBe(true);
    const left = await runQuery(`SELECT count(*)::int AS n FROM ont_older.search_profile`);
    expect(left.rows[0]!["n"]).toBe(0);
    await getOntologyRegistry().createOntology(ID_B, "fresh", null, null);
    expect(await layout("ont_older")).toEqual(await layout("ont_fresh"));
  });


  it("a lens delete removes its changesets with their objects and values; a ruleset delete leaves them", async () => {
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
        `INSERT INTO ont_fresh.changeset (changeset_id, lens_id, number, ruleset_key, version)
         VALUES ($1, $3, 1, 'agent-a', 1), ($2, $3, 2, NULL, 1)`,
        [viaRuleset, plain, lensId],
      );
      const [t9, t10] = [randomUUID(), randomUUID()];
      await querier.query(
        `INSERT INTO ont_fresh.changeset_object (changeset_id, object_id, kind, type_key, action, first_touched_at)
         VALUES ($1, $3, 'entity', 'task', 'create', now()), ($2, $4, 'entity', 'task', 'create', now())`,
        [viaRuleset, plain, t9, t10],
      );
      await querier.query(
        `INSERT INTO ont_fresh.changeset_value (changeset_id, object_id, property_key, value, bytes)
         VALUES ($1, $3, 'name', '"T9"', 4), ($2, $4, 'name', '"T10"', 5)`,
        [viaRuleset, plain, t9, t10],
      );
    });
    const counts = async () =>
      (
        await runQuery(
          `SELECT (SELECT count(*)::int FROM ont_fresh.changeset) AS changesets,
                  (SELECT count(*)::int FROM ont_fresh.changeset_object) AS objects,
                  (SELECT count(*)::int FROM ont_fresh.changeset_value) AS "values"`,
        )
      ).rows[0];

    expect(await (await getRuntimeStore("fresh")).rulesets().delete("agent-a")).toBe(true);
    expect(await counts()).toEqual({ changesets: 2, objects: 2, values: 2 });

    expect(await (await getModelingStore("fresh")).deleteLens(lensId)).toBe(true);
    expect(await counts()).toEqual({ changesets: 0, objects: 0, values: 0 });
  });


  it("several servers starting together upgrade once", async () => {
    await loadRelease711();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await Promise.all([initSchema(), initSchema(), initSchema()]);

    const upgrades = log.mock.calls.filter(([line]) => String(line).startsWith("Upgrading storage"));
    expect(upgrades).toHaveLength(1);
    expect(await recordedVersion()).toBe(STORAGE_VERSION);
  });

  it("a failing upgrade leaves the version and every namespace as they were", async () => {
    await getOntologyRegistry().createOntology(ID_A, "first", null, null);
    await getOntologyRegistry().createOntology(ID_B, "second", null, null);
    await makeVersion8Layout("ont_first");
    await makeVersion8Layout("ont_second");
    // Step 9 fails in the second namespace, after it ran in the first.
    await runQuery(`CREATE TABLE ont_second.design_revision (stray integer)`);
    await recordVersion(8);
    const before = { first: await layout("ont_first"), second: await layout("ont_second") };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(initSchema()).rejects.toThrow("A storage operation failed");
    expect(String(failure.mock.calls[0])).toContain('relation "design_revision" already exists');

    expect(await recordedVersion()).toBe(8);
    expect({ first: await layout("ont_first"), second: await layout("ont_second") }).toEqual(before);
  });

  it("storage older than the oldest upgradable version stops the boot and stays untouched", async () => {
    await loadRelease711();
    await recordVersion(7);
    const before = await Promise.all(RELEASE_711.map((namespace) => layout(namespace)));

    await expect(initSchema()).rejects.toThrow(
      "Storage is version 7; this release upgrades from version 8 on. Upgrade through the last release of the previous major line first.",
    );

    expect(await recordedVersion()).toBe(7);
    expect(await Promise.all(RELEASE_711.map((namespace) => layout(namespace)))).toEqual(before);
  });

  it("storage from before the version table stops the boot and stays untouched", async () => {
    await loadRelease711();
    await runQuery(`DROP TABLE public.storage_version`);
    const before = await Promise.all(RELEASE_711.map((namespace) => layout(namespace)));

    await expect(initSchema()).rejects.toThrow("Storage is version 1; this release upgrades from version 8 on.");

    const versioned = await runQuery(`SELECT to_regclass('public.storage_version') IS NOT NULL AS versioned`);
    expect(versioned.rows).toEqual([{ versioned: false }]);
    expect(await Promise.all(RELEASE_711.map((namespace) => layout(namespace)))).toEqual(before);
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
