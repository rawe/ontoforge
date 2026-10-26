/**
 * The storage-version decision at boot, against a scripted querier: what
 * an empty, an unversioned (5.x), an unreleased version-2, a 6.x, a 7.0
 * (version 4, 5 or 6), a version-7, a version-8, a current, a newer and a too-old database each lead to. The real upgrade against PostgreSQL is covered by
 * `tests/integration/postgres/storage-version.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbResult, Querier } from "../../../src/adapters/postgres/errors.js";
import {
  bringStorageUpToDate,
  OLDEST_UPGRADABLE_VERSION,
  STORAGE_VERSION,
} from "../../../src/adapters/postgres/storageVersion.js";

const SERVER_DDL = ["CREATE TABLE IF NOT EXISTS public.storage_version (version integer NOT NULL)"];

/** A database as the boot sees it: the version row (absent = unversioned),
 * whether the registry exists, its ontology namespaces, whether they
 * keep retrievers in `retriever_config` (the unreleased version 2), and
 * whether another server holds the storage lock. */
function database(state: {
  version?: number;
  registry: boolean;
  namespaces?: string[];
  retrieverConfig?: boolean;
  lockHeld?: boolean;
}) {
  const queries: string[] = [];
  const querier: Querier = {
    async query(text: string): Promise<DbResult> {
      queries.push(text);
      if (text.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: !(state.lockHeld ?? false) }], rowCount: 1 };
      }
      if (text.includes("to_regclass") && text.includes("retriever_config")) {
        return { rows: [{ present: state.retrieverConfig ?? false }], rowCount: 1 };
      }
      if (text.includes("to_regclass")) {
        return { rows: [{ versioned: state.version !== undefined, registry: state.registry }], rowCount: 1 };
      }
      if (text.startsWith("SELECT version")) return { rows: [{ version: state.version }], rowCount: 1 };
      if (text.startsWith("SELECT namespace")) {
        const rows = (state.namespaces ?? []).map((namespace) => ({ namespace }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { querier, queries };
}

/** Step 8 in one namespace: the changeset tables with their indexes, then
 * the write access of a ruleset. */
const step8 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  expect.stringMatching(/^CREATE TABLE changeset \(/),
  "CREATE INDEX changeset_lens_id_idx ON changeset (lens_id)",
  expect.stringMatching(/^CREATE TABLE changeset_object \(/),
  "CREATE INDEX changeset_object_touched_idx ON changeset_object (changeset_id, first_touched_at, object_id)",
  expect.stringMatching(/^CREATE TABLE changeset_value \(/),
  "ALTER TABLE ruleset ADD COLUMN write_access text NOT NULL DEFAULT 'full'",
];

/** Step 9 in one namespace: the design revision table and its row. */
const step9 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  expect.stringMatching(/^CREATE TABLE design_revision \(/),
  expect.stringMatching(/^INSERT INTO design_revision \(ontology_id, revision\)\s+SELECT ontology_id, 1 FROM public.ontology WHERE namespace = current_schema\(\)$/),
];

/** Step 10 in one namespace: entity identity. */
const step10 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  "ALTER TABLE entity_type ADD COLUMN identity_properties text[]",
  "ALTER TABLE entity ADD COLUMN identity text",
  expect.stringMatching(
    /^ALTER TABLE entity ADD CONSTRAINT entity_identity_unique UNIQUE \(type_key, identity\)\s+DEFERRABLE INITIALLY IMMEDIATE$/,
  ),
];

const writes = (queries: string[]) => queries.filter((q) => /^(INSERT|DELETE|CREATE|LOCK TABLE)/.test(q));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("storage version at boot", () => {
  it("takes the database-wide lock before reading the version", async () => {
    const { querier, queries } = database({ version: STORAGE_VERSION, registry: true });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(queries[0]).toContain("pg_try_advisory_xact_lock");
    expect(queries.some((q) => q.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("says it waits while another server holds the lock, then takes it", async () => {
    const { querier, queries } = database({ version: STORAGE_VERSION, registry: true, lockHeld: true });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(console.log).toHaveBeenCalledWith("Waiting for another server to bring the storage up to date.");
    expect(queries[1]).toContain("pg_advisory_xact_lock");
  });

  it("records an empty database at the current version without running a step", async () => {
    const { querier, queries } = database({ registry: false });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(writes(queries)).toEqual([
      SERVER_DDL[0],
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
  });

  it("changes nothing on storage already at the current version", async () => {
    const { querier, queries } = database({ version: STORAGE_VERSION, registry: true });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(writes(queries)).toEqual([SERVER_DDL[0]]);
  });

  it("upgrades unversioned storage — the 5.x line — in every ontology namespace, the number last", async () => {
    expect(OLDEST_UPGRADABLE_VERSION).toBe(1);
    const { querier, queries } = database({ registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    // The version table comes first: 5.x storage has none.
    expect(queries.indexOf(SERVER_DDL[0]!)).toBeLessThan(queries.indexOf("SET LOCAL search_path TO ont_a, public"));
    const bound = queries.filter((q) => q.startsWith("SET LOCAL search_path"));
    // Step by step: the 6.0 step, the 7.0 step, the assistant step, the
    // navigator step, the parent-and-ruleset step, the changeset step, the
    // design revision step, then the identity step, each in every namespace.
    expect(bound).toEqual(Array.from({ length: 8 }, () => [
      "SET LOCAL search_path TO ont_a, public",
      "SET LOCAL search_path TO ont_b, public",
      "SET LOCAL search_path TO public",
    ]).flat());
    expect(queries.filter((q) => q.startsWith("CREATE TABLE assistant ("))).toHaveLength(2);
    expect(queries.filter((q) => q.includes("ADD COLUMN name_property"))).toHaveLength(2);
    // The registry's language goes once, after every namespace took it over.
    const dropped = queries.indexOf("ALTER TABLE public.ontology DROP COLUMN text_search_language");
    expect(dropped).toBeGreaterThan(queries.indexOf("SET LOCAL search_path TO ont_b, public"));
    expect(dropped).toBeLessThan(queries.indexOf("ALTER TABLE ai_agent_config RENAME TO assistant_agent"));
    expect(queries.filter((q) => q.includes("text_search_language"))).toHaveLength(3);
    // 5.x has no retrievers: each namespace gets an empty agent table.
    expect(queries.filter((q) => q.startsWith("CREATE TABLE retriever_agent"))).toHaveLength(2);
    expect(queries.filter((q) => q.includes("RENAME TO retriever_agent"))).toEqual([]);
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 1 to 10"));
  });

  it("upgrades storage at the unreleased version 2 by the same step, taking its retrievers over", async () => {
    const { querier, queries } = database({
      version: 2,
      registry: true,
      namespaces: ["ont_a"],
      retrieverConfig: true,
    });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(queries.filter((q) => q.includes("ADD COLUMN name_property"))).toHaveLength(1);
    expect(queries).toContain("ALTER TABLE retriever_config RENAME TO retriever_agent");
    expect(queries.filter((q) => q.startsWith("CREATE TABLE retriever_agent"))).toEqual([]);
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 2 to 10"));
  });

  it("upgrades 6.x storage (version 3) by the 7.0 step and the assistant step, naming the assistant tables after their kind", async () => {
    const { querier, queries } = database({ version: 3, registry: true, namespaces: ["ont_a"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(queries.filter((q) => q.includes("ADD COLUMN name_property"))).toEqual([]);
    expect(queries).toContain("ALTER TABLE ai_agent_config RENAME TO assistant_agent");
    expect(queries).toContain("ALTER TABLE retriever_agent RENAME TO assistant_retriever");
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(queries.filter((q) => q.startsWith("CREATE TABLE assistant ("))).toHaveLength(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 3 to 10"));
  });

  it("upgrades version-4 storage by the assistant step and the navigator step: one assistant table per namespace", async () => {
    const { querier, queries } = database({ version: 4, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(queries).not.toContain("ALTER TABLE ai_agent_config RENAME TO assistant_agent");
    expect(queries.filter((q) => q.includes("ADD COLUMN name_property"))).toEqual([]);
    const created = queries.filter((q) => q.startsWith("CREATE TABLE assistant ("));
    expect(created).toHaveLength(2);
    expect(created[0]).toContain("CONSTRAINT assistant_pk PRIMARY KEY");
    expect(created[0]).toContain("CONSTRAINT assistant_lens_fk");
    expect(created[0]).toContain("ON DELETE CASCADE");
    expect(created[0]).toContain("CONSTRAINT assistant_key_unique UNIQUE (lens_id, kind, key)");
    expect(queries.filter((q) => q === "ALTER TABLE assistant RENAME TO assistant_navigator")).toHaveLength(2);
    expect(queries.filter((q) => q.startsWith("SET LOCAL search_path"))).toEqual(Array.from({ length: 6 }, () => [
      "SET LOCAL search_path TO ont_a, public",
      "SET LOCAL search_path TO ont_b, public",
      "SET LOCAL search_path TO public",
    ]).flat());
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 4 to 10"));
  });

  it("upgrades version-5 storage by the navigator step: the assistant table becomes the navigator table", async () => {
    const { querier, queries } = database({ version: 5, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(queries.filter((q) => q.startsWith("CREATE TABLE assistant ("))).toEqual([]);
    expect(queries.filter((q) => q === "ALTER TABLE assistant RENAME TO assistant_navigator")).toHaveLength(2);
    expect(queries).toContain("ALTER TABLE assistant_navigator DROP COLUMN kind");
    expect(queries).toContain(
      "ALTER TABLE assistant_navigator ADD CONSTRAINT assistant_navigator_key_unique UNIQUE (lens_id, key)",
    );
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 5 to 10"));
  });

  it("upgrades version-6 storage by steps 7 to 10, each in every namespace, the number last", async () => {
    const { querier, queries } = database({ version: 6, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    const step7 = (namespace: string) => [
      `SET LOCAL search_path TO ${namespace}, public`,
      "ALTER TABLE relation_type ADD COLUMN parent text",
      expect.stringMatching(/^CREATE TABLE ruleset \(/),
    ];
    expect(ran).toEqual([
      ...step7("ont_a"),
      ...step7("ont_b"),
      "SET LOCAL search_path TO public",
      ...step8("ont_a"),
      ...step8("ont_b"),
      "SET LOCAL search_path TO public",
      ...step9("ont_a"),
      ...step9("ont_b"),
      "SET LOCAL search_path TO public",
      ...step10("ont_a"),
      ...step10("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    const ruleset = queries.find((q) => q.startsWith("CREATE TABLE ruleset"))!;
    expect(ruleset).toContain("anchor_type_key text");
    expect(ruleset).toContain("anchor_id       uuid");
    // No FK to entity, no CHECK.
    expect(ruleset).not.toMatch(/REFERENCES|CHECK/);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 6 to 10 (2 ontologies).");
  });

  it("upgrades version-7 storage by steps 8, 9 and 10, in every namespace, the number last", async () => {
    const { querier, queries } = database({ version: 7, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step8("ont_a"),
      ...step8("ont_b"),
      "SET LOCAL search_path TO public",
      ...step9("ont_a"),
      ...step9("ont_b"),
      "SET LOCAL search_path TO public",
      ...step10("ont_a"),
      ...step10("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    const changeset = queries.find((q) => q.startsWith("CREATE TABLE changeset ("))!;
    expect(changeset).toContain("CONSTRAINT changeset_pk PRIMARY KEY");
    expect(changeset).toMatch(/CONSTRAINT changeset_lens_fk\s+REFERENCES lens \(lens_id\) ON DELETE CASCADE/);
    expect(changeset).toMatch(/^\s+number\s+integer\s+NOT NULL,$/m);
    const objects = queries.find((q) => q.startsWith("CREATE TABLE changeset_object ("))!;
    expect(objects).toMatch(
      /CONSTRAINT changeset_object_changeset_fk\s+REFERENCES changeset \(changeset_id\) ON DELETE CASCADE/,
    );
    expect(objects).toContain("CONSTRAINT changeset_object_pk PRIMARY KEY (changeset_id, object_id)");
    const values = queries.find((q) => q.startsWith("CREATE TABLE changeset_value ("))!;
    expect(values).toContain("CONSTRAINT changeset_value_pk PRIMARY KEY (changeset_id, object_id, property_key)");
    expect(values).toMatch(
      /FOREIGN KEY \(changeset_id, object_id\)\s+REFERENCES changeset_object \(changeset_id, object_id\) ON DELETE CASCADE/,
    );
    // A value of a create has no before.
    expect(values).toMatch(/^\s+before\s+jsonb,$/m);
    // One FK each, no FK to ruleset, no CHECK.
    for (const table of [changeset, objects, values]) {
      expect(table.match(/REFERENCES/g)).toHaveLength(1);
      expect(table).not.toMatch(/CHECK|ruleset \(/);
    }
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 7 to 10 (2 ontologies).");
  });

  it("upgrades version-8 storage — the 7.1 line — by steps 9 and 10, in every namespace, the number last", async () => {
    const { querier, queries } = database({ version: 8, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step9("ont_a"),
      ...step9("ont_b"),
      "SET LOCAL search_path TO public",
      ...step10("ont_a"),
      ...step10("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    const table = queries.find((q) => q.startsWith("CREATE TABLE design_revision ("))!;
    // One row, no FK: the registry lives in another namespace.
    expect(table).toContain("CONSTRAINT design_revision_singleton CHECK (singleton)");
    expect(table).not.toMatch(/REFERENCES/);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 8 to 10 (2 ontologies).");
  });

  it("upgrades version-9 storage by step 10 alone: the identity columns, constraint and index in every namespace", async () => {
    expect(STORAGE_VERSION).toBe(10);
    const { querier, queries } = database({ version: 9, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step10("ont_a"),
      ...step10("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 9 to 10 (2 ontologies).");
  });

  it("refuses storage newer than the code and writes nothing", async () => {
    const { querier, queries } = database({ version: STORAGE_VERSION + 1, registry: true });
    await expect(bringStorageUpToDate(querier, SERVER_DDL)).rejects.toThrow("Use a newer release");
    expect(writes(queries)).toEqual([]);
  });

  it("refuses storage older than the oldest upgradable version and writes nothing", async () => {
    const { querier, queries } = database({ version: OLDEST_UPGRADABLE_VERSION - 1, registry: true });
    await expect(bringStorageUpToDate(querier, SERVER_DDL)).rejects.toThrow("previous major line first");
    expect(writes(queries)).toEqual([]);
  });
});
