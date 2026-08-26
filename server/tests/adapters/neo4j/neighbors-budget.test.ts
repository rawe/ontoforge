/**
 * The neighbours limit is ONE shared budget: for direction `both`, outgoing
 * edges are taken first, up to the whole limit, and incoming edges receive
 * only the remainder (`docs/capabilities/instance-data.md#traversal`). An
 * entity with at least `limit` outgoing edges therefore comes back with NO
 * incoming neighbours at all — the documented trap, preserved exactly.
 */

import type { Session } from "neo4j-driver";
import { describe, expect, it, vi } from "vitest";

import { getNeighbors } from "../../../src/adapters/neo4j/runtimeQueries.js";

type Row = Record<string, unknown>;

function fakeRecord(relation: Row, entity: Row): { get(key: string): unknown } {
  return {
    get(key: string): unknown {
      if (key === "relation") return relation;
      if (key === "neighbor_entity") return entity;
      throw new Error(`unexpected key ${key}`);
    },
  };
}

function neighborRecord(id: string): { get(key: string): unknown } {
  return fakeRecord(
    { _id: `rel-${id}`, _relationTypeKey: "works_for" },
    { _id: id, _entityTypeKey: "company" },
  );
}

describe("direction budget", () => {
  it("`both` with the budget exhausted by outgoing edges never queries incoming", async () => {
    const run = vi.fn(async () => ({
      records: [neighborRecord("ent-2"), neighborRecord("ent-3")],
    }));
    const session = { run } as unknown as Session;

    const results = await getNeighbors(session, "ent-1", "both", null, 2);

    // The outgoing page filled the whole budget: exactly ONE query ran.
    expect(run).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results.every((r) => (r.relation as Row).direction === "outgoing")).toBe(true);
  });

  it("`both` hands only the remainder of the budget to incoming edges", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ records: [neighborRecord("ent-2")] }) // outgoing
      .mockResolvedValueOnce({ records: [neighborRecord("ent-4")] }); // incoming
    const session = { run } as unknown as Session;

    const results = await getNeighbors(session, "ent-1", "both", null, 5);

    expect(run).toHaveBeenCalledTimes(2);
    // The second query's limit parameter is the remainder: 5 - 1 = 4.
    const secondParams = run.mock.calls[1]![1] as { remainingLimit: { toNumber(): number } };
    expect(secondParams.remainingLimit.toNumber()).toBe(4);
    expect(results.map((r) => (r.relation as Row).direction)).toEqual([
      "outgoing",
      "incoming",
    ]);
  });

  it("a single direction runs one query with the full limit", async () => {
    const run = vi.fn(async () => ({ records: [neighborRecord("ent-2")] }));
    const session = { run } as unknown as Session;

    const results = await getNeighbors(session, "ent-1", "incoming", "WORKS_FOR", 50);

    expect(run).toHaveBeenCalledTimes(1);
    const [query, params] = run.mock.calls[0]! as [string, { limit: { toNumber(): number } }];
    expect(query).toContain("<-[r:WORKS_FOR]-");
    expect(params.limit.toNumber()).toBe(50);
    expect((results[0]!.relation as Row).direction).toBe("incoming");
  });
});
