/**
 * The PostgreSQL vector-index lifecycle: emitted DDL, physical naming,
 * and the width-drift branches — pinned over the fake pool, so the exact
 * statement text is asserted without a database.
 *
 * What is pinned here: every index is a cast-expression HNSW over the
 * dimensionless `embedding` column (`(embedding::vector(D))
 * vector_cosine_ops`); dynamic names are `vec_<table>_<32-hex uuid>` of
 * the schema row that causes the index to exist, so name and row are
 * mechanically reversible; type and property keys reach DDL only as
 * quote-escaped literals in partial predicates (DDL binds no parameters);
 * and every composition runs through the transaction door.
 *
 * The live-catalog side — that PostgreSQL accepts these statements, and
 * what the widths actually become — is
 * `tests/integration/postgres/vector-lifecycle.test.ts`.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initPool } from "../../../src/adapters/postgres/errors.js";
import { PostgresModelingStore } from "../../../src/adapters/postgres/modelingStore.js";
import { captureLogs, DRIFT_SCOPES, POSTGRES_LEAKS } from "../../vectorDrift.js";
import { fakeDb } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

const ENTITY_TYPE_ID = "4f2d8a31-1111-4222-8333-444455556666";
const ENTITY_INDEX = "vec_entity_4f2d8a31111142228333444455556666";
const PROPERTY_ID = "0a1b2c3d-9999-4888-8777-666655554444";
const CHUNK_INDEX = "vec_document_chunk_0a1b2c3d999948888777666655554444";

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

/** Answer schema-row lookups with `rows`, everything else empty. */
function answer(rows: Record<string, unknown>[], match = "FROM entity_type"): void {
  fakeDb.onQuery = async (sql) =>
    sql.includes(match) ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 };
}

/** Answer every catalog width read with `width`, and the schema-row
 * lookups with the rows each kind expects. */
function existingWidth(
  width: number,
  entityRows: Record<string, unknown>[],
  propertyRows: Record<string, unknown>[] = [],
): void {
  fakeDb.onQuery = async (sql) => {
    if (sql.includes("format_type")) {
      return { rows: [{ coltype: `vector(${width})` }], rowCount: 1 };
    }
    if (sql.includes("FROM property_def")) {
      return { rows: propertyRows, rowCount: propertyRows.length };
    }
    if (sql.includes("FROM entity_type")) {
      return { rows: entityRows, rowCount: entityRows.length };
    }
    return { rows: [], rowCount: 0 };
  };
}

describe("per-entity-type index", () => {
  it("is a partial cast-expression HNSW named from the entity type's uuid", async () => {
    answer([{ entity_type_id: ENTITY_TYPE_ID }]);

    await store.createVectorIndex("person", 768);

    expect(only("CREATE INDEX")).toBe(
      `CREATE INDEX IF NOT EXISTS ${ENTITY_INDEX} ON entity ` +
        "USING hnsw ((embedding::vector(768)) vector_cosine_ops) WHERE type_key = 'person'",
    );
    // Two or more statements ⇒ the transaction door.
    expect(statements()[0]).toBe("BEGIN");
    expect(statements()[statements().length - 1]).toBe("COMMIT");
  });

  it("takes filterProperties and ignores them — the index is vector-only", async () => {
    answer([{ entity_type_id: ENTITY_TYPE_ID }]);
    await store.createVectorIndex("person", 768, ["name", "email"]);
    const withProps = only("CREATE INDEX");

    fakeDb.reset();
    answer([{ entity_type_id: ENTITY_TYPE_ID }]);
    await store.createVectorIndex("person", 768);

    expect(withProps).toBe(only("CREATE INDEX"));
    expect(withProps).not.toContain("name");
  });

  it("escapes the key in the partial predicate — DDL binds no parameters", async () => {
    answer([{ entity_type_id: ENTITY_TYPE_ID }]);
    await store.createVectorIndex("o'brien", 768);
    expect(only("CREATE INDEX")).toContain("WHERE type_key = 'o''brien'");
    for (const { params } of fakeDb.queries.filter((q) => q.sql.includes("CREATE INDEX"))) {
      expect(params).toBeUndefined();
    }
  });

  it("does nothing when the entity type row is gone — the name is not derivable", async () => {
    answer([]);
    await store.createVectorIndex("person", 768);
    expect(statements().filter((sql) => sql.includes("INDEX"))).toEqual([]);
  });

  it("drops by re-deriving the name from the schema row", async () => {
    answer([{ entity_type_id: ENTITY_TYPE_ID }]);
    await store.dropVectorIndex("person");
    expect(only("DROP INDEX")).toBe(`DROP INDEX IF EXISTS ${ENTITY_INDEX}`);
  });

  it("drops nothing once the schema row is gone — the orphan sweep collects it", async () => {
    answer([]);
    await store.dropVectorIndex("person");
    expect(statements().filter((sql) => sql.includes("INDEX"))).toEqual([]);
  });

  it("rebuilds width-only: drop and create at the new width in one transaction", async () => {
    answer([{ entity_type_id: ENTITY_TYPE_ID }]);
    await store.rebuildVectorIndex("person", 1024);

    const sql = statements();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    expect(only("DROP INDEX")).toBe(`DROP INDEX IF EXISTS ${ENTITY_INDEX}`);
    expect(only("CREATE INDEX")).toContain("embedding::vector(1024)");
    expect(sql.indexOf(only("DROP INDEX"))).toBeLessThan(sql.indexOf(only("CREATE INDEX")));
  });
});

describe("per-document-property chunk index", () => {
  it("is named from the property definition's uuid and partial on the pair", async () => {
    answer([{ property_id: PROPERTY_ID }], "FROM property_def");

    await store.createDocumentVectorIndex("person", "bio", 768);

    expect(only("CREATE INDEX")).toBe(
      `CREATE INDEX IF NOT EXISTS ${CHUNK_INDEX} ON document_chunk ` +
        "USING hnsw ((embedding::vector(768)) vector_cosine_ops) " +
        "WHERE entity_type_key = 'person' AND property_key = 'bio'",
    );
  });

  it("drops by re-deriving the name, and nothing once the property row is gone", async () => {
    answer([{ property_id: PROPERTY_ID }], "FROM property_def");
    await store.dropDocumentVectorIndex("person", "bio");
    expect(only("DROP INDEX")).toBe(`DROP INDEX IF EXISTS ${CHUNK_INDEX}`);

    fakeDb.reset();
    answer([], "FROM property_def");
    await store.dropDocumentVectorIndex("person", "bio");
    expect(statements().filter((sql) => sql.includes("INDEX"))).toEqual([]);
  });
});

describe("the fixed indexes", () => {
  it("ensures the saved-query index full-table under its fixed name", async () => {
    await store.ensureSavedQueryVectorIndex(768);
    expect(only("CREATE INDEX")).toBe(
      "CREATE INDEX IF NOT EXISTS saved_query_embedding_idx ON saved_query " +
        "USING hnsw ((embedding::vector(768)) vector_cosine_ops)",
    );
  });

  it("ensures the cross-type index full-table, with no port method of its own", async () => {
    await store.ensureVectorIndexes(768);
    expect(only("entity_embedding_all_idx")).toBe(
      "CREATE INDEX IF NOT EXISTS entity_embedding_all_idx ON entity " +
        "USING hnsw ((embedding::vector(768)) vector_cosine_ops)",
    );
    expect(store).not.toHaveProperty("ensureEntityVectorIndex");
  });
});

describe("ensureVectorIndexes", () => {
  it("sweeps, then creates the whole inventory in one transaction", async () => {
    fakeDb.onQuery = async (sql) => {
      if (sql.includes("pg_indexes")) {
        return {
          rows: [
            { indexname: ENTITY_INDEX }, // uuid matches a live entity type
            { indexname: "vec_entity_ffffffffffffffffffffffffffffffff" }, // orphan
            { indexname: "vec_document_chunk_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }, // orphan
            { indexname: "vec_bogus" }, // no derivable uuid at all
          ],
          rowCount: 4,
        };
      }
      if (sql.includes("FROM entity_type")) {
        return { rows: [{ entity_type_id: ENTITY_TYPE_ID, key: "person" }], rowCount: 1 };
      }
      if (sql.includes("FROM property_def")) {
        return {
          rows: [
            { property_id: PROPERTY_ID, entity_type_key: "person", property_key: "bio" },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    };

    await store.ensureVectorIndexes(768);

    const sql = statements();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    expect(sql.filter((s) => s.startsWith("BEGIN"))).toHaveLength(1);

    const dropped = sql.filter((s) => s.includes("DROP INDEX"));
    expect(dropped).toHaveLength(3);
    expect(dropped.join("\n")).toContain("vec_entity_ffffffffffffffffffffffffffffffff");
    expect(dropped.join("\n")).toContain("vec_document_chunk_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(dropped.join("\n")).toContain("vec_bogus");
    expect(dropped.join("\n")).not.toContain(ENTITY_INDEX);

    const created = sql.filter((s) => s.includes("CREATE INDEX"));
    expect(created).toHaveLength(4); // per-type, chunk, cross-type, saved-query
    expect(created.join("\n")).toContain(ENTITY_INDEX);
    expect(created.join("\n")).toContain(CHUNK_INDEX);
    expect(created.join("\n")).toContain("entity_embedding_all_idx");
    expect(created.join("\n")).toContain("saved_query_embedding_idx");
  });
});

describe("width drift", () => {
  it("startup warns per mismatched scope and changes nothing", async () => {
    existingWidth(1024, [{ entity_type_id: ENTITY_TYPE_ID, key: "person" }]);
    const captured = captureLogs();
    try {
      await store.createVectorIndex("person", 768);
    } finally {
      captured.restore();
    }

    const reported = captured.lines.join("\n");
    expect(reported).toContain("entity type 'person'");
    expect(reported).toContain("1024");
    expect(reported).toContain("768");
    expect(reported).toContain("/api/model/rebuild-embeddings");
    expect(statements().filter((sql) => sql.includes("DROP INDEX"))).toEqual([]);
  });

  it("names every scope the way the API does, never a physical name", async () => {
    existingWidth(
      1024,
      [{ entity_type_id: ENTITY_TYPE_ID, key: "person" }],
      [{ property_id: PROPERTY_ID, entity_type_key: "person", property_key: "bio" }],
    );

    const captured = captureLogs();
    try {
      await store.ensureVectorIndexes(768);
    } finally {
      captured.restore();
    }

    const reported = captured.lines.join("\n");
    for (const scope of DRIFT_SCOPES) {
      expect(reported, `scope '${scope}' missing`).toContain(scope);
    }
    for (const leak of POSTGRES_LEAKS) {
      expect(reported, `'${leak}' leaked into the report`).not.toContain(leak);
    }
  });

  it("repairs on the recreate flag: drop then recreate at the model's width", async () => {
    existingWidth(1024, [{ entity_type_id: ENTITY_TYPE_ID, key: "person" }]);
    const captured = captureLogs();
    try {
      await store.ensureVectorIndexes(768, true);
    } finally {
      captured.restore();
    }

    const dropped = statements().filter((sql) => sql.includes(`DROP INDEX IF EXISTS ${ENTITY_INDEX}`));
    expect(dropped).toHaveLength(1);
    expect(statements().filter((sql) => sql.includes("CREATE INDEX")).join("\n")).toContain(
      "embedding::vector(768)",
    );
    expect(captured.lines.join("\n")).not.toContain("/api/model/rebuild-embeddings");
  });

  it("stays silent when the widths already agree", async () => {
    existingWidth(768, [{ entity_type_id: ENTITY_TYPE_ID }]);
    const captured = captureLogs();
    try {
      await store.createVectorIndex("person", 768);
    } finally {
      captured.restore();
    }
    expect(captured.lines).toEqual([]);
    expect(statements().filter((sql) => sql.includes("DROP INDEX"))).toEqual([]);
  });
});
