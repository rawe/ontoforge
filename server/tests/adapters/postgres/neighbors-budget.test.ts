/**
 * The neighbours limit is ONE shared budget: for direction `both`, outgoing
 * edges are taken first, up to the whole limit, and incoming edges receive
 * only the remainder (`docs/capabilities/instance-data.md#traversal`). An
 * entity with at least `limit` outgoing edges therefore comes back with NO
 * incoming neighbours at all — the documented trap, preserved exactly.
 *
 * Door discipline rides along (M2.3): `both` is two statements in one
 * transaction; a single-direction call is one statement on door one — no
 * BEGIN/COMMIT. The strict `isUuid()` guard answers the empty list for an
 * off-format root id without touching the database.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initPool } from "../../../src/adapters/postgres/errors.js";
import { PostgresRuntimeStore } from "../../../src/adapters/postgres/runtimeStore.js";
import { fakeDb, type FakeResult } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

type Row = Record<string, unknown>;

const ROOT_ID = "4f2d8a31-0000-4000-8000-000000000001";

/** One joined relation+neighbour row as the page queries select it. */
function neighborDbRow(id: string): Row {
  return {
    relation_id: `9f2d8a31-0000-4000-8000-0000000000${id}`,
    relation_type_key: "works_for",
    relation_props: {},
    relation_created_at: new Date("2026-01-01T00:00:00Z"),
    relation_updated_at: new Date("2026-01-01T00:00:00Z"),
    id: `4f2d8a31-0000-4000-8000-0000000000${id}`,
    type_key: "company",
    props: {},
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
  };
}

/** Answer every relation SELECT from a queue, everything else empty. */
function queueRelationSelects(pages: Row[][]): void {
  const queue = [...pages];
  fakeDb.onQuery = async (sql): Promise<FakeResult> => {
    if (sql.includes("FROM relation")) {
      const rows = queue.shift() ?? [];
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };
}

const store = new PostgresRuntimeStore();

beforeAll(async () => {
  await initPool();
});

beforeEach(() => {
  fakeDb.reset();
});

function relationSelects(): { sql: string; params: unknown[] | undefined }[] {
  return fakeDb.queries.filter((q) => q.sql.includes("FROM relation"));
}

describe("direction budget", () => {
  it("`both` with the budget exhausted by outgoing edges never queries incoming", async () => {
    queueRelationSelects([[neighborDbRow("02"), neighborDbRow("03")]]);

    const results = await store.getNeighbors(ROOT_ID, "both", null, 2, {});

    // The outgoing page filled the whole budget: exactly ONE SELECT ran,
    // inside one transaction.
    expect(relationSelects()).toHaveLength(1);
    expect(fakeDb.queries[0]?.sql).toBe("BEGIN");
    expect(fakeDb.queries.at(-1)?.sql).toBe("COMMIT");
    expect(results).toHaveLength(2);
    expect(results.every((r) => (r.relation as Row).direction === "outgoing")).toBe(true);
  });

  it("`both` hands only the remainder of the budget to incoming edges", async () => {
    queueRelationSelects([[neighborDbRow("02")], [neighborDbRow("04")]]);

    const results = await store.getNeighbors(ROOT_ID, "both", null, 5, {});

    const selects = relationSelects();
    expect(selects).toHaveLength(2);
    // The second query's bound limit is the remainder: 5 - 1 = 4.
    expect(selects[1]!.params?.at(-1)).toBe(4);
    expect(results.map((r) => (r.relation as Row).direction)).toEqual([
      "outgoing",
      "incoming",
    ]);
  });

  it("a single-direction call is one statement on door one — no transaction", async () => {
    queueRelationSelects([[neighborDbRow("02")]]);

    const results = await store.getNeighbors(ROOT_ID, "incoming", null, 5, {});

    expect(fakeDb.queries).toHaveLength(1);
    expect(fakeDb.queries[0]?.sql).not.toBe("BEGIN");
    expect(results).toHaveLength(1);
    expect((results[0]!.relation as Row).direction).toBe("incoming");
  });

  it("an off-format root id answers the empty list without touching the database", async () => {
    const results = await store.getNeighbors("no-such-id", "both", null, 5, {});
    expect(results).toEqual([]);
    expect(fakeDb.queries).toHaveLength(0);
  });
});
