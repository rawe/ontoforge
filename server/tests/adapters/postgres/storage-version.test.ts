/**
 * The storage-version decision at boot, against a scripted querier: what
 * an empty, an unversioned, an upgradable, a current, a newer and a
 * too-old database each lead to. The real upgrade against PostgreSQL is covered by
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
 * whether the registry exists, and its ontology namespaces. */
function database(state: { version?: number; registry: boolean; namespaces?: string[] }) {
  const queries: string[] = [];
  const querier: Querier = {
    async query(text: string): Promise<DbResult> {
      queries.push(text);
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

  it("upgrades storage of the previous major line in every ontology namespace, the number last", async () => {
    const { querier, queries } = database({
      version: OLDEST_UPGRADABLE_VERSION,
      registry: true,
      namespaces: ["ont_a", "ont_b"],
    });
    await bringStorageUpToDate(querier, SERVER_DDL);
    const bound = queries.filter((q) => q.startsWith("SET LOCAL search_path"));
    expect(bound).toEqual([
      "SET LOCAL search_path TO ont_a, public",
      "SET LOCAL search_path TO ont_b, public",
      "SET LOCAL search_path TO public",
    ]);
    expect(queries.filter((q) => q.includes("ADD COLUMN name_property"))).toHaveLength(2);
    expect(queries.at(-1)).toBe("INSERT INTO public.storage_version (version) VALUES ($1)");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("from version 2 to 3"));
  });

  it("refuses unversioned storage — the 5.x layout before retrievers — and writes nothing", async () => {
    const { querier, queries } = database({ registry: true, namespaces: ["ont_a"] });
    await expect(bringStorageUpToDate(querier, SERVER_DDL)).rejects.toThrow("previous major line first");
    expect(writes(queries)).toEqual([]);
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
