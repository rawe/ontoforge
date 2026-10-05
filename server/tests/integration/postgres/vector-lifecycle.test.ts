/**
 * The vector-index lifecycle against a live PostgreSQL. Instance search
 * lives in the search-index partitions (`search-index-storage.test.ts`);
 * the one vector index beside them is the saved-query description index.
 * What its port method and the startup hook leave in the catalog, its
 * width-drift report and its repair — the rebuild, which here re-embeds
 * the saved-query descriptions alone — and that schema changes build no
 * per-type vector index any more.
 *
 * Every exercise goes through the persistence port or the modeling
 * service; the catalog is read only to assert what the port has no
 * vocabulary for (an index's physical name and the width it was built
 * at). Requires the docker-compose PostgreSQL; the widths are the port's
 * own arguments.
 */

import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import { setEmbeddingProvider } from "../../../src/core/embedding.js";
import type { ModelingStore } from "../../../src/core/ports.js";
import {
  closeStores,
  ensureSemanticIndexes,
  getModelingStore,
  getOntologyRegistry,
  getRuntimeStore,
  getSearchIndexStore,
  initStores,
} from "../../../src/core/ports.js";
import * as modeling from "../../../src/modeling/service.js";
import { fakeEmbeddingProvider } from "../../fakeEmbedding.js";
import { wipeDatabase } from "../reset.js";
import { logsOf, POSTGRES_LEAKS, SAVED_QUERY_SCOPE } from "../../vectorDrift.js";

/** The configured model's width, and a width no model in play produces. */
const MODEL_WIDTH = 768;
const DRIFTED_WIDTH = 1024;

/** The ontology every case runs in, and its physical namespace. */
const ONTOLOGY_KEY = "vec_ont";
const NAMESPACE = "ont_vec_ont";
const SAVED_QUERY_INDEX = "saved_query_embedding_idx";

interface IndexFacts {
  width: number | null;
  definition: string;
}

/** Every index in one namespace, by name, with the width of its first
 * column and its full definition. */
async function catalog(namespace: string = NAMESPACE): Promise<Map<string, IndexFacts>> {
  const result = await runQuery(
    `SELECT idx.relname AS name,
            format_type(att.atttypid, att.atttypmod) AS coltype,
            pg_get_indexdef(idx.oid) AS definition
     FROM pg_class idx
     JOIN pg_namespace nsp ON nsp.oid = idx.relnamespace
     LEFT JOIN pg_attribute att ON att.attrelid = idx.oid AND att.attnum = 1
     WHERE nsp.nspname = $1 AND idx.relkind = 'i'`,
    [namespace],
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

async function widthOf(indexName: string, namespace: string = NAMESPACE): Promise<number | null> {
  return (await catalog(namespace)).get(indexName)?.width ?? null;
}

/** The HNSW indexes over a `vector` column in one namespace. */
async function vectorIndexes(namespace: string = NAMESPACE): Promise<string[]> {
  return [...(await catalog(namespace))]
    .filter(([, facts]) => facts.width !== null)
    .map(([name]) => name)
    .sort();
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL vector-index lifecycle", () => {
  let store: ModelingStore;

  beforeAll(async () => {
    await initStores();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  /** A bare provisioning (no embedding width): no vector index yet —
   * every test decides how it comes into existence. */
  beforeEach(async () => {
    await wipeDatabase();
    await getOntologyRegistry().createOntology(randomUUID(), ONTOLOGY_KEY, null, null, "english");
    store = await getModelingStore(ONTOLOGY_KEY);
  });

  afterEach(() => {
    setEmbeddingProvider(null);
  });

  it("ensures the saved-query index full-table at the model's width", async () => {
    await store.ensureSavedQueryVectorIndex(MODEL_WIDTH);

    const index = (await catalog()).get(SAVED_QUERY_INDEX)!;
    expect(index.width).toBe(MODEL_WIDTH);
    expect(index.definition).toContain("USING hnsw");
    expect(index.definition).toContain("vector_cosine_ops");
    expect(index.definition).not.toContain("WHERE");
  });

  it("the startup hook builds the saved-query index and nothing per type", async () => {
    await modeling.createEntityType(
      { key: "person", displayName: "Person", nameProperty: "name" } as never,
      store,
    );

    await ensureSemanticIndexes(MODEL_WIDTH);

    expect(await vectorIndexes()).toEqual([SAVED_QUERY_INDEX]);
  });

  it("schema changes build no per-type or per-document vector index", async () => {
    setEmbeddingProvider(fakeEmbeddingProvider({ dimensions: MODEL_WIDTH }));
    const person = await modeling.createEntityType(
      { key: "person", displayName: "Person", nameProperty: "name" } as never,
      store,
    );
    const bio = await modeling.createProperty(
      person.entityTypeId,
      "EntityType",
      { key: "bio", displayName: "Bio", dataType: "document", required: false } as never,
      false,
      store,
    );
    expect(await vectorIndexes()).toEqual([]);

    await modeling.deleteProperty(person.entityTypeId, "EntityType", bio.propertyId, false, store);
    await modeling.deleteEntityType(person.entityTypeId, false, store);
    expect(await vectorIndexes()).toEqual([]);
  });

  describe("width drift", () => {
    it("the startup ensure reports a drifted saved-query index and changes nothing", async () => {
      await store.ensureSavedQueryVectorIndex(DRIFTED_WIDTH);

      // The startup hook itself — the path that must never repair.
      const reported = await logsOf(() => ensureSemanticIndexes(MODEL_WIDTH));

      expect(reported).toContain(SAVED_QUERY_SCOPE);
      expect(reported).toContain(String(DRIFTED_WIDTH));
      expect(reported).toContain(String(MODEL_WIDTH));
      // API vocabulary only: no vendor, no physical name.
      for (const leak of POSTGRES_LEAKS) {
        expect(reported, `'${leak}' leaked into the report`).not.toContain(leak);
      }
      expect(await widthOf(SAVED_QUERY_INDEX)).toBe(DRIFTED_WIDTH);
    });

    it("the rebuild repairs the saved-query index alone: no entity, document or search-index work", async () => {
      // Written under a model of the drifted width: a description vector
      // and an index of that width, beside a typed entity with a document.
      const old = fakeEmbeddingProvider({ dimensions: DRIFTED_WIDTH });
      setEmbeddingProvider(old);
      const note = await modeling.createEntityType(
        { key: "note", displayName: "Note", nameProperty: "name" } as never,
        store,
      );
      await modeling.createProperty(
        note.entityTypeId,
        "EntityType",
        { key: "body", displayName: "Body", dataType: "document", required: false } as never,
        false,
        store,
      );
      const lensId = randomUUID();
      await store.createLens(lensId, "all", "All", null);
      await store.upsertSavedQuery(
        lensId, randomUUID(), "notes", "Notes", "Find notes", "[]", "[]", "all",
        (await old.embed("Find notes"))!,
      );
      await store.ensureSavedQueryVectorIndex(DRIFTED_WIDTH);
      const runtime = await getRuntimeStore(ONTOLOGY_KEY);
      await runtime.createEntity("note", randomUUID(), { name: "N", body: "Some text." }, {}, null, null);
      const searchIndices = await getSearchIndexStore(ONTOLOGY_KEY);
      const generationsBefore = await searchIndices.listGenerations();
      const queueBefore = await runQuery(`SELECT count(*)::int AS n FROM ${NAMESPACE}.search_queue`);

      // The model switches; the rebuild follows.
      const current = fakeEmbeddingProvider({ dimensions: MODEL_WIDTH });
      setEmbeddingProvider(current);
      const embed = vi.spyOn(current, "embed");
      const events: Record<string, unknown>[] = [];
      for await (const line of modeling.rebuildSearchData(store, runtime)) {
        events.push(JSON.parse(line) as Record<string, unknown>);
      }

      expect(events).toEqual([
        { type: "progress", entityTypeKey: "saved_queries", processed: 1, total: 1 },
        {
          type: "summary",
          entityTypes: [],
          savedQueriesProcessed: 1,
          savedQueriesFailed: 0,
          totalProcessed: 1,
          totalFailed: 0,
          embeddingsSkipped: false,
        },
      ]);
      expect(embed.mock.calls).toEqual([["Find notes"]]);
      expect(current.batchCalls).toBe(0);
      expect(await widthOf(SAVED_QUERY_INDEX)).toBe(MODEL_WIDTH);
      const stored = await runQuery(
        `SELECT vector_dims(embedding) AS width FROM ${NAMESPACE}.saved_query`,
      );
      expect(stored.rows).toEqual([{ width: MODEL_WIDTH }]);
      expect(await searchIndices.listGenerations()).toEqual(generationsBefore);
      expect(
        (await runQuery(`SELECT count(*)::int AS n FROM ${NAMESPACE}.search_queue`)).rows,
      ).toEqual(queueBefore.rows);
      expect(await vectorIndexes()).toEqual([SAVED_QUERY_INDEX]);
    });

    it("says nothing when the widths agree", async () => {
      await store.ensureSavedQueryVectorIndex(MODEL_WIDTH);
      const reported = await logsOf(() => ensureSemanticIndexes(MODEL_WIDTH));
      expect(reported).toBe("");
    });
  });

  describe("startup maintenance across the registry", () => {
    it("one startup ensure covers every registered ontology's namespace", async () => {
      await getOntologyRegistry().createOntology(randomUUID(), "vec_other", null, null, "english");

      await ensureSemanticIndexes(MODEL_WIDTH);

      expect(await widthOf(SAVED_QUERY_INDEX)).toBe(MODEL_WIDTH);
      expect(await widthOf(SAVED_QUERY_INDEX, "ont_vec_other")).toBe(MODEL_WIDTH);
    });

    it("with zero ontologies the startup ensure does nothing and succeeds", async () => {
      await wipeDatabase();
      await expect(ensureSemanticIndexes(MODEL_WIDTH)).resolves.toBeUndefined();
      const namespaces = await runQuery(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ont\\_%'`,
      );
      expect(namespaces.rows).toHaveLength(0);
    });
  });
});
