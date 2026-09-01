/**
 * Filters on the passage search: applied below the port, after the index
 * lookup — the in-index WHERE of a vector search can only see the chunk
 * node, so the parent entity is matched after the SEARCH clause and the
 * conditions are evaluated on it. The page may come back short, which is
 * this adapter's documented deviation (`docs/storage-adapters.md`).
 * Without conditions the statement is the plain index lookup, unchanged.
 */

import type { Session } from "neo4j-driver";
import { describe, expect, it, vi } from "vitest";

import { searchDocumentChunks } from "../../../src/adapters/neo4j/runtimeQueries.js";

type Row = Record<string, unknown>;

function fakeSession(): { session: Session; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({
    records: [
      {
        get: (key: string) =>
          key === "chunk"
            ? { _id: "c1", _entityId: "e1", text: "passage", _embedding: [0.1] }
            : 0.9,
      },
    ],
  }));
  return { session: { run } as unknown as Session, run };
}

function statement(run: ReturnType<typeof vi.fn>): { query: string; params: Row } {
  expect(run).toHaveBeenCalledTimes(1);
  const [query, params] = run.mock.calls[0]! as [string, Row];
  return { query: query.replace(/\s+/g, " ").trim(), params };
}

describe("passage search with conditions", () => {
  it("matches the parent entity after the index lookup and evaluates the conditions on it", async () => {
    const { session, run } = fakeSession();

    const hits = await searchDocumentChunks(
      session,
      "PersonDocumentBio",
      "person_document_bio_embedding",
      [0.1, 0.2],
      5,
      ["n.age > $flt_0", "n.name = $flt_1"],
      { flt_0: 25, flt_1: "Ada" },
    );

    const { query, params } = statement(run);
    expect(query).toBe(
      "MATCH (c:PersonDocumentBio) SEARCH c IN (VECTOR INDEX person_document_bio_embedding " +
        "FOR $query_embedding LIMIT $limit) SCORE AS score " +
        "MATCH (n:_Entity)-[:_HAS_CHUNK]->(c) WHERE n.age > $flt_0 AND n.name = $flt_1 " +
        "RETURN c {.*} AS chunk, score",
    );
    expect(params.flt_0).toBe(25);
    expect(params.flt_1).toBe("Ada");
    expect(params.query_embedding).toEqual([0.1, 0.2]);
    expect(hits).toHaveLength(1);
    expect((hits[0]!.chunk as Row)._entityId).toBe("e1");
    expect(hits[0]!.chunk).not.toHaveProperty("_embedding");
  });

  it("without conditions the statement is the plain index lookup", async () => {
    const { session, run } = fakeSession();

    await searchDocumentChunks(
      session,
      "PersonDocumentBio",
      "person_document_bio_embedding",
      [0.1, 0.2],
      5,
    );

    const { query, params } = statement(run);
    expect(query).toBe(
      "MATCH (c:PersonDocumentBio) SEARCH c IN (VECTOR INDEX person_document_bio_embedding " +
        "FOR $query_embedding LIMIT $limit) SCORE AS score RETURN c {.*} AS chunk, score",
    );
    expect(Object.keys(params).sort()).toEqual(["limit", "query_embedding"]);
  });
});
