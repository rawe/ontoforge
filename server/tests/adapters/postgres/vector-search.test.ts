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

const searched = [{ entityTypeKey: "person", propertyDefs: DEFS, conditions: [] }];
const passages = [{ entityTypeKey: "person", propertyKey: "bio", conditions: [] }];
for (const [name, run] of [
  ["property semantic", () => store.propertySearchSemantic(searched, QUERY_VECTOR, 5)],
  ["document semantic", () => store.documentSearchSemantic(passages, QUERY_VECTOR, 5)],
  ["saved-query semantic", () => store.searchSavedQueries(QUERY_VECTOR, "lens", 5, null)],
] as const)
  it(`${name} uses strict iterative scans and the index cast width`, async () => {
    await run();
    expect(statements()[0]).toBe("BEGIN");
    expect(statements()[1]).toBe("SET LOCAL hnsw.iterative_scan = strict_order");
    expect(statements().at(-1)).toBe("COMMIT");
    expect(scoringQuery().sql).toContain(`embedding::vector(${INDEX_WIDTH}) <=> $1::vector`);
    expect(scoringQuery().params?.[0]).toBe("[0.5,-0.25,0.125]");
    expect(widthReadFor()).toBe(
      name.startsWith("property")
        ? ENTITY_INDEX
        : name.startsWith("document")
          ? CHUNK_INDEX
          : "saved_query_embedding_idx",
    );
  });
it("cross-type semantic ranking is one UNION ALL statement with a filtered scan per type", async () => {
  await store.propertySearchSemantic(
    [
      { ...searched[0]!, conditions: [cond("name", "string", "eq", "Ada")] },
      {
        ...searched[0]!,
        entityTypeKey: "company",
        conditions: [cond("name", "string", "eq", "Acme")],
      },
    ],
    QUERY_VECTOR,
    5,
  );
  const { sql, params } = scoringQuery();
  expect(sql).toContain("UNION ALL");
  expect(sql.match(/ORDER BY embedding::vector/g)).toHaveLength(2);
  expect(sql).toContain("ORDER BY score DESC LIMIT");
  expect(params).toEqual(expect.arrayContaining(["Ada", "Acme", "person", "company"]));
  expect(sql).not.toContain("entity_embedding_all_idx");
});
it("document scans filter their parents inside each ranking", async () => {
  await store.documentSearchSemantic(
    [
      {
        ...passages[0]!,
        conditions: [
          cond("age", "integer", "gt", 25),
          pathCond("works_for", "outgoing", "name", "string", "eq", "Acme"),
        ],
      },
    ],
    QUERY_VECTOR,
    5,
  );
  expect(scoringQuery().sql).toContain(
    "EXISTS (SELECT 1 FROM entity WHERE entity.id = document_chunk.entity_id AND",
  );
  expect(scoringQuery().params).toContain("Acme");
});
for (const document of [false, true])
  it(`${document ? "document" : "property"} keyword ranking reads stored vectors with a plain bound query`, async () => {
    const query = `graph & database | ! ' words`;
    const german = new PostgresRuntimeStore("test", undefined, "german");
    if (document)
      await german.documentSearchKeyword(
        [{ ...passages[0]!, conditions: [cond("age", "integer", "gt", 25)] }],
        query,
        5,
      );
    else await german.propertySearchKeyword(searched, query, 5);
    const scoring = scoringQuery();
    expect(scoring.sql).toContain("ts_rank_cd(search_vector, query)");
    expect(scoring.sql).toContain("search_vector @@ query");
    expect(scoring.sql).toContain("plainto_tsquery($2::regconfig, $1)");
    if (document) expect(scoring.sql).not.toContain("to_tsvector");
    else {
      expect(scoring.sql).toContain("WITH ranked AS MATERIALIZED");
      expect(scoring.sql).toContain("AS keyword_property_keys");
      expect(scoring.sql).toContain("ts_parse('default', keyword_text)");
      expect(scoring.sql).toContain("ts_parse('default', source.segment->>'text')");
      expect(scoring.sql).toContain("ORDER BY source.segment_position, parsed.token_position");
      expect(scoring.sql).toContain("IS DISTINCT FROM");
      expect(scoring.sql).toContain("WHERE parsed.tokid <> 12");
      expect(scoring.sql).toContain("<@ coalesce(array_agg(DISTINCT term.lexeme)");
    }
    expect(scoring.sql).not.toContain(query);
    expect(scoring.params?.slice(0, 2)).toEqual([query, "german"]);
  });
