/**
 * Search-index storage on PostgreSQL: index rows, the generation lifecycle
 * over per-generation partitions, and the entry writes the pipeline uses.
 * Exercises go through the `SearchIndexStore` port; the catalog is read to
 * assert what the port has no vocabulary for (tables, attachment, indexes,
 * partition pruning), and touched directly only to stage queue rows and an
 * index inclusion, whose own surfaces come later. Requires the
 * docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import type {
  ModelingStore,
  SearchEntryWrite,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../../src/core/ports.js";
import {
  closeStores,
  getModelingStore,
  getOntologyRegistry,
  getSearchIndexStore,
  initStores,
} from "../../../src/core/ports.js";
import { entryTextHash } from "../../../src/core/searchEntry.js";
import { SearchIndexDefinition } from "../../../src/core/searchIndex.js";
import { wipeDatabase } from "../reset.js";

const ONTOLOGY_KEY = "search_store";
const NAMESPACE = "ont_search_store";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKS_FOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function definition(key: string, entityType = "person"): SearchIndexDefinition {
  return SearchIndexDefinition.parse({
    key,
    name: key,
    description: `Index ${key}`,
    entityType,
    fields: ["name"],
  });
}

function table(generationId: string): string {
  return `se_${generationId.replaceAll("-", "")}`;
}

function entry(
  entityId: string,
  text: string,
  embedding: number[] | null,
  part: { partKind?: "self" | "relation" | "passage"; groupNo?: number; partId?: string } = {},
): SearchEntryWrite {
  return {
    entityId,
    partKind: part.partKind ?? "self",
    groupNo: part.groupNo ?? 0,
    partId: part.partId ?? "",
    relationType: part.partKind === "relation" ? "works_for" : null,
    targetType: null,
    targetId: null,
    startChar: null,
    charLength: null,
    text,
    textHash: entryTextHash(text, embedding === null ? "keyword" : "semantic", null),
    embedding,
  };
}

/** The `se_` tables in the namespace and whether each is attached. */
async function partitionTables(): Promise<Record<string, boolean>> {
  const result = await runQuery(
    `SELECT c.relname, i.inhparent IS NOT NULL AS attached
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
     WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname LIKE 'se\\_%'`,
    [NAMESPACE],
  );
  return Object.fromEntries(result.rows.map((row) => [row.relname as string, row.attached as boolean]));
}

async function indexDefinitions(tableName: string): Promise<string[]> {
  const result = await runQuery(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
    [NAMESPACE, tableName],
  );
  return result.rows.map((row) => row.indexdef as string);
}

async function constraintNames(tableName: string): Promise<string[]> {
  const result = await runQuery(
    `SELECT c.conname FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2 AND c.contype <> 'n' ORDER BY c.conname`,
    [NAMESPACE, tableName],
  );
  return result.rows.map((row) => row.conname as string);
}

/** Entity ids of the entries the parent holds for one generation. */
async function parentRows(generationId: string): Promise<string[]> {
  const result = await runQuery(
    `SELECT entity_id FROM ${NAMESPACE}.search_entry WHERE generation_id = $1 ORDER BY entity_id, part_id`,
    [generationId],
  );
  return result.rows.map((row) => row.entity_id as string);
}

async function enqueue(generationId: string, entityId: string): Promise<void> {
  await runQuery(
    `INSERT INTO ${NAMESPACE}.search_queue (generation_id, entity_id, part_kind, group_no, part_id)
     VALUES ($1, $2, 'self', 0, '')`,
    [generationId, entityId],
  );
}

async function queueCount(): Promise<number> {
  const result = await runQuery(`SELECT count(*)::int AS n FROM ${NAMESPACE}.search_queue`);
  return result.rows[0]!.n as number;
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL search-index storage", () => {
  let modeling: ModelingStore;
  let store: SearchIndexStore;
  let personTypeId: string;

  async function newIndex(key = "people"): Promise<SearchIndexRecord> {
    return (await store.createIndex(randomUUID(), "custom", definition(key)))!;
  }

  async function semantic(index: SearchIndexRecord, dimensions = 3): Promise<string> {
    const generationId = randomUUID();
    await store.createGeneration({
      generationId,
      searchIndexId: index.searchIndexId,
      representation: "semantic",
      definitionHash: "hash",
      modelId: "fake:model:3",
      dimensions,
      languages: null,
    });
    return generationId;
  }

  async function keyword(index: SearchIndexRecord): Promise<string> {
    const generationId = randomUUID();
    await store.createGeneration({
      generationId,
      searchIndexId: index.searchIndexId,
      representation: "keyword",
      definitionHash: "hash",
      modelId: null,
      dimensions: null,
      languages: ["german", "english"],
    });
    return generationId;
  }

  beforeAll(async () => {
    await initStores();
  });

  afterAll(async () => {
    await wipeDatabase();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
    await getOntologyRegistry().createOntology(randomUUID(), ONTOLOGY_KEY, null, null);
    modeling = await getModelingStore(ONTOLOGY_KEY);
    store = await getSearchIndexStore(ONTOLOGY_KEY);
    personTypeId = randomUUID();
    await modeling.createEntityType(personTypeId, "person", "Person", null, {
      propertyId: randomUUID(),
      key: "name",
      displayName: "Name",
      description: null,
      dataType: "string",
      required: false,
      defaultValue: null,
    });
  });

  it("a new ontology stems in both languages until the settings change", async () => {
    expect(await store.getSearchSettings()).toEqual({
      keywordLanguages: ["german", "english"],
      disabledDefaults: {},
    });
    const changed = await store.setSearchSettings({
      keywordLanguages: ["english"],
      disabledDefaults: { person: false },
    });
    expect(changed).toEqual({ keywordLanguages: ["english"], disabledDefaults: { person: false } });
    expect(await store.getSearchSettings()).toEqual(changed);
  });

  it("stores index rows by key, rooted on an existing entity type", async () => {
    const created = await newIndex("people");
    expect(created).toMatchObject({ key: "people", kind: "custom", definition: definition("people") });
    await expect(newIndex("people")).rejects.toThrow("Search index with key 'people' already exists");
    expect(await store.createIndex(randomUUID(), "custom", definition("ghosts", "ghost"))).toBeNull();

    const edited = { ...definition("people"), fields: ["name", "bio"] };
    expect((await store.updateIndexDefinition("people", edited))?.definition.fields).toEqual(["name", "bio"]);
    expect(await store.updateIndexDefinition("people", definition("people", "ghost"))).toBeNull();
    expect(await store.updateIndexDefinition("nobody", edited)).toBeNull();

    await newIndex("alpha");
    expect((await store.listIndices()).map((index) => index.key)).toEqual(["alpha", "people"]);
    expect((await store.getIndex("people"))?.searchIndexId).toBe(created.searchIndexId);

    expect(await store.deleteIndex("people")).toBe(true);
    expect(await store.deleteIndex("people")).toBe(false);
    expect(await store.getIndex("people")).toBeNull();
  });

  it("a semantic generation fills its own table, then serves as an attached partition with a cast HNSW", async () => {
    const index = await newIndex();
    const first = await semantic(index);

    expect((await store.getGeneration(first))?.state).toBe("building");
    expect(await partitionTables()).toEqual({ [table(first)]: false });
    expect(await constraintNames(table(first))).toEqual([`${table(first)}_bound`, `${table(first)}_pk`]);

    expect(await store.upsertEntries(first, [entry(ALICE, "Alice", [1, 0, 0]), entry(BOB, "Bob", [0, 1, 0])])).toBe(true);
    // Replaced by identity, not added.
    expect(await store.upsertEntries(first, [entry(ALICE, "Alice Liddell", [1, 1, 0])])).toBe(true);
    const hashes = await store.readEntryHashes(first, [
      { entityId: ALICE, partKind: "self", groupNo: 0, partId: "" },
      { entityId: ALICE, partKind: "self", groupNo: 1, partId: "" },
    ]);
    expect(hashes).toEqual([
      {
        entityId: ALICE,
        partKind: "self",
        groupNo: 0,
        partId: "",
        textHash: entryTextHash("Alice Liddell", "semantic", null),
      },
    ]);
    await store.recordGenerationProgress(first, { total: 2, done: 2 });

    expect(await store.finishGeneration(first)).toBe(true);

    const finished = await store.getGeneration(first);
    expect(finished).toMatchObject({ state: "ready", total: 2, done: 2, failed: 0, dimensions: 3 });
    expect(finished?.readyAt).toBeInstanceOf(Date);
    expect(await partitionTables()).toEqual({ [table(first)]: true });
    expect(await constraintNames(table(first))).toEqual([`${table(first)}_pk`]);
    const indexes = await indexDefinitions(table(first));
    expect(indexes.some((def) => def.includes("USING hnsw (((embedding)::halfvec(3)) halfvec_cosine_ops)"))).toBe(true);
    expect(indexes.some((def) => def.includes("(entity_id)"))).toBe(true);
    expect(indexes.some((def) => def.includes("(part_id)"))).toBe(true);
    expect(await parentRows(first)).toEqual([ALICE, BOB]);

    // A second generation replaces it.
    const second = await semantic(index);
    expect(await store.upsertEntries(second, [entry(BOB, "Bob", [0, 0, 1])])).toBe(true);
    // Writes still reach the active generation while the next one builds.
    expect(await store.upsertEntries(first, [entry(BOB, "Bob B.", [0, 1, 1])])).toBe(true);
    expect(await store.finishGeneration(second)).toBe(true);

    expect((await store.getGeneration(first))?.state).toBe("retired");
    expect((await store.getGeneration(second))?.state).toBe("ready");
    expect(await partitionTables()).toEqual({ [table(second)]: true });
    expect(await parentRows(first)).toEqual([]);
    expect(await parentRows(second)).toEqual([BOB]);
    expect(await store.upsertEntries(first, [entry(BOB, "Bob", [0, 0, 1])])).toBe(false);
    expect((await store.listGenerations(index.searchIndexId)).map((g) => [g.generationId, g.state])).toEqual([
      [first, "retired"],
      [second, "ready"],
    ]);
  });

  it("a query by generation reads only that generation's partition", async () => {
    const index = await newIndex();
    const a = await semantic(index);
    await store.upsertEntries(a, [entry(ALICE, "Alice", [1, 0, 0])]);
    await store.finishGeneration(a);
    const b = await keyword(index);
    await store.upsertEntries(b, [entry(BOB, "Bob", null)]);
    await store.finishGeneration(b);

    expect(await parentRows(a)).toEqual([ALICE]);
    expect(await parentRows(b)).toEqual([BOB]);
    const plan = await runQuery(
      `EXPLAIN SELECT * FROM ${NAMESPACE}.search_entry WHERE generation_id = $1`,
      [b],
    );
    const text = plan.rows.map((row) => row["QUERY PLAN"] as string).join("\n");
    expect(text).toContain(table(b));
    expect(text).not.toContain(table(a));
  });

  it("a keyword generation stems each entry in every language of its set, under a GIN index", async () => {
    const index = await newIndex();
    const generation = await keyword(index);
    expect(await store.upsertEntries(generation, [entry(ALICE, "Die Häuser are running", null)])).toBe(true);
    expect(await store.finishGeneration(generation)).toBe(true);

    const tsv = await runQuery(
      `SELECT tsv::text AS tsv, embedding FROM ${NAMESPACE}.search_entry WHERE generation_id = $1`,
      [generation],
    );
    expect(tsv.rows[0]!.embedding).toBeNull();
    // German stems "Häuser" to "haus", English "running" to "run".
    expect(tsv.rows[0]!.tsv).toContain("'haus'");
    expect(tsv.rows[0]!.tsv).toContain("'run'");
    const indexes = await indexDefinitions(table(generation));
    expect(indexes.some((def) => def.includes("USING gin (tsv)"))).toBe(true);
  });

  it("a newer generation supersedes one still building, with its queued work", async () => {
    const index = await newIndex();
    const stale = await semantic(index);
    await store.upsertEntries(stale, [entry(ALICE, "Alice", [1, 0, 0])]);
    await enqueue(stale, BOB);

    const fresh = await semantic(index);

    expect((await store.getGeneration(stale))?.state).toBe("retired");
    expect((await store.getGeneration(fresh))?.state).toBe("building");
    expect(await partitionTables()).toEqual({ [table(fresh)]: false });
    expect(await queueCount()).toBe(0);
    expect(await store.finishGeneration(stale)).toBe(false);
    expect(await store.upsertEntries(stale, [entry(ALICE, "Alice", [1, 0, 0])])).toBe(false);
    expect(await store.readEntryHashes(stale, [{ entityId: ALICE, partKind: "self", groupNo: 0, partId: "" }])).toEqual([]);

    // The other representation is a separate lifecycle.
    const words = await keyword(index);
    expect((await store.getGeneration(fresh))?.state).toBe("building");
    expect((await store.getGeneration(words))?.state).toBe("building");
  });

  it("a failed generation drops its table and queued work", async () => {
    const index = await newIndex();
    const generation = await semantic(index);
    await enqueue(generation, ALICE);

    expect(await store.failGeneration(generation)).toBe(true);
    expect(await store.failGeneration(generation)).toBe(false);
    expect((await store.getGeneration(generation))?.state).toBe("failed");
    expect(await partitionTables()).toEqual({});
    expect(await queueCount()).toBe(0);
  });

  it("refuses a vector whose width is not the generation's", async () => {
    const index = await newIndex();
    const generation = await semantic(index);
    await expect(store.upsertEntries(generation, [entry(ALICE, "Alice", [1, 0])])).rejects.toThrow(
      "Embedding width 2",
    );
  });

  it("deletes an entity's and a relation's entries in every generation, attached or building", async () => {
    const index = await newIndex();
    const ready = await semantic(index);
    await store.upsertEntries(ready, [
      entry(ALICE, "Alice", [1, 0, 0]),
      entry(ALICE, "Alice works for ACME", [1, 1, 0], { partKind: "relation", groupNo: 0, partId: WORKS_FOR }),
      entry(BOB, "Bob", [0, 1, 0]),
    ]);
    await store.finishGeneration(ready);
    const building = await keyword(index);
    await store.upsertEntries(building, [
      entry(ALICE, "Alice", null),
      entry(ALICE, "Alice works for ACME", null, { partKind: "relation", groupNo: 0, partId: WORKS_FOR }),
    ]);

    expect(await store.deleteEntriesOfRelation(WORKS_FOR)).toBe(2);
    expect(await store.deleteEntriesOfEntity(ALICE)).toBe(2);

    expect(await parentRows(ready)).toEqual([BOB]);
    const left = await runQuery(`SELECT count(*)::int AS n FROM ${NAMESPACE}.${table(building)}`);
    expect(left.rows[0]!.n).toBe(0);
  });

  it("deletes entries of one generation by identity, or all but the parts that remain", async () => {
    const index = await newIndex();
    const generation = await semantic(index);
    const passage = (partId: string) => entry(ALICE, `chunk ${partId}`, [1, 0, 0], { partKind: "passage", partId });
    await store.upsertEntries(generation, [passage("0"), passage("1"), passage("2"), entry(BOB, "Bob", [0, 1, 0])]);

    expect(await store.deleteEntityPartsExcept(generation, ALICE, "passage", 0, ["0", "1"])).toBe(1);
    expect(await store.deleteEntries(generation, [{ entityId: BOB, partKind: "self", groupNo: 0, partId: "" }])).toBe(1);

    const hashes = await store.readEntryHashes(generation, [
      { entityId: ALICE, partKind: "passage", groupNo: 0, partId: "0" },
      { entityId: ALICE, partKind: "passage", groupNo: 0, partId: "1" },
      { entityId: ALICE, partKind: "passage", groupNo: 0, partId: "2" },
      { entityId: BOB, partKind: "self", groupNo: 0, partId: "" },
    ]);
    expect(hashes.map((hash) => hash.partId).sort()).toEqual(["0", "1"]);
  });

  it("deleting an index removes its generations, queued work and partitions", async () => {
    const index = await newIndex();
    const ready = await semantic(index);
    await store.upsertEntries(ready, [entry(ALICE, "Alice", [1, 0, 0])]);
    await store.finishGeneration(ready);
    const building = await keyword(index);
    await enqueue(building, ALICE);
    expect(await partitionTables()).toEqual({ [table(ready)]: true, [table(building)]: false });

    expect(await store.deleteIndex(index.key)).toBe(true);

    expect(await store.listGenerations()).toEqual([]);
    expect(await queueCount()).toBe(0);
    expect(await partitionTables()).toEqual({});
  });

  it("an entity type delete cascades to its indices; the sweep removes the partitions left behind", async () => {
    const index = await newIndex();
    const ready = await semantic(index);
    await store.finishGeneration(ready);
    const building = await keyword(index);

    expect(await modeling.deleteEntityType(personTypeId)).toBe(true);

    expect(await store.listIndices()).toEqual([]);
    expect(await store.listGenerations()).toEqual([]);
    expect(Object.keys(await partitionTables()).sort()).toEqual([table(ready), table(building)].sort());
    await store.sweepGenerations();
    expect(await partitionTables()).toEqual({});
    await store.sweepGenerations();
  });

  it("an index inclusion is a third inclusion kind that goes with its index", async () => {
    const index = await newIndex();
    const lensId = randomUUID();
    await modeling.createLens(lensId, "agents", "Agents", null);
    await runQuery(
      `INSERT INTO ${NAMESPACE}.lens_includes (lens_id, search_index_id) VALUES ($1, $2)`,
      [lensId, index.searchIndexId],
    );
    await expect(
      runQuery(
        `INSERT INTO ${NAMESPACE}.lens_includes (lens_id, search_index_id) VALUES ($1, $2)`,
        [lensId, index.searchIndexId],
      ),
    ).rejects.toThrow("Search index is already included in this lens");
    await expect(
      runQuery(
        `INSERT INTO ${NAMESPACE}.lens_includes (lens_id, entity_type_id, search_index_id) VALUES ($1, $2, $3)`,
        [lensId, personTypeId, index.searchIndexId],
      ),
    ).rejects.toThrow("A storage operation failed"); // lens_includes_one_type

    // Not a type inclusion: the lens stays unscoped.
    const schema = await modeling.getFullSchema();
    const lens = (schema.lenses as Record<string, unknown>[]).find((l) => l.key === "agents")!;
    expect(lens.entityInclusions).toEqual([]);
    expect(lens.relationInclusions).toEqual([]);

    await store.deleteIndex(index.key);
    const left = await runQuery(`SELECT count(*)::int AS n FROM ${NAMESPACE}.lens_includes`);
    expect(left.rows[0]!.n).toBe(0);
  });
});
