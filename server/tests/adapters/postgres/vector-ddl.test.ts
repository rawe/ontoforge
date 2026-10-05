/**
 * The PostgreSQL vector DDL: the ontology table set and the saved-query
 * description index — the one vector index left beside the search-index
 * partitions — pinned over the fake pool, so the exact statement text is
 * asserted without a database.
 *
 * What is pinned here: the index is a cast-expression HNSW over the
 * dimensionless `embedding` column (`(embedding::vector(D))
 * vector_cosine_ops`) under its fixed name; a drifted width is reported
 * in the API's vocabulary and never repaired; every composition runs
 * through the transaction door; and the ontology DDL carries no
 * per-entity search storage.
 *
 * The live-catalog side — that PostgreSQL accepts these statements, and
 * what the widths actually become — is
 * `tests/integration/postgres/vector-lifecycle.test.ts`.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ontologyDdlStatements } from "../../../src/adapters/postgres/ddl.js";
import { initPool } from "../../../src/adapters/postgres/errors.js";
import { PostgresModelingStore } from "../../../src/adapters/postgres/modelingStore.js";
import { captureLogs, POSTGRES_LEAKS, SAVED_QUERY_SCOPE } from "../../vectorDrift.js";
import { fakeDb } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

const store = new PostgresModelingStore();

beforeAll(async () => {
  await initPool();
});

beforeEach(() => {
  fakeDb.reset();
});

/** Every statement the fake pool saw, whitespace-normalized. */
function statements(): string[] {
  return fakeDb.queries.map((q) => q.sql.replace(/\s+/g, " ").trim());
}

/** The one statement matching `fragment`; fails when none or several do. */
function only(fragment: string): string {
  const matches = statements().filter((sql) => sql.includes(fragment));
  expect(matches, `statements containing '${fragment}'`).toHaveLength(1);
  return matches[0]!;
}

/** Answer every catalog width read with `width`. */
function existingWidth(width: number): void {
  fakeDb.onQuery = async (sql) =>
    sql.includes("format_type")
      ? { rows: [{ coltype: `vector(${width})` }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
}

describe("the ontology DDL", () => {
  it("stores no per-entity search data: entries live in search_entry alone", () => {
    const ddl = ontologyDdlStatements().join("\n");
    expect(ddl).not.toContain("document_chunk");
    expect(ddl).not.toContain("keyword_text");
    expect(ddl).not.toContain("search_vector");
    expect(ddl).not.toContain("vec_");
    const entity = ddl.slice(ddl.indexOf("CREATE TABLE IF NOT EXISTS entity ("));
    expect(entity.slice(0, entity.indexOf("\n)"))).not.toContain("embedding");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS search_entry");
  });
});

describe("the saved-query index", () => {
  it("is ensured full-table under its fixed name, in one transaction", async () => {
    await store.ensureSavedQueryVectorIndex(768);
    expect(only("CREATE INDEX")).toBe(
      "CREATE INDEX IF NOT EXISTS saved_query_embedding_idx ON saved_query " +
        "USING hnsw ((embedding::vector(768)) vector_cosine_ops)",
    );
    expect(statements()[0]).toBe("BEGIN");
    expect(statements().at(-1)).toBe("COMMIT");
  });

  it("reports a drifted width in the API's words and never repairs it", async () => {
    existingWidth(1024);
    const captured = captureLogs();
    try {
      await store.ensureSavedQueryVectorIndex(768);
    } finally {
      captured.restore();
    }

    const reported = captured.lines.join("\n");
    expect(reported).toContain(SAVED_QUERY_SCOPE);
    expect(reported).toContain("1024");
    expect(reported).toContain("768");
    for (const leak of POSTGRES_LEAKS) {
      expect(reported, `'${leak}' leaked into the report`).not.toContain(leak);
    }
    expect(statements().filter((sql) => sql.includes("DROP INDEX"))).toEqual([]);
  });

  it("stays silent when the widths already agree", async () => {
    existingWidth(768);
    const captured = captureLogs();
    try {
      await store.ensureSavedQueryVectorIndex(768);
    } finally {
      captured.restore();
    }
    expect(captured.lines).toEqual([]);
  });
});
