/**
 * The vector-index lifecycle against a live PostgreSQL: what the seven
 * port methods actually leave in the catalog, and the three width-drift
 * branches.
 *
 * Written fresh against pgvector's own mechanics — nothing here is a
 * translation of the reference adapter's drift tests. Every exercise goes
 * through the persistence port; the catalog is read only to assert what
 * the port has no vocabulary for (an index's physical name and the width
 * it was built at), and touched directly only to stage an orphan — the
 * one state no port method can produce. Requires the docker-compose
 * PostgreSQL; no embedding provider is involved, since the widths are the
 * port's own arguments.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import {
  closeStores,
  ensureSemanticIndexes,
  getModelingStore,
  initStores,
  wipeDatabase,
} from "../../../src/core/ports.js";

/** The configured model's width, and a width no model in play produces. */
const MODEL_WIDTH = 768;
const DRIFTED_WIDTH = 1024;

interface IndexFacts {
  width: number | null;
  definition: string;
}

/** Every index in the schema, by name, with the width of its first
 * column and its full definition. */
async function catalog(): Promise<Map<string, IndexFacts>> {
  const result = await runQuery(
    `SELECT idx.relname AS name,
            format_type(att.atttypid, att.atttypmod) AS coltype,
            pg_get_indexdef(idx.oid) AS definition
     FROM pg_class idx
     JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
     LEFT JOIN pg_attribute att ON att.attrelid = idx.oid AND att.attnum = 1
     WHERE nsp.nspname = current_schema() AND idx.relkind = 'i'`,
  );
  const facts = new Map<string, IndexFacts>();
  for (const row of result.rows) {
    const match = /^vector\((\d+)\)$/.exec((row.coltype as string | null) ?? "");
    facts.set(row.name as string, {
      width: match === null ? null : Number(match[1]),
      definition: row.definition as string,
    });
  }
  return facts;
}

async function widthOf(indexName: string): Promise<number | null> {
  return (await catalog()).get(indexName)?.width ?? null;
}

/** The 32-hex half of a dynamic index name. */
function nameId(rowId: string): string {
  return rowId.replaceAll("-", "");
}

function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const warn = vi
    .spyOn(console, "warn")
    .mockImplementation((...args: unknown[]) => lines.push(args.map(String).join(" ")));
  const info = vi
    .spyOn(console, "info")
    .mockImplementation((...args: unknown[]) => lines.push(args.map(String).join(" ")));
  return {
    lines,
    restore: () => {
      warn.mockRestore();
      info.mockRestore();
    },
  };
}

/** Run `work` with the logs captured, and return what it wrote. */
async function logsOf(work: () => Promise<void>): Promise<string> {
  const captured = captureLogs();
  try {
    await work();
  } finally {
    captured.restore();
  }
  return captured.lines.join("\n");
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL vector-index lifecycle", () => {
  let entityTypeId: string;
  let documentPropertyId: string;
  let entityIndex: string;
  let chunkIndex: string;

  beforeAll(async () => {
    await initStores();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  /** One entity type with a plain and a document property. No indexes
   * yet — every test decides how they come into existence. */
  beforeEach(async () => {
    await wipeDatabase();
    const store = getModelingStore();
    entityTypeId = randomUUID();
    await store.createEntityType(entityTypeId, "person", "Person", null);
    await store.createProperty(
      entityTypeId,
      "EntityType",
      randomUUID(),
      "name",
      "Name",
      null,
      "string",
      true,
      null,
    );
    documentPropertyId = randomUUID();
    await store.createProperty(
      entityTypeId,
      "EntityType",
      documentPropertyId,
      "bio",
      "Bio",
      null,
      "document",
      false,
      null,
    );
    entityIndex = `vec_entity_${nameId(entityTypeId)}`;
    chunkIndex = `vec_document_chunk_${nameId(documentPropertyId)}`;
    // The two fixed indexes survive a wipe by design; drop them so each
    // test starts from a known width.
    await runQuery(`DROP INDEX IF EXISTS entity_embedding_all_idx`);
    await runQuery(`DROP INDEX IF EXISTS saved_query_embedding_idx`);
  });

  it("ensures the whole inventory: two partial indexes and the two fixed ones", async () => {
    await getModelingStore().ensureVectorIndexes(MODEL_WIDTH);

    const indexes = await catalog();
    for (const name of [
      entityIndex,
      chunkIndex,
      "entity_embedding_all_idx",
      "saved_query_embedding_idx",
    ]) {
      expect(indexes.has(name), `${name} missing`).toBe(true);
      expect(indexes.get(name)!.width).toBe(MODEL_WIDTH);
      expect(indexes.get(name)!.definition).toContain("USING hnsw");
      expect(indexes.get(name)!.definition).toContain("vector_cosine_ops");
    }

    // Partial where the inventory says partial, full-table where it does not.
    expect(indexes.get(entityIndex)!.definition).toContain("WHERE (type_key = 'person'");
    expect(indexes.get(chunkIndex)!.definition).toContain("entity_type_key = 'person'");
    expect(indexes.get(chunkIndex)!.definition).toContain("property_key = 'bio'");
    expect(indexes.get("entity_embedding_all_idx")!.definition).not.toContain("WHERE");
    expect(indexes.get("saved_query_embedding_idx")!.definition).not.toContain("WHERE");

    // Relations carry no embedding column, so no relation index exists.
    for (const [name, facts] of indexes) {
      expect(facts.definition.includes("hnsw") && name.includes("relation")).toBe(false);
    }
  });

  it("ensures the inventory from the startup hook, not only the port method", async () => {
    await ensureSemanticIndexes(MODEL_WIDTH);
    for (const name of [
      entityIndex,
      chunkIndex,
      "entity_embedding_all_idx",
      "saved_query_embedding_idx",
    ]) {
      expect(await widthOf(name), `${name} missing`).toBe(MODEL_WIDTH);
    }
  });

  it("names every dynamic index reversibly from the row that causes it", async () => {
    await getModelingStore().ensureVectorIndexes(MODEL_WIDTH);
    const dynamic = [...(await catalog()).keys()].filter((name) => name.startsWith("vec_")).sort();

    expect(dynamic).toEqual([chunkIndex, entityIndex].sort());
    // name → uuid → schema row, the direction the sweep walks.
    const rows = await runQuery(
      `SELECT entity_type_id FROM entity_type WHERE replace(entity_type_id::text, '-', '') = $1`,
      [entityIndex.slice("vec_entity_".length)],
    );
    expect(rows.rows[0]!.entity_type_id).toBe(entityTypeId);
  });

  it("creates and drops one type's index through the port", async () => {
    const store = getModelingStore();
    await store.createVectorIndex("person", MODEL_WIDTH, ["name"]);
    expect(await widthOf(entityIndex)).toBe(MODEL_WIDTH);

    await store.dropVectorIndex("person");
    expect(await widthOf(entityIndex)).toBeNull();
  });

  it("creates and drops one document property's chunk index through the port", async () => {
    const store = getModelingStore();
    await store.createDocumentVectorIndex("person", "bio", MODEL_WIDTH);
    expect(await widthOf(chunkIndex)).toBe(MODEL_WIDTH);

    await store.dropDocumentVectorIndex("person", "bio");
    expect(await widthOf(chunkIndex)).toBeNull();
  });

  it("rebuilds an existing index to the model's width", async () => {
    const store = getModelingStore();
    await store.createVectorIndex("person", DRIFTED_WIDTH);
    await store.rebuildVectorIndex("person", MODEL_WIDTH);
    expect(await widthOf(entityIndex)).toBe(MODEL_WIDTH);
  });

  it("ensures the saved-query index on its own", async () => {
    await getModelingStore().ensureSavedQueryVectorIndex(MODEL_WIDTH);
    expect(await widthOf("saved_query_embedding_idx")).toBe(MODEL_WIDTH);
    expect(await widthOf("entity_embedding_all_idx")).toBeNull();
  });

  describe("width drift", () => {
    /** The whole inventory built at the wrong width. */
    async function stageDrift(): Promise<void> {
      await getModelingStore().ensureVectorIndexes(DRIFTED_WIDTH);
      for (const name of [
        entityIndex,
        chunkIndex,
        "entity_embedding_all_idx",
        "saved_query_embedding_idx",
      ]) {
        expect(await widthOf(name)).toBe(DRIFTED_WIDTH);
      }
    }

    it("the startup ensure warns per mismatched scope and changes nothing", async () => {
      await stageDrift();

      // The startup hook itself — the path that must never repair.
      const reported = await logsOf(() => ensureSemanticIndexes(MODEL_WIDTH));

      for (const scope of [
        "entity type 'person'",
        "document property 'bio' on entity type 'person'",
        "search across all entity types",
        "saved-query descriptions",
      ]) {
        expect(reported, `scope '${scope}' not reported`).toContain(scope);
      }
      expect(reported).toContain(String(DRIFTED_WIDTH));
      expect(reported).toContain(String(MODEL_WIDTH));
      expect(reported).toContain("/api/model/rebuild-embeddings");
      // API vocabulary only: no vendor, no physical name.
      for (const leak of ["vec_", "_idx", "PostgreSQL", "hnsw", "pgvector", "CREATE INDEX"]) {
        expect(reported, `'${leak}' leaked into the report`).not.toContain(leak);
      }

      for (const name of [
        entityIndex,
        chunkIndex,
        "entity_embedding_all_idx",
        "saved_query_embedding_idx",
      ]) {
        expect(await widthOf(name), `${name} was touched`).toBe(DRIFTED_WIDTH);
      }
    });

    it("the recreate flag repairs every scope", async () => {
      await stageDrift();

      const reported = await logsOf(() =>
        getModelingStore().ensureVectorIndexes(MODEL_WIDTH, true),
      );

      expect(reported).toContain("Recreating the semantic index for entity type 'person'");
      expect(reported).not.toContain("/api/model/rebuild-embeddings");
      for (const name of [
        entityIndex,
        chunkIndex,
        "entity_embedding_all_idx",
        "saved_query_embedding_idx",
      ]) {
        expect(await widthOf(name), `${name} was not repaired`).toBe(MODEL_WIDTH);
      }
    });

    it("the per-type create path reports without touching", async () => {
      const store = getModelingStore();
      await store.createVectorIndex("person", DRIFTED_WIDTH);
      await store.createDocumentVectorIndex("person", "bio", DRIFTED_WIDTH);
      await store.ensureSavedQueryVectorIndex(DRIFTED_WIDTH);

      const reported = await logsOf(async () => {
        await store.createVectorIndex("person", MODEL_WIDTH);
        await store.createDocumentVectorIndex("person", "bio", MODEL_WIDTH);
        await store.ensureSavedQueryVectorIndex(MODEL_WIDTH);
      });

      expect(reported).toContain("entity type 'person'");
      expect(reported).toContain("document property 'bio' on entity type 'person'");
      expect(reported).toContain("saved-query descriptions");
      for (const name of [entityIndex, chunkIndex, "saved_query_embedding_idx"]) {
        expect(await widthOf(name), `${name} was touched`).toBe(DRIFTED_WIDTH);
      }
    });

    it("says nothing when the widths agree", async () => {
      await getModelingStore().ensureVectorIndexes(MODEL_WIDTH);
      const reported = await logsOf(() => getModelingStore().ensureVectorIndexes(MODEL_WIDTH));
      expect(reported).toBe("");
    });
  });

  describe("orphan sweep", () => {
    it("drops a dynamic index whose uuid matches no schema row", async () => {
      // Staged directly: no port method can leave an index behind whose
      // row never existed. The stale predicate is the point — it still
      // matches rows a re-created type key would write.
      const orphan = `vec_entity_${nameId(randomUUID())}`;
      const chunkOrphan = `vec_document_chunk_${nameId(randomUUID())}`;
      await runQuery(
        `CREATE INDEX ${orphan} ON entity USING hnsw ((embedding::vector(${MODEL_WIDTH})) vector_cosine_ops) WHERE type_key = 'person'`,
      );
      await runQuery(
        `CREATE INDEX ${chunkOrphan} ON document_chunk USING hnsw ((embedding::vector(${MODEL_WIDTH})) vector_cosine_ops)`,
      );

      await getModelingStore().ensureVectorIndexes(MODEL_WIDTH);

      const indexes = await catalog();
      expect(indexes.has(orphan)).toBe(false);
      expect(indexes.has(chunkOrphan)).toBe(false);
      expect(indexes.has(entityIndex)).toBe(true);
      expect(indexes.has(chunkIndex)).toBe(true);
    });

    it("collects the index a deleted entity type left behind", async () => {
      const store = getModelingStore();
      await store.ensureVectorIndexes(MODEL_WIDTH);
      expect(await widthOf(entityIndex)).toBe(MODEL_WIDTH);

      // The delete hooks run after the schema row is gone, so the drop
      // has no name to derive and the index survives as an orphan.
      await store.deleteEntityType(entityTypeId);
      await store.dropDocumentVectorIndex("person", "bio");
      await store.dropVectorIndex("person");
      expect(await widthOf(entityIndex)).toBe(MODEL_WIDTH);

      await store.ensureVectorIndexes(MODEL_WIDTH);

      const indexes = await catalog();
      expect(indexes.has(entityIndex)).toBe(false);
      expect(indexes.has(chunkIndex)).toBe(false);
      expect(indexes.has("entity_embedding_all_idx")).toBe(true);
    });

    it("leaves the fixed indexes alone", async () => {
      await getModelingStore().ensureVectorIndexes(MODEL_WIDTH);
      await getModelingStore().ensureVectorIndexes(MODEL_WIDTH);
      const indexes = await catalog();
      expect(indexes.has("entity_embedding_all_idx")).toBe(true);
      expect(indexes.has("saved_query_embedding_idx")).toBe(true);
    });
  });
});
