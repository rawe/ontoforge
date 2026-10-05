/**
 * Saved-query discovery, the one vector query on the instance side of the
 * PostgreSQL adapter (instance search reads the search-index entries):
 * the exact statements it emits, pinned over the fake pool so the shape is
 * asserted without a database.
 *
 * What is pinned here is the M4.4 query contract:
 * `SET LOCAL hnsw.iterative_scan = strict_order` runs before the vector
 * query and in the same transaction as it; the score is the pinned
 * `1 - distance/2`; the query vector is bound, never interpolated, and
 * reaches the distance operator as `$1::vector`; and the width of the
 * cast comes from the index the query will ride, read from the catalog,
 * not from the caller's own vector.
 *
 * The last one is why this file exists at all: a cast that does not
 * repeat the index's expression verbatim costs nothing visible — the
 * planner just ignores the index — so nothing but a pinned statement
 * catches it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initPool } from "../../../src/adapters/postgres/errors.js";
import { PostgresRuntimeStore } from "../../../src/adapters/postgres/runtimeStore.js";
import { fakeDb } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

/** The width the catalog reports for the index. Deliberately different
 * from the query vector's own length, so the two sources are told
 * apart. */
const INDEX_WIDTH = 1024;
const QUERY_VECTOR = [0.5, -0.25, 0.125];

const store = new PostgresRuntimeStore();

beforeAll(async () => {
  await initPool();
});

beforeEach(() => {
  fakeDb.reset();
  fakeDb.onQuery = async (sql) => {
    if (sql.includes("format_type")) {
      return { rows: [{ coltype: `vector(${INDEX_WIDTH})` }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
});

/** Every statement the fake pool saw, whitespace-normalized. */
function statements(): string[] {
  return fakeDb.queries.map((q) => q.sql.replace(/\s+/g, " ").trim());
}

/** The one vector query of the exchange: the statement that scores. */
function scoringQuery(): { sql: string; params: unknown[] | undefined } {
  const matches = fakeDb.queries.filter((q) => q.sql.includes("AS score"));
  expect(matches, "scoring statements").toHaveLength(1);
  return { sql: matches[0]!.sql.replace(/\s+/g, " ").trim(), params: matches[0]!.params };
}

/** The index name whose width the exchange read. */
function widthReadFor(): unknown {
  const reads = fakeDb.queries.filter((q) => q.sql.includes("format_type"));
  expect(reads, "width reads").toHaveLength(1);
  return reads[0]!.params?.[0];
}

it("saved-query discovery uses a strict iterative scan and the index cast width", async () => {
  await store.searchSavedQueries(QUERY_VECTOR, "lens", 5, null);
  expect(statements()[0]).toBe("BEGIN");
  expect(statements()[1]).toBe("SET LOCAL hnsw.iterative_scan = strict_order");
  expect(statements().at(-1)).toBe("COMMIT");
  expect(scoringQuery().sql).toContain(`embedding::vector(${INDEX_WIDTH}) <=> $1::vector`);
  expect(scoringQuery().params?.[0]).toBe("[0.5,-0.25,0.125]");
  expect(widthReadFor()).toBe("saved_query_embedding_idx");
});
