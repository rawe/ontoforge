/**
 * The vector-query door: what all four semantic-search paths share.
 *
 * **Never one statement.** `SET LOCAL hnsw.iterative_scan = strict_order`
 * precedes every vector query, so the pair runs inside one explicit
 * transaction (M2.3's two-statement rule). The iterative scan keeps
 * refilling the `LIMIT` with rows that pass the `WHERE`, which makes the
 * limit count *filtered* hits — the same contract as the reference
 * adapter's filter-before-limit index search — and `strict_order` returns
 * them in exact distance order, so no caller re-sorts. If the scan gives
 * up at its tuple cap the page simply comes back short, a shape callers
 * already accept.
 *
 * **The cast width.** An HNSW index over `(embedding::vector(D))` is only
 * usable by a query that repeats that expression verbatim, so the width
 * comes from the index the query will use — the one the DDL module
 * reconciles. Where no such index exists the query still has to run, and
 * the query vector's own width is then the only width that can be right.
 *
 * **The score is pinned:** `1 - distance/2` over pgvector's cosine
 * distance `1 - cos`, i.e. `(1 + cos)/2` — the [0,1] higher-better number
 * `docs/capabilities/search.md` calls the raw cosine similarity, and the
 * same number the reference adapter's cosine index returns.
 *
 * **`minScore` is not in here.** The floor belongs after the limit, in
 * the caller (`minScoreFloor`). Pushed into the `WHERE` it would sit
 * *inside* the iterative scan, which would then keep scanning to refill
 * the page and return more rows than the reference adapter — a parity
 * break. Outside the scan, a floored page just shrinks.
 */

import { toSql } from "pgvector";

import type { Row } from "../../core/ports.js";
import { indexWidth } from "./ddl.js";
import { withTransaction, type Querier } from "./errors.js";

/** Resolves the physical index a query rides, or null when none exists. */
export type IndexResolver = (querier: Querier) => Promise<string | null>;

/** A fresh positional-parameter array with the query vector bound at `$1`
 * — every fragment a caller adds numbers itself from there. */
export function vectorParams(queryEmbedding: number[]): unknown[] {
  return [toSql(queryEmbedding)];
}

/** The distance expression, character-identical to the index's key. */
export function distance(width: number): string {
  return `embedding::vector(${width}) <=> $1::vector`;
}

/** The pinned similarity as a select-list column. */
export function similarity(width: number): string {
  return `1 - (${distance(width)}) / 2 AS score`;
}

/**
 * Run one vector query: the iterative-scan setting, the width read, and
 * the statement `sqlFor` builds from that width — one transaction.
 *
 * `params` must be the array `vectorParams` seeded, with every further
 * value the statement binds appended in placeholder order.
 */
export async function vectorSearch(
  indexOf: IndexResolver,
  queryEmbedding: number[],
  params: unknown[],
  sqlFor: (width: number) => string,
): Promise<Row[]> {
  return withTransaction(async (querier) => {
    await querier.query("SET LOCAL hnsw.iterative_scan = strict_order");
    const indexName = await indexOf(querier);
    const width =
      (indexName === null ? null : await indexWidth(querier, indexName)) ?? queryEmbedding.length;
    const result = await querier.query(sqlFor(width), params);
    return result.rows;
  });
}

/** The post-hoc similarity floor. A page that loses rows to it stays
 * short — nothing is fetched to replace them. */
export function minScoreFloor(hits: Row[], minScore: number | null): Row[] {
  return minScore === null ? hits : hits.filter((hit) => (hit.score as number) >= minScore);
}
