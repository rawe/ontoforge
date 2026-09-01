/**
 * The four semantic-search paths: the exact statements they emit, pinned
 * over the fake pool so the shape is asserted without a database.
 *
 * What is pinned here is the whole M4.4 query contract:
 * `SET LOCAL hnsw.iterative_scan = strict_order` runs before every
 * vector query and in the same transaction as it — always, on all four
 * paths, filtered or not; the score is the pinned `1 - distance/2`; the
 * query vector is bound, never interpolated, and reaches the distance
 * operator as `$1::vector`; and the width of the cast comes from the
 * index the query will ride, read from the catalog, not from the
 * caller's own vector.
 *
 * The last one is why this file exists at all: a cast that does not
 * repeat the index's expression verbatim costs nothing visible — the
 * planner just ignores the index — so nothing but a pinned statement
 * catches it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initPool } from "../../../src/adapters/postgres/errors.js";
import { PostgresRuntimeStore } from "../../../src/adapters/postgres/runtimeStore.js";
import { cond, DEFS, pathCond } from "../../propertyDefs.js";
import { fakeDb } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

const ENTITY_TYPE_ID = "4f2d8a31-1111-4222-8333-444455556666";
const ENTITY_INDEX = "vec_entity_4f2d8a31111142228333444455556666";
const PROPERTY_ID = "0a1b2c3d-9999-4888-8777-666655554444";
const CHUNK_INDEX = "vec_document_chunk_0a1b2c3d999948888777666655554444";

/** The width the catalog reports for every index. Deliberately different
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
    if (sql.includes("FROM property_def")) {
      return { rows: [{ property_id: PROPERTY_ID }], rowCount: 1 };
    }
    if (sql.includes("FROM entity_type")) {
      return { rows: [{ entity_type_id: ENTITY_TYPE_ID }], rowCount: 1 };
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

const PATHS: { name: string; index: string; run: () => Promise<unknown> }[] = [
  {
    name: "semanticSearch",
    index: ENTITY_INDEX,
    run: () => store.semanticSearch("person", DEFS, QUERY_VECTOR, 5, null),
  },
  {
    name: "semanticSearchAll",
    index: "entity_embedding_all_idx",
    run: () => store.semanticSearchAll(QUERY_VECTOR, 5, null),
  },
  {
    name: "searchSavedQueries",
    index: "saved_query_embedding_idx",
    run: () => store.searchSavedQueries(QUERY_VECTOR, "lens", 5, null),
  },
  {
    name: "searchDocumentChunks",
    index: CHUNK_INDEX,
    run: () => store.searchDocumentChunks("person", "bio", QUERY_VECTOR, 5),
  },
];

describe.each(PATHS)("$name", ({ index, run }) => {
  it("sets the iterative scan to strict_order, in the query's own transaction", async () => {
    await run();

    const sql = statements();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toBe("SET LOCAL hnsw.iterative_scan = strict_order");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    // One transaction, and the scoring query inside it.
    expect(sql.filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(sql.indexOf(scoringQuery().sql)).toBeGreaterThan(1);
    expect(sql.indexOf(scoringQuery().sql)).toBeLessThan(sql.length - 1);
  });

  it("scores 1 - distance/2 over the bound query vector", async () => {
    await run();

    const { sql, params } = scoringQuery();
    expect(sql).toContain(
      `1 - (embedding::vector(${INDEX_WIDTH}) <=> $1::vector) / 2 AS score`,
    );
    expect(sql).toContain(`ORDER BY embedding::vector(${INDEX_WIDTH}) <=> $1::vector LIMIT`);
    // The vector is a parameter, never text in the statement.
    expect(params?.[0]).toBe("[0.5,-0.25,0.125]");
    expect(sql).not.toContain("0.125");
  });

  it("casts to the width of the index it rides, not the query vector's", async () => {
    await run();

    expect(widthReadFor()).toBe(index);
    expect(scoringQuery().sql).toContain(`embedding::vector(${INDEX_WIDTH})`);
    expect(scoringQuery().sql).not.toContain(`embedding::vector(${QUERY_VECTOR.length})`);
  });
});

describe("filtered semanticSearch", () => {
  it("keeps the scan setting and the pinned score beside the filter", async () => {
    await store.semanticSearch("person", DEFS, QUERY_VECTOR, 5, null, [
      cond("name", "string", "eq", "Ada"),
    ]);

    const sql = statements();
    expect(sql[1]).toBe("SET LOCAL hnsw.iterative_scan = strict_order");

    const scoring = scoringQuery();
    expect(scoring.sql).toContain(
      `1 - (embedding::vector(${INDEX_WIDTH}) <=> $1::vector) / 2 AS score`,
    );
    // The filter is an ordinary predicate beside the vector scan, and the
    // limit is bound after it — the scan refills the page against it.
    expect(scoring.sql).toContain("type_key = $2");
    expect(scoring.params).toContain("Ada");
    expect(scoring.sql).toContain(`LIMIT $${scoring.params!.length}`);
  });
});

describe("filtered searchDocumentChunks", () => {
  it("joins each passage to its parent entity inside the vector query and carries the predicates", async () => {
    await store.searchDocumentChunks("person", "bio", QUERY_VECTOR, 5, [
      cond("age", "integer", "gt", 25),
      pathCond("works_for", "outgoing", "name", "string", "eq", "Acme"),
    ]);

    const sql = statements();
    expect(sql[1]).toBe("SET LOCAL hnsw.iterative_scan = strict_order");

    const scoring = scoringQuery();
    expect(scoring.sql).toContain(
      `1 - (embedding::vector(${INDEX_WIDTH}) <=> $1::vector) / 2 AS score`,
    );
    // The parent entity is joined inside the statement, and the entity
    // ranking's own predicates — plain and path alike — are evaluated on
    // it, so the iterative scan refills the page with passages whose
    // parent passes; the limit is bound last.
    expect(scoring.sql).toContain(
      "FROM document_chunk WHERE entity_type_key = $2 AND property_key = $3 " +
        "AND embedding IS NOT NULL AND EXISTS (SELECT 1 FROM entity " +
        "WHERE entity.id = document_chunk.entity_id AND (props->$4)::numeric > $5 AND " +
        "EXISTS (SELECT 1 FROM relation r JOIN entity re ON re.id = r.to_id " +
        "WHERE r.from_id = entity.id AND r.type_key = $6 AND re.props->>$7 = $8))",
    );
    expect(scoring.sql).toContain(
      `ORDER BY embedding::vector(${INDEX_WIDTH}) <=> $1::vector LIMIT $9`,
    );
    expect(scoring.params).toEqual([
      "[0.5,-0.25,0.125]",
      "person",
      "bio",
      "age",
      25,
      "works_for",
      "name",
      "Acme",
      5,
    ]);
  });

  it("without conditions the statement carries no parent join", async () => {
    await store.searchDocumentChunks("person", "bio", QUERY_VECTOR, 5, []);

    const scoring = scoringQuery();
    expect(scoring.sql).not.toContain("EXISTS");
    expect(scoring.sql).toContain("LIMIT $4");
    expect(scoring.params).toEqual(["[0.5,-0.25,0.125]", "person", "bio", 5]);
  });
});
