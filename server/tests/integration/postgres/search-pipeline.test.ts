/**
 * The search pipeline on PostgreSQL: writes enqueue in their own
 * transaction, the dependency map's fan-out and deletes, generation
 * reconciliation, the worker building keyword and semantic generations
 * with a deterministic fake provider (hash skip, retries, failure), the
 * claim token, wake-ups, and relation entries that pair one relation with
 * its own target. Index rows are created through the store directly.
 * Requires the docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { settings } from "../../../src/config.js";
import { setEmbeddingProvider } from "../../../src/core/embedding.js";
import type {
  ModelingStore,
  RuntimeStore,
  SearchGenerationRecord,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../../src/core/ports.js";
import {
  closeStores,
  getModelingStore,
  getOntologyRegistry,
  getRuntimeStore,
  getSearchIndexStore,
  initStores,
  subscribeSearchWork,
} from "../../../src/core/ports.js";
import { SearchIndexDefinition } from "../../../src/core/searchIndex.js";
import {
  rebuildSearchIndex,
  reconcileSearchGenerations,
  refreshSearchIndex,
} from "../../../src/runtime/indexing/generations.js";
import { getSearchIndexStatus } from "../../../src/runtime/indexing/status.js";
import {
  drainSearchWork,
  searchEntryRates,
  startSearchWorker,
  stopSearchWorker,
} from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import * as service from "../../../src/runtime/service.js";
import { fakeEmbeddingProvider, type FakeEmbeddingProvider } from "../../fakeEmbedding.js";
import { wipeDatabase } from "../reset.js";

const ONTOLOGY_KEY = "search_pipe";
const NAMESPACE = "ont_search_pipe";
const LENS = "all";

type Row = Record<string, unknown>;

function newProperty(key: string, dataType: string) {
  return {
    propertyId: randomUUID(),
    key,
    displayName: key[0]!.toUpperCase() + key.slice(1),
    description: null,
    dataType,
    required: false,
    defaultValue: null,
  };
}

const EMPLOYMENT = SearchIndexDefinition.parse({
  key: "employment",
  name: "People by employment",
  description: "People with their roles at companies",
  entityType: "person",
  fields: ["name", "email", "bio"],
  relations: [
    {
      relationType: "works_for",
      direction: "outgoing",
      fields: ["role"],
      target: { company: ["name"] },
      label: "Employment",
    },
  ],
});

/** Queue rows of the namespace, as `kind/partId` per entity. */
async function queued(): Promise<Row[]> {
  const result = await runQuery(
    `SELECT generation_id, entity_id, part_kind, group_no, part_id, attempts, not_before, lease_until, last_error
     FROM ${NAMESPACE}.search_queue ORDER BY entity_id, part_kind, part_id`,
  );
  return result.rows;
}

/** The entries of one generation, wherever its table is. */
async function entries(generationId: string): Promise<Row[]> {
  const result = await runQuery(
    `SELECT entity_id, part_kind, group_no, part_id, target_id, text, embedding IS NOT NULL AS embedded,
            tsv IS NOT NULL AS stemmed
     FROM ${NAMESPACE}.se_${generationId.replaceAll("-", "")} ORDER BY entity_id, part_kind, part_id`,
  );
  return result.rows;
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("PostgreSQL search pipeline", () => {
  let modeling: ModelingStore;
  let runtime: RuntimeStore;
  let store: SearchIndexStore;
  let provider: FakeEmbeddingProvider;
  const maxAttempts = settings.SEARCH_MAX_ATTEMPTS;

  async function person(name: string, extra: Row = {}): Promise<string> {
    const created = await service.createEntity(LENS, "person", { name, ...extra }, runtime);
    return created._id as string;
  }

  async function company(name: string): Promise<string> {
    const created = await service.createEntity(LENS, "company", { name }, runtime);
    return created._id as string;
  }

  async function worksFor(from: string, to: string, role: string): Promise<string> {
    const created = await service.createRelation(LENS, "works_for", from, to, { role }, runtime);
    return created._id as string;
  }

  async function addIndex(definition = EMPLOYMENT): Promise<SearchIndexRecord> {
    const index = (await store.createIndex(randomUUID(), "custom", definition))!;
    await reconcileSearchGenerations(ONTOLOGY_KEY);
    return index;
  }

  async function live(index: SearchIndexRecord): Promise<SearchGenerationRecord[]> {
    return (await store.listGenerations(index.searchIndexId)).filter(
      (g) => g.state === "building" || g.state === "ready",
    );
  }

  async function active(index: SearchIndexRecord, representation: "keyword" | "semantic") {
    return (await live(index)).find((g) => g.representation === representation && g.state === "ready")!;
  }

  beforeAll(async () => {
    await initStores();
  });

  afterAll(async () => {
    setEmbeddingProvider(null);
    await wipeDatabase();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    provider = fakeEmbeddingProvider();
    setEmbeddingProvider(provider);
    await getOntologyRegistry().createOntology(randomUUID(), ONTOLOGY_KEY, null, null);
    modeling = await getModelingStore(ONTOLOGY_KEY);
    runtime = await getRuntimeStore(ONTOLOGY_KEY);
    store = await getSearchIndexStore(ONTOLOGY_KEY);
    const personType = randomUUID();
    await modeling.createEntityType(personType, "person", "Person", null, newProperty("name", "string"));
    for (const [key, dataType] of [
      ["email", "string"],
      ["age", "integer"],
      ["bio", "document"],
    ] as const) {
      await modeling.createProperty(personType, "EntityType", randomUUID(), key, key[0]!.toUpperCase() + key.slice(1), null, dataType, false, null);
    }
    const companyType = randomUUID();
    await modeling.createEntityType(companyType, "company", "Company", null, newProperty("name", "string"));
    await modeling.createProperty(companyType, "EntityType", randomUUID(), "founded", "Founded", null, "integer", false, null);
    const worksForType = randomUUID();
    await modeling.createRelationType(worksForType, "works_for", "Works for", null, "person", "company");
    for (const key of ["role", "since"]) {
      await modeling.createProperty(worksForType, "RelationType", randomUUID(), key, key[0]!.toUpperCase() + key.slice(1), null, "string", false, null);
    }
    await modeling.createLens(randomUUID(), LENS, "All", null);
  });

  afterEach(async () => {
    settings.SEARCH_MAX_ATTEMPTS = maxAttempts;
    await stopSearchWorker();
  });

  // ---------------------------------------------------------------------
  // Enqueue
  // ---------------------------------------------------------------------

  it("a write enqueues its parts in its own transaction; a failing write enqueues nothing", async () => {
    setEmbeddingProvider(null);
    const index = await addIndex();
    await drainSearchWork();
    const keyword = await active(index, "keyword");

    const ada = await person("Ada");
    expect(await queued()).toMatchObject([
      { generation_id: keyword.generationId, entity_id: ada, part_kind: "entity", part_id: "" },
    ]);

    const plan = {
      entityParts: [
        { searchIndexId: index.searchIndexId, entityId: randomUUID(), partKind: "entity" as const, groupNo: 0, partId: "" },
      ],
      relationParts: [],
      fanOut: [],
      deleteEntity: null,
      deleteRelation: null,
    };
    // PostgreSQL text cannot hold NUL: the insert fails inside the transaction.
    await expect(
      runtime.createEntity("person", plan.entityParts[0]!.entityId, { name: "A\u0000B" }, {}, null, plan),
    ).rejects.toThrow();
    await expect(
      runtime.createRelation("works_for", randomUUID(), ada, randomUUID(), {}, {}, {
        ...plan,
        entityParts: [],
        relationParts: [{ searchIndexId: index.searchIndexId, groupNo: 0, relationId: randomUUID(), owner: "from" }],
      }),
    ).rejects.toThrow();
    expect((await queued()).map((row) => row["entity_id"])).toEqual([ada]);
  });

  it("an unlisted property enqueues nothing; an own field the self part; a target field fans out", async () => {
    setEmbeddingProvider(null);
    const index = await addIndex();
    const ada = await person("Ada");
    const bob = await person("Bob");
    const carol = await person("Carol");
    const acme = await company("ACME");
    const foo = await company("Foo");
    const adaAcme = await worksFor(ada, acme, "CTO");
    const bobAcme = await worksFor(bob, acme, "Engineer");
    await worksFor(carol, foo, "Advisor");
    await drainSearchWork();
    expect(await queued()).toEqual([]);

    await service.updateEntity(LENS, "person", ada, { age: 36 }, runtime);
    await service.updateEntity(LENS, "company", acme, { founded: 1999 }, runtime);
    expect(await queued()).toEqual([]);

    await service.updateEntity(LENS, "person", ada, { email: "ada@example.org" }, runtime);
    expect((await queued()).map((row) => [row["entity_id"], row["part_kind"]])).toEqual([[ada, "self"]]);
    await drainSearchWork();

    await service.updateEntity(LENS, "company", acme, { name: "ACME Corp" }, runtime);
    const rows = await queued();
    expect(rows.map((row) => [row["entity_id"], row["part_kind"], row["part_id"]]).sort()).toEqual(
      [
        [ada, "relation", adaAcme],
        [bob, "relation", bobAcme],
      ].sort(),
    );
    expect(new Set(rows.map((row) => row["generation_id"]))).toEqual(
      new Set([(await active(index, "keyword")).generationId]),
    );

    await drainSearchWork();
    const texts = (await entries((await active(index, "keyword")).generationId))
      .filter((row) => row["part_kind"] === "relation")
      .map((row) => row["text"] as string);
    expect(texts.filter((text) => text.includes("ACME Corp"))).toHaveLength(2);
  });

  it("a relation delete removes its entries directly, without embedding", async () => {
    const index = await addIndex();
    const ada = await person("Ada");
    const acme = await company("ACME");
    const relation = await worksFor(ada, acme, "CTO");
    await drainSearchWork();
    const embedded = provider.embedded.length;
    const keyword = await active(index, "keyword");
    const semantic = await active(index, "semantic");
    expect((await entries(semantic.generationId)).some((row) => row["part_id"] === relation)).toBe(true);

    await service.deleteRelation(LENS, "works_for", relation, runtime);
    expect(await queued()).toEqual([]);
    for (const generation of [keyword, semantic]) {
      expect((await entries(generation.generationId)).map((row) => row["part_kind"])).toEqual(["self"]);
    }
    await drainSearchWork();
    expect(provider.embedded.length).toBe(embedded);
  });

  it("an entity delete removes its entries and queued work — and those of relations to it", async () => {
    const index = await addIndex();
    const ada = await person("Ada");
    const bob = await person("Bob");
    const acme = await company("ACME");
    await worksFor(ada, acme, "CTO");
    await worksFor(bob, acme, "Engineer");
    await drainSearchWork();

    await service.updateEntity(LENS, "person", ada, { email: "ada@example.org" }, runtime);
    expect((await queued()).length).toBeGreaterThan(0);
    await service.deleteEntity(LENS, "person", ada, runtime);
    expect(await queued()).toEqual([]);
    const keyword = await active(index, "keyword");
    expect((await entries(keyword.generationId)).some((row) => row["entity_id"] === ada)).toBe(false);

    // The target goes: Bob's relation entry cascades with the relation.
    await service.deleteEntity(LENS, "company", acme, runtime);
    for (const generation of [keyword, await active(index, "semantic")]) {
      expect((await entries(generation.generationId)).map((row) => [row["entity_id"], row["part_kind"]])).toEqual([
        [bob, "self"],
      ]);
    }
  });

  // ---------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------

  it("builds keyword and semantic generations with a full backfill and switches them in", async () => {
    setEmbeddingProvider(null);
    const ada = await person("Ada", { email: "ada@example.org" });
    const acme = await company("ACME");
    await worksFor(ada, acme, "CTO");
    await person("Bob");
    setEmbeddingProvider(provider);

    const index = await addIndex();
    const building = await live(index);
    expect(building.map((g) => [g.representation, g.state, g.total]).sort()).toEqual([
      ["keyword", "building", 2],
      ["semantic", "building", 2],
    ]);
    expect((await getSearchIndexStatus(ONTOLOGY_KEY, "employment")).state).toBe("building");

    await drainSearchWork();
    const ready = await live(index);
    expect(ready.map((g) => [g.representation, g.state]).sort()).toEqual([
      ["keyword", "ready"],
      ["semantic", "ready"],
    ]);
    const attached = await runQuery(
      `SELECT count(*)::int AS n FROM ${NAMESPACE}.search_entry WHERE generation_id = ANY($1::uuid[])`,
      [ready.map((g) => g.generationId)],
    );
    expect(attached.rows[0]!["n"]).toBe(6);

    const semantic = await entries((await active(index, "semantic")).generationId);
    expect(semantic.every((row) => row["embedded"] === true && row["stemmed"] === false)).toBe(true);
    const keyword = await entries((await active(index, "keyword")).generationId);
    expect(keyword.every((row) => row["embedded"] === false && row["stemmed"] === true)).toBe(true);
    expect(keyword.find((row) => row["entity_id"] === ada && row["part_kind"] === "self")!["text"]).toBe(
      "Ada\nada@example.org",
    );
    expect(semantic.find((row) => row["entity_id"] === ada && row["part_kind"] === "self")!["text"]).toBe(
      "Person: Ada\nEmail: ada@example.org",
    );

    const status = await getSearchIndexStatus(ONTOLOGY_KEY, "employment");
    expect(status.state).toBe("ready");
    expect(status.representations.map((r) => [r.representation, r.state])).toEqual([
      ["keyword", "ready"],
      ["semantic", "ready"],
    ]);
    expect(searchEntryRates().keyword.measured).toBe(true);
  });

  it("writes passages per chunk and drops those past a shortened document", async () => {
    setEmbeddingProvider(null);
    const index = await addIndex();
    const paragraph = "Ada wrote notes on the analytical engine. ".repeat(30);
    const ada = await person("Ada", { bio: `${paragraph}\n\n${paragraph}\n\n${paragraph}` });
    await drainSearchWork();
    const generation = (await active(index, "keyword")).generationId;
    const passages = (await entries(generation)).filter((row) => row["part_kind"] === "passage");
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((row) => (row["text"] as string).startsWith("Ada\n"))).toBe(true);

    await service.updateEntity(LENS, "person", ada, { bio: "Short now." }, runtime);
    expect((await queued()).map((row) => row["part_kind"])).toEqual(["passage"]);
    await drainSearchWork();
    expect((await entries(generation)).filter((row) => row["part_kind"] === "passage")).toMatchObject([
      { part_id: "0", text: "Ada\nShort now." },
    ]);
  });

  it("a nulled document drops its passages and keeps the entity's own entry", async () => {
    setEmbeddingProvider(null);
    const index = await addIndex();
    const ada = await person("Ada", { bio: "Ada wrote notes on the analytical engine." });
    await drainSearchWork();
    const generation = (await active(index, "keyword")).generationId;
    expect((await entries(generation)).map((row) => row["part_kind"])).toEqual(["passage", "self"]);

    await service.updateEntity(LENS, "person", ada, { bio: null }, runtime);
    await drainSearchWork();
    expect((await entries(generation)).map((row) => row["part_kind"])).toEqual(["self"]);
  });

  it("a write embeds nothing in the request; the worker embeds its entries later", async () => {
    const index = await addIndex();
    await drainSearchWork();
    const embed = vi.spyOn(provider, "embed");
    const batches = provider.batchCalls;

    const ada = await person("Ada", { bio: "Ada wrote notes on the analytical engine." });
    await service.updateEntity(LENS, "person", ada, { email: "ada@example.org" }, runtime);
    await service.editDocument(
      LENS, "person", ada, "bio",
      { op: "str_replace", oldString: "notes", newString: "the first program" },
      runtime,
    );
    expect(embed).not.toHaveBeenCalled();
    expect(provider.batchCalls).toBe(batches);
    expect((await queued()).length).toBeGreaterThan(0);

    await drainSearchWork();
    expect(embed).not.toHaveBeenCalled();
    expect(provider.batchCalls).toBeGreaterThan(batches);
    const semantic = await entries((await active(index, "semantic")).generationId);
    expect(semantic.map((row) => [row["part_kind"], row["embedded"]])).toEqual([
      ["passage", true],
      ["self", true],
    ]);
    expect(provider.embedded.some((text) => text.includes("the first program"))).toBe(true);
  });

  it("pairs each relation entry with its own target only", async () => {
    const index = await addIndex();
    const ada = await person("Ada");
    const acme = await company("ACME");
    const foo = await company("Foo");
    const cto = await worksFor(ada, acme, "CTO");
    const advisor = await worksFor(ada, foo, "Advisor");
    await drainSearchWork();

    for (const representation of ["keyword", "semantic"] as const) {
      const relations = (await entries((await active(index, representation)).generationId)).filter(
        (row) => row["part_kind"] === "relation",
      );
      expect(relations.map((row) => [row["part_id"], row["target_id"]]).sort()).toEqual(
        [
          [cto, acme],
          [advisor, foo],
        ].sort(),
      );
      const ctoText = relations.find((row) => row["part_id"] === cto)!["text"] as string;
      const advisorText = relations.find((row) => row["part_id"] === advisor)!["text"] as string;
      if (representation === "semantic") {
        expect(ctoText).toBe("Person: Ada\nEmployment\nRole: CTO\nCompany: ACME");
        expect(advisorText).toBe("Person: Ada\nEmployment\nRole: Advisor\nCompany: Foo");
      } else {
        expect(ctoText).toBe("Ada\nCTO\nACME");
        expect(advisorText).toBe("Ada\nAdvisor\nFoo");
      }
    }

    // A query word equal to a schema label never matches through the label.
    const keyword = (await active(index, "keyword")).generationId;
    const matches = async (word: string) =>
      (
        await runQuery(
          `SELECT tsv @@ plainto_tsquery('english', $2) AS hit
           FROM ${NAMESPACE}.se_${keyword.replaceAll("-", "")} WHERE part_id = $1`,
          [cto, word],
        )
      ).rows[0]!["hit"];
    expect(await matches("CTO")).toBe(true);
    expect(await matches("ACME")).toBe(true);
    for (const label of ["Role", "Company", "Employment", "Person"]) {
      expect(await matches(label)).toBe(false);
    }
  });

  it("skips unchanged entries: no provider call for unchanged text", async () => {
    const index = await addIndex();
    const ada = await person("Ada");
    await worksFor(ada, await company("ACME"), "CTO");
    await drainSearchWork();
    const embedded = provider.embedded.length;
    const calls = provider.batchCalls;

    expect(await refreshSearchIndex(ONTOLOGY_KEY, "employment")).toBe(2);
    await drainSearchWork();
    expect(provider.embedded.length).toBe(embedded);
    expect(provider.batchCalls).toBe(calls);

    await service.updateEntity(LENS, "person", ada, { email: "ada@example.org" }, runtime);
    await drainSearchWork();
    expect(provider.embedded.slice(embedded)).toEqual(["Person: Ada\nEmail: ada@example.org"]);
    expect((await active(index, "semantic")).state).toBe("ready");
  });

  it("retries with backoff, counts items failed for good, and a rebuild retries them", async () => {
    await person("Ada");
    await person("Bob");
    provider.failWith = "provider down";
    const index = await addIndex();

    // The default backoff holds a failed item back.
    await drainSearchWork({ batchSize: 64 });
    const held = (await queued()).filter((row) => row["attempts"] === 1);
    expect(held).toHaveLength(2);
    expect((held[0]!["not_before"] as Date).getTime()).toBeGreaterThan(Date.now() + 3_000);
    expect(held[0]!["last_error"]).toContain("provider down");
    expect(held[0]!["lease_until"]).toBeNull();

    // Without backoff the attempts run out.
    settings.SEARCH_MAX_ATTEMPTS = 3;
    await runQuery(`UPDATE ${NAMESPACE}.search_queue SET not_before = now()`);
    await drainSearchWork({ backoffMs: () => 0 });
    expect((await queued()).map((row) => row["attempts"])).toEqual([3, 3]);
    const status = await getSearchIndexStatus(ONTOLOGY_KEY, "employment");
    const semantic = status.representations.find((r) => r.representation === "semantic")!;
    expect(semantic).toMatchObject({ state: "failed", failed: 2, total: 2, done: 0 });
    expect(semantic.lastErrors[0]!.message).toContain("provider down");
    expect(status.representations.find((r) => r.representation === "keyword")!.state).toBe("ready");
    expect(status.state).toBe("failed");
    expect((await live(index)).find((g) => g.representation === "semantic")!.state).toBe("building");

    provider.failWith = null;
    const changes = await rebuildSearchIndex(ONTOLOGY_KEY, "employment");
    expect(changes.map((c) => [c.representation, c.action]).sort()).toEqual([
      ["keyword", "created"],
      ["semantic", "created"],
    ]);
    await drainSearchWork();
    expect((await getSearchIndexStatus(ONTOLOGY_KEY, "employment")).state).toBe("ready");
    expect(await queued()).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------

  it("reconciles on a definition change, and retires a build the definition no longer wants", async () => {
    await person("Ada", { email: "ada@example.org", age: 36 });
    const index = await addIndex();
    await drainSearchWork();
    const before = await active(index, "keyword");

    const widened = { ...EMPLOYMENT, fields: [...EMPLOYMENT.fields, "age"] };
    await store.updateIndexDefinition("employment", widened);
    const changes = await reconcileSearchGenerations(ONTOLOGY_KEY);
    expect(changes.map((c) => [c.representation, c.action]).sort()).toEqual([
      ["keyword", "created"],
      ["semantic", "created"],
    ]);
    expect((await active(index, "keyword")).generationId).toBe(before.generationId);

    // Changed back before the build finished: the build is not wanted.
    await store.updateIndexDefinition("employment", EMPLOYMENT);
    expect((await reconcileSearchGenerations(ONTOLOGY_KEY)).map((c) => c.action)).toEqual(["retired", "retired"]);
    expect(await reconcileSearchGenerations(ONTOLOGY_KEY)).toEqual([]);

    await store.updateIndexDefinition("employment", widened);
    await reconcileSearchGenerations(ONTOLOGY_KEY);
    await drainSearchWork();
    const after = await active(index, "keyword");
    expect(after.generationId).not.toBe(before.generationId);
    expect((await entries(after.generationId))[0]!["text"]).toBe("Ada\nada@example.org\n36");
    expect((await store.getGeneration(before.generationId))!.state).toBe("retired");

    // A representation switched off keeps no generation.
    await store.updateIndexDefinition("employment", { ...widened, semantic: { enabled: false, template: null } });
    await reconcileSearchGenerations(ONTOLOGY_KEY);
    expect((await live(index)).map((g) => g.representation)).toEqual(["keyword"]);
  });

  it("reconciles on a model change: a new semantic generation, keyword untouched", async () => {
    await person("Ada");
    const index = await addIndex();
    await drainSearchWork();
    const keyword = await active(index, "keyword");
    const semantic = await active(index, "semantic");

    const next = fakeEmbeddingProvider({ model: "other" });
    setEmbeddingProvider(next);
    const changes = await reconcileSearchGenerations(ONTOLOGY_KEY);
    expect(changes.map((c) => [c.representation, c.action])).toEqual([["semantic", "created"]]);
    await drainSearchWork();
    const switched = await active(index, "semantic");
    expect(switched.modelId).toBe(next.modelId);
    expect(switched.generationId).not.toBe(semantic.generationId);
    expect((await active(index, "keyword")).generationId).toBe(keyword.generationId);
    expect(next.embedded).toEqual(["Person: Ada"]);

    // Without a provider, no semantic generation is started.
    setEmbeddingProvider(null);
    await store.updateIndexDefinition("employment", { ...EMPLOYMENT, fields: ["name"] });
    expect((await reconcileSearchGenerations(ONTOLOGY_KEY)).map((c) => c.representation)).toEqual(["keyword"]);
    const status = await getSearchIndexStatus(ONTOLOGY_KEY, "employment");
    expect(status.representations.find((r) => r.representation === "semantic")!.state).toBe("unavailable");
  });

  // ---------------------------------------------------------------------
  // Queue mechanics
  // ---------------------------------------------------------------------

  it("keeps an item enqueued again while leased, and reclaims expired leases", async () => {
    setEmbeddingProvider(null);
    const index = await addIndex();
    await drainSearchWork();
    const ada = await person("Ada");

    const options = { limit: 10, leaseSeconds: 300, maxAttempts: 5, semanticModelId: null };
    const [claim] = await store.claimQueueItems(options);
    expect(claim).toMatchObject({ entityId: ada, partKind: "entity", representation: "keyword" });
    expect(await store.claimQueueItems(options)).toEqual([]);

    await service.updateEntity(LENS, "person", ada, { name: "Ada L." }, runtime);
    await store.completeQueueItems([claim!]);
    expect(await queued()).toMatchObject([{ entity_id: ada, part_kind: "entity", lease_until: null }]);

    const [expiring] = await store.claimQueueItems({ ...options, leaseSeconds: 0 });
    expect(expiring?.entityId).toBe(ada);
    const [reclaimed] = await store.claimQueueItems(options);
    expect(reclaimed?.entityId).toBe(ada);
    await store.completeQueueItems([reclaimed!]);
    expect(await queued()).toEqual([]);
    expect((await active(index, "keyword")).state).toBe("ready");
  });

  it("notifies listeners when work is queued, and the running worker builds", async () => {
    setEmbeddingProvider(null);
    const woken: string[] = [];
    const subscription = (await subscribeSearchWork((key) => woken.push(key)))!;
    try {
      const index = await addIndex();
      await person("Ada");
      await waitFor(() => woken.length > 0);
      expect(woken[0]).toBe(ONTOLOGY_KEY);

      await startSearchWorker();
      await waitFor(async () => (await live(index)).every((g) => g.state === "ready") && (await queued()).length === 0);
      await stopSearchWorker();
      expect((await entries((await active(index, "keyword")).generationId)).length).toBe(1);
    } finally {
      await subscription.close();
    }
  });
});

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
