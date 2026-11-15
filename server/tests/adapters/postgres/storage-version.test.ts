/**
 * The storage-version decision at boot, against a scripted querier: what
 * an empty, a 7.x (version 8), a version-9 to version-13, a current, a
 * newer, a too-old and an unversioned (5.x) database each lead to. The real upgrade against PostgreSQL is covered by
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
 * whether the registry exists, its ontology namespaces, the saved queries
 * each namespace holds, and whether another server holds the storage
 * lock. */
function database(state: {
  version?: number;
  registry: boolean;
  namespaces?: string[];
  savedQueries?: Record<string, unknown>[];
  lockHeld?: boolean;
}) {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const querier: Querier = {
    async query(text: string, values?: unknown[]): Promise<DbResult> {
      queries.push(text);
      params.push(values ?? []);
      if (text.startsWith("SELECT saved_query_id")) {
        const rows = state.savedQueries ?? [];
        return { rows, rowCount: rows.length };
      }
      if (text.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: !(state.lockHeld ?? false) }], rowCount: 1 };
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
  return { querier, queries, params };
}

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

/** Step 11 in one namespace: one per pair on relation types, and staged
 * values found by value. */
const step11 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  "ALTER TABLE relation_type ADD COLUMN one_per_pair boolean NOT NULL DEFAULT false",
  "CREATE INDEX changeset_value_match_idx ON changeset_value (changeset_id, property_key, md5(value::text))",
];

/** Step 12 in one namespace without a search step: the saved queries read. */
const step12 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  "SELECT saved_query_id, lens_key, key, steps FROM saved_query ORDER BY key",
];

/** Step 13 in one namespace: the table of search trees step 14 replaces. */
const step13 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  expect.stringMatching(/^CREATE TABLE named_search \(/),
];

/** Step 14 in one namespace: step 13's table dropped, the search-profile
 * table created. */
const step14 = (namespace: string) => [
  `SET LOCAL search_path TO ${namespace}, public`,
  "DROP TABLE IF EXISTS named_search",
  expect.stringMatching(/^CREATE TABLE search_profile \(/),
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

  it("upgrades version-8 storage — the end of the 7.x line — by steps 9 to 14, in every namespace, the number last", async () => {
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
      ...step11("ont_a"),
      ...step11("ont_b"),
      "SET LOCAL search_path TO public",
      ...step12("ont_a"),
      ...step12("ont_b"),
      "SET LOCAL search_path TO public",
      ...step13("ont_a"),
      ...step13("ont_b"),
      "SET LOCAL search_path TO public",
      ...step14("ont_a"),
      ...step14("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    const table = queries.find((q) => q.startsWith("CREATE TABLE design_revision ("))!;
    // One row, no FK: the registry lives in another namespace.
    expect(table).toContain("CONSTRAINT design_revision_singleton CHECK (singleton)");
    expect(table).not.toMatch(/REFERENCES/);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 8 to 14 (2 ontologies).");
  });

  it("upgrades version-9 storage by steps 10 to 14: the identity columns and constraint, one per pair, search steps, step 13's table, search profiles", async () => {
    const { querier, queries } = database({ version: 9, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step10("ont_a"),
      ...step10("ont_b"),
      "SET LOCAL search_path TO public",
      ...step11("ont_a"),
      ...step11("ont_b"),
      "SET LOCAL search_path TO public",
      ...step12("ont_a"),
      ...step12("ont_b"),
      "SET LOCAL search_path TO public",
      ...step13("ont_a"),
      ...step13("ont_b"),
      "SET LOCAL search_path TO public",
      ...step14("ont_a"),
      ...step14("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 9 to 14 (2 ontologies).");
  });

  it("upgrades version-10 storage by steps 11 to 14: one per pair, search steps, step 13's table, search profiles, in every namespace", async () => {
    const { querier, queries } = database({ version: 10, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step11("ont_a"),
      ...step11("ont_b"),
      "SET LOCAL search_path TO public",
      ...step12("ont_a"),
      ...step12("ont_b"),
      "SET LOCAL search_path TO public",
      ...step13("ont_a"),
      ...step13("ont_b"),
      "SET LOCAL search_path TO public",
      ...step14("ont_a"),
      ...step14("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 10 to 14 (2 ontologies).");
  });

  it("upgrades version-11 storage by step 12: search steps become entity searches, one binding more is deleted", async () => {
    const steps = (field: string) =>
      JSON.stringify([
        { name: "skills", type: "search", entityTypeKey: "skill", query: "$q", limit: 5 },
        { name: "people", type: "oql", oql: "MATCH (p) WHERE p._id IN $ids RETURN p", bindings: { ids: `{{skills.${field}}}` } },
      ]);
    const { querier, queries, params } = database({
      version: 11,
      registry: true,
      namespaces: ["ont_a"],
      savedQueries: [
        { saved_query_id: "sq-1", lens_key: "all", key: "by-id", steps: steps("_id") },
        { saved_query_id: "sq-2", lens_key: "all", key: "by-title", steps: steps("title") },
        { saved_query_id: "sq-3", lens_key: "all", key: "oql-only", steps: JSON.stringify([{ name: "main", type: "oql", oql: "MATCH (p) RETURN p" }]) },
      ],
    });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const update = queries.indexOf("UPDATE saved_query SET steps = $2 WHERE saved_query_id = $1");
    expect(params[update]![0]).toBe("sq-1");
    expect(JSON.parse(params[update]![1] as string)).toEqual([
      { name: "skills", type: "search", types: ["skill"], query: "$q", limit: 5 },
      { name: "people", type: "oql", oql: "MATCH (p) WHERE p._id IN $ids RETURN p", bindings: { ids: "{{skills._id}}" } },
    ]);
    const deleted = queries.indexOf("DELETE FROM saved_query WHERE saved_query_id = $1");
    expect(params[deleted]).toEqual(["sq-2"]);
    // An oql-only pipeline stays as it is.
    expect(queries.filter((q) => q.startsWith("UPDATE saved_query") || q.startsWith("DELETE FROM saved_query"))).toHaveLength(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Deleting saved query 'by-title' of lens 'all'"));
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 11 to 14 (1 ontologies).");
  });

  it("upgrades version-12 storage by steps 13 and 14, in every namespace, the number last", async () => {
    const { querier, queries } = database({ version: 12, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step13("ont_a"),
      ...step13("ont_b"),
      "SET LOCAL search_path TO public",
      ...step14("ont_a"),
      ...step14("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 12 to 14 (2 ontologies).");
  });

  it("upgrades version-13 storage by step 14: step 13's table replaced by the search-profile table, in every namespace, the number last", async () => {
    expect(STORAGE_VERSION).toBe(14);
    const { querier, queries } = database({ version: 13, registry: true, namespaces: ["ont_a", "ont_b"] });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const firstStep = queries.indexOf("SET LOCAL search_path TO ont_a, public");
    const ran = queries.slice(firstStep).filter((q) => q !== "SELECT namespace FROM public.ontology ORDER BY key");
    expect(ran).toEqual([
      ...step14("ont_a"),
      ...step14("ont_b"),
      "SET LOCAL search_path TO public",
      "DELETE FROM public.storage_version",
      "INSERT INTO public.storage_version (version) VALUES ($1)",
    ]);
    const table = queries.find((q) => q.startsWith("CREATE TABLE search_profile ("))!;
    expect(table).toMatch(/CONSTRAINT search_profile_lens_fk\s+REFERENCES lens \(lens_id\) ON DELETE CASCADE/);
    expect(table).toContain("CONSTRAINT search_profile_key_unique UNIQUE (lens_id, key)");
    expect(table).toMatch(/^\s+tree\s+jsonb\s+NOT NULL,$/m);
    expect(console.log).toHaveBeenCalledWith("Upgrading storage from version 13 to 14 (2 ontologies).");
  });

  it("refuses storage newer than the code and writes nothing", async () => {
    const { querier, queries } = database({ version: STORAGE_VERSION + 1, registry: true });
    await expect(bringStorageUpToDate(querier, SERVER_DDL)).rejects.toThrow("Use a newer release");
    expect(writes(queries)).toEqual([]);
  });

  it("refuses storage older than the oldest upgradable version and writes nothing", async () => {
    expect(OLDEST_UPGRADABLE_VERSION).toBe(8);
    const { querier, queries } = database({ version: 7, registry: true, namespaces: ["ont_a"] });
    await expect(bringStorageUpToDate(querier, SERVER_DDL)).rejects.toThrow(
      "Storage is version 7; this release upgrades from version 8 on. Upgrade through the last release of the previous major line first.",
    );
    expect(writes(queries)).toEqual([]);
  });

  it("refuses storage from before the version table — the 5.x line — and writes nothing", async () => {
    const { querier, queries } = database({ registry: true, namespaces: ["ont_a"] });
    await expect(bringStorageUpToDate(querier, SERVER_DDL)).rejects.toThrow(
      "Storage is version 1; this release upgrades from version 8 on.",
    );
    expect(writes(queries)).toEqual([]);
  });
});
