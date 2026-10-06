/**
 * The storage-version decision at boot, against a scripted querier: what
 * an empty, an unversioned (5.x), an unreleased version-2, a current, a
 * newer and a too-old database each lead to. The real upgrade against PostgreSQL is covered by
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
 * whether the registry exists, its ontology namespaces, and whether they
 * keep retrievers in `retriever_config` (the unreleased version 2). */
function database(state: {
  version?: number;
  registry: boolean;
  namespaces?: string[];
  retrieverConfig?: boolean;
}) {
  const queries: string[] = [];
  const querier: Querier = {
    async query(text: string): Promise<DbResult> {
      queries.push(text);
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

const writes = (queries: string[]) => queries.filter((q) => /^(INSERT|DELETE|CREATE|LOCK TABLE)/.test(q));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("storage version at boot", () => {
  it("takes the database-wide lock before reading the version", async () => {
    const { querier, queries } = database({ version: STORAGE_VERSION, registry: true });
    await bringStorageUpToDate(querier, SERVER_DDL);
    expect(queries[0]).toContain("pg_advisory_xact_lock");
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
    expect(bound).toEqual([
      "SET LOCAL search_path TO ont_a, public",
      "SET LOCAL search_path TO ont_b, public",
      "SET LOCAL search_path TO public",
    ]);
    expect(queries.filter((q) => q.includes("ADD COLUMN name_property"))).toHaveLength(2);
    // The registry's language goes once, after every namespace took it over.
    const dropped = queries.indexOf("ALTER TABLE public.ontology DROP COLUMN text_search_language");
    expect(dropped).toBeGreaterThan(queries.lastIndexOf("SET LOCAL search_path TO ont_b, public"));
    expect(queries.filter((q) => q.includes("text_search_language"))).toHaveLength(3);
    // 5.x has no retrievers: each namespace gets an empty agent table.
    expect(queries.filter((q) => q.startsWith("CREATE TABLE retriever_agent"))).toHaveLength(2);
    expect(queries.filter((q) => q.includes("RENAME TO retriever_agent"))).toEqual([]);
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 1 to 3"));
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
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 2 to 3"));
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
