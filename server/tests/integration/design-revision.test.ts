/**
 * The design revision against PostgreSQL: several servers share one
 * database, each with its own schema cache, and no signal passes between
 * them. "Another server" changes the design here by SQL on a connection
 * of its own, or through a modeling call — modeling never touches the
 * runtime cache — and this process's cache is left as it was. Reads and
 * writes then follow the revision: a write never commits against a design
 * that changed, and never plans its search work against older index
 * definitions; a design change in the window between a write's check and
 * its hold makes it run again; generation creation and data writes hand
 * over without losing queue work; a failing design change leaves nothing
 * behind. Requires the docker-compose PostgreSQL.
 */

import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery, withTransaction, type Querier } from "../../src/adapters/postgres/errors.js";
import { createApp } from "../../src/app.js";
import { DesignChangedError } from "../../src/core/exceptions.js";
import {
  closeStores,
  getModelingStore,
  getRuntimeStore,
  getSearchIndexStore,
  initStores,
  type DesignRevision,
  type ModelingStore,
  type RuntimeStore,
} from "../../src/core/ports.js";
import { SearchIndexDefinition } from "../../src/core/searchIndex.js";
import * as modeling from "../../src/modeling/service.js";
import { reconcileSearchGenerations } from "../../src/runtime/indexing/generations.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import * as service from "../../src/runtime/service.js";
import { buildFixture, FIXTURE_ONTOLOGY_KEY as O, modelPrefix, runtimePrefix, type FixtureIds } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const NS = `ont_${O}`;
const ALL = runtimePrefix(O, "test_lens");
const HR = runtimePrefix(O, "hr_view");
const MODEL = modelPrefix(O);

const LOCK_KEY = "hashtextextended('ontoforge.design.' || current_schema(), 0)";

let app: FastifyInstance;
let ids: FixtureIds;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  ids = await buildFixture(app);
});

async function call(method: string, url: string, payload?: Row): Promise<{ status: number; body: Row }> {
  const res = await app.inject({ method: method as "GET", url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.body === "" ? {} : (res.json() as Row) };
}

async function sql(text: string, params?: unknown[]): Promise<Row[]> {
  return (await runQuery(text, params, NS)).rows;
}

/** The revision as stored. */
async function revision(): Promise<DesignRevision> {
  return (await getRuntimeStore(O)).designRevision();
}

/** Another server's design change: `statements` and, unless told
 * otherwise, the revision advanced with them — one transaction on a
 * connection of its own, past this process's cache. */
async function foreignChange(statements: string[], bump = true): Promise<void> {
  await withTransaction(
    async (querier) => {
      for (const statement of statements) await querier.query(statement);
      if (bump) await querier.query(`UPDATE design_revision SET revision = revision + 1`);
    },
    "READ COMMITTED",
    NS,
  );
}

const REQUIRE_AGE = `UPDATE property_def SET required = true
  WHERE key = 'age' AND entity_type_id = (SELECT entity_type_id FROM entity_type WHERE key = 'person')`;

async function createPerson(base: string, properties: Row): Promise<{ status: number; body: Row }> {
  return call("POST", `${base}/entities/person`, properties);
}

/** Whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

/** A transaction on a connection of its own, in the ontology's namespace,
 * that runs `during` and then holds what it took until `release`. */
async function holdRaw(during: (querier: Querier) => Promise<void>): Promise<{ release: () => void; done: Promise<void> }> {
  const held = deferred();
  const released = deferred();
  const done = withTransaction(
    async (querier) => {
      await during(querier);
      held.resolve();
      await released.promise;
    },
    "READ COMMITTED",
    NS,
  );
  await Promise.race([held.promise, done]);
  return { release: released.resolve, done };
}

describe("a design change made elsewhere", () => {
  it("a newly required property refuses a write that omits it, once the revision moved", async () => {
    expect((await createPerson(ALL, { name: "Ada" })).status).toBe(201);
    await foreignChange([REQUIRE_AGE]);

    const refused = await createPerson(ALL, { name: "Bob" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.fields.age).toBeDefined();
    expect((await createPerson(ALL, { name: "Bob", age: 40 })).status).toBe(201);
  });

  it("without a revision change the cache stays as it was: the revision is the signal", async () => {
    expect((await createPerson(ALL, { name: "Ada" })).status).toBe(201);
    await foreignChange([REQUIRE_AGE], false);
    expect((await createPerson(ALL, { name: "Bob" })).status).toBe(201);
  });

  it("a removed property is no longer returned or accepted", async () => {
    const ada = await createPerson(ALL, { name: "Ada", email: "ada@example.org" });
    const url = `${ALL}/entities/person/${ada.body._id as string}`;
    expect((await call("GET", url)).body.email).toBe("ada@example.org");

    await foreignChange([
      `DELETE FROM property_def
        WHERE key = 'email' AND entity_type_id = (SELECT entity_type_id FROM entity_type WHERE key = 'person')`,
    ]);

    expect((await call("GET", url)).body).not.toHaveProperty("email");
    const refused = await createPerson(ALL, { name: "Bob", email: "bob@example.org" });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.fields.email).toBeDefined();
  });

  it("a property a lens narrows away is no longer returned or accepted through it", async () => {
    const ada = await createPerson(HR, { name: "Ada", email: "ada@example.org" });
    const url = `${HR}/entities/person/${ada.body._id as string}`;
    expect((await call("GET", url)).body.email).toBe("ada@example.org");

    // A modeling call: it never touches this process's runtime cache.
    const narrowed = await call("PUT", `${MODEL}/lenses/${ids.hrViewId}/includes/entity-types/${ids.personId}`, {
      properties: ["name"],
    });
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(200);

    expect((await call("GET", url)).body).not.toHaveProperty("email");
    expect((await createPerson(HR, { name: "Bob", email: "bob@example.org" })).status).toBe(422);
  });

  it("a new search index gets the queue work of a write planned before it existed", async () => {
    // Warm the search context: the write plans against the managed indices.
    expect((await createPerson(ALL, { name: "Ada" })).status).toBe(201);
    const created = await call("POST", `${MODEL}/search-indices`, {
      key: "people",
      name: "People",
      description: "People by name",
      entityType: "person",
      fields: ["name", "email"],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const generations = await sql(
      `SELECT g.generation_id FROM search_generation g JOIN search_index si USING (search_index_id)
        WHERE si.key = 'people' AND g.state = 'building'`,
    );
    expect(generations.length).toBeGreaterThan(0);

    const bob = await createPerson(ALL, { name: "Bob" });
    expect(bob.status).toBe(201);
    const queued = await sql(`SELECT generation_id FROM search_queue WHERE entity_id = $1`, [
      bob.body._id,
    ]);
    for (const { generation_id } of generations) {
      expect(queued.map((row) => row.generation_id)).toContain(generation_id);
    }
  });

  it("a changeset commit and check validate against the design at commit time", async () => {
    const cs = await call("POST", `${ALL}/changesets`);
    expect(cs.status).toBe(201);
    const id = cs.body.id as string;
    const staged = await call("POST", `${ALL}/changesets/${id}/writes`, {
      operation: "create_entity",
      type: "person",
      properties: { name: "Carl" },
    });
    expect(staged.status, JSON.stringify(staged.body)).toBe(201);
    expect((await call("POST", `${ALL}/changesets/${id}/check`)).status).toBe(200);

    await foreignChange([REQUIRE_AGE]);

    const checked = await call("POST", `${ALL}/changesets/${id}/check`);
    expect(checked.status).toBe(422);
    const committed = await call("POST", `${ALL}/changesets/${id}/commit`);
    expect(committed.status).toBe(422);
    expect(JSON.stringify(committed.body.error.details.violations)).toContain("age");
    expect(await sql(`SELECT id FROM entity WHERE props->>'name' = 'Carl'`)).toEqual([]);
  });

  it("an ontology deleted and created again under its key is served its own schema", async () => {
    // The successor below reaches revision 3: give the predecessor the same.
    await sql(`UPDATE design_revision SET revision = 3`);
    const predecessor = await revision();
    const before = await call("GET", `${ALL}/schema`);
    expect(before.body.entityTypes.map((et: Row) => et.key).sort()).toEqual(["company", "person"]);

    expect((await call("DELETE", `/api/ontologies/${O}`)).status).toBe(204);
    expect((await call("POST", "/api/ontologies", { key: O })).status).toBe(201);
    expect((await call("POST", `${MODEL}/entity-types`, { key: "thing", displayName: "Thing" })).status).toBe(201);
    expect((await call("POST", `${MODEL}/lenses`, { key: "test_lens", name: "Test Lens" })).status).toBe(201);
    // One revision number; only the ontology id tells the designs apart.
    const successor = await revision();
    expect(successor.revision).toBe(predecessor.revision);
    expect(successor.ontologyId).not.toBe(predecessor.ontologyId);

    const after = await call("GET", `${ALL}/schema`);
    expect(after.body.entityTypes.map((et: Row) => et.key)).toEqual(["thing"]);
  });
});

describe("a design change between a write's check and its hold", () => {
  /** The runtime store, with a design change committed elsewhere just
   * before each of the first `times` transactions. */
  async function racing(times: number, statements: string[] = []): Promise<{ store: RuntimeStore; runs: () => number }> {
    const store = await getRuntimeStore(O);
    let runs = 0;
    const racer = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (...args: Parameters<RuntimeStore["transaction"]>) => {
            runs += 1;
            if (runs <= times) await foreignChange(statements);
            return target.transaction(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { store: racer, runs: () => runs };
  }

  it("makes the write run again against the new design", async () => {
    const { store, runs } = await racing(1);
    const ada = await service.createEntity("test_lens", "person", { name: "Ada" }, store);
    expect(ada.name).toBe("Ada");
    expect(runs()).toBe(2);
  });

  it("validates the second run under the new rules", async () => {
    const { store, runs } = await racing(1, [REQUIRE_AGE]);
    await expect(service.createEntity("test_lens", "person", { name: "Ada" }, store)).rejects.toMatchObject({
      details: { fields: { age: expect.any(String) } },
    });
    expect(runs()).toBe(2);
    expect(await sql(`SELECT id FROM entity`)).toEqual([]);
  });

  it("is a 409 when the design keeps changing, with nothing written", async () => {
    const { store, runs } = await racing(10);
    await expect(service.createEntity("test_lens", "person", { name: "Ada" }, store)).rejects.toBeInstanceOf(
      DesignChangedError,
    );
    expect(runs()).toBe(3);
    expect(await sql(`SELECT id FROM entity`)).toEqual([]);
  });

  it("a transaction against an older revision refuses before its work", async () => {
    const store = await getRuntimeStore(O);
    const old = await store.designRevision();
    await foreignChange([]);
    let ran = false;
    await expect(
      store.transaction(old, async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(DesignChangedError);
    expect(ran).toBe(false);
  });
});

describe("generations and data writes hand over", () => {
  const PEOPLE = SearchIndexDefinition.parse({
    key: "people",
    name: "People",
    description: "People by name",
    entityType: "person",
    fields: ["name"],
    semantic: { enabled: false },
  });

  /** The custom index row alone, as another server's design change leaves
   * it before its reconciliation. */
  async function indexWithoutGeneration(): Promise<string> {
    const searchIndexId = randomUUID();
    const modelingStore = await getModelingStore(O);
    await modelingStore.changeDesign((change) => change.searchIndices().createIndex(searchIndexId, "custom", PEOPLE));
    return searchIndexId;
  }

  async function queuedFor(entityId: string): Promise<string[]> {
    return (await sql(`SELECT generation_id FROM search_queue WHERE entity_id = $1`, [entityId])).map(
      (row) => row.generation_id as string,
    );
  }

  async function building(searchIndexId: string): Promise<string[]> {
    return (
      await sql(`SELECT generation_id FROM search_generation WHERE search_index_id = $1 AND state = 'building'`, [
        searchIndexId,
      ])
    ).map((row) => row.generation_id as string);
  }

  it("a write in flight first: the generation waits for it, and its backfill holds the entity", async () => {
    const searchIndexId = await indexWithoutGeneration();
    const store = await getRuntimeStore(O);
    const entityId = randomUUID();
    const inserted = deferred();
    const release = deferred();
    const write = store.transaction(await store.designRevision(), async (tx) => {
      await tx.createEntity("person", entityId, { name: "Ada" }, {}, null);
      inserted.resolve();
      await release.promise;
    });
    await inserted.promise;

    const reconciled = reconcileSearchGenerations(O);
    expect(await settlesWithin(reconciled, 300)).toBe(false);
    release.resolve();
    await write;
    await reconciled;

    const [generationId] = await building(searchIndexId);
    expect(generationId).toBeDefined();
    expect(await queuedFor(entityId)).toContain(generationId);
  });

  it("a generation in flight first: the write waits for it, and queues into it", async () => {
    const searchIndexId = await indexWithoutGeneration();
    // Warm the cache: the write plans with the index, which has no
    // generation yet.
    expect((await createPerson(ALL, { name: "Ada" })).status).toBe(201);
    const generationId = randomUUID();
    const holder = await holdRaw(async (querier) => {
      await querier.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      await querier.query(
        `INSERT INTO search_generation (generation_id, search_index_id, representation, definition_hash, languages, state)
         VALUES ($1, $2, 'keyword', 'h', ARRAY['german', 'english'], 'building')`,
        [generationId, searchIndexId],
      );
    });
    const write = createPerson(ALL, { name: "Bob" });
    expect(await settlesWithin(write, 300)).toBe(false);
    holder.release();
    await holder.done;

    const bob = await write;
    expect(bob.status).toBe(201);
    expect(await queuedFor(bob.body._id as string)).toContain(generationId);
  });

  it("creation and retirement against an older revision change nothing", async () => {
    const searchIndexId = await indexWithoutGeneration();
    const indices = await getSearchIndexStore(O);
    const old = await indices.designRevision();
    await foreignChange([]);
    const generation = {
      generationId: randomUUID(),
      searchIndexId,
      representation: "keyword" as const,
      definitionHash: "h",
      modelId: null,
      dimensions: null,
      languages: ["german" as const, "english" as const],
    };
    expect(await indices.createGeneration(generation, { design: old })).toBeNull();
    expect(await building(searchIndexId)).toEqual([]);

    const created = await indices.createGeneration(generation, { design: await indices.designRevision() });
    expect(created?.generationId).toBe(generation.generationId);
    expect(await indices.retireGeneration(generation.generationId, old)).toBe(false);
    expect(await building(searchIndexId)).toEqual([generation.generationId]);
  });

  it("two reconciliations of one revision create one generation", async () => {
    const searchIndexId = await indexWithoutGeneration();
    await Promise.all([reconcileSearchGenerations(O), reconcileSearchGenerations(O)]);
    expect(await building(searchIndexId)).toHaveLength(1);
    const all = await sql(`SELECT state FROM search_generation WHERE search_index_id = $1`, [searchIndexId]);
    expect(all).toEqual([{ state: "building" }]);
  });
});

describe("a design change that fails part-way", () => {
  /** A modeling store whose design changes fail on `method`. */
  function failingOn(store: ModelingStore, method: keyof ModelingStore): ModelingStore {
    const failing = (inner: ModelingStore): ModelingStore =>
      new Proxy(inner, {
        get(target, property, receiver) {
          if (property === method) {
            return async () => {
              throw new Error(`injected failure in ${String(method)}`);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    return new Proxy(store, {
      get(target, property, receiver) {
        if (property === "changeDesign") {
          return <T>(work: (s: ModelingStore) => Promise<T>) => target.changeDesign((s) => work(failing(s)));
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  it("an import leaves no partial design and no revision change; the retry then succeeds", async () => {
    const payload = await modeling.getSchemaExport(await getModelingStore(O));
    expect((await call("POST", "/api/ontologies", { key: "copy" })).status).toBe(201);
    const target = await getModelingStore("copy");
    const revisionBefore = await (await getRuntimeStore("copy")).designRevision();

    // The types are written; the lenses fail.
    await expect(modeling.importSchema(payload, failingOn(target, "createLens"))).rejects.toThrow("injected failure");
    expect(await target.listEntityTypes()).toEqual([]);
    expect(await target.listRelationTypes()).toEqual([]);
    expect(await target.listLenses()).toEqual([]);
    expect(await (await getRuntimeStore("copy")).designRevision()).toEqual(revisionBefore);

    await modeling.importSchema(payload, target);
    expect((await target.listEntityTypes()).map((et) => et.key).sort()).toEqual(["company", "person"]);
    expect((await (await getRuntimeStore("copy")).designRevision()).revision).toBe(revisionBefore.revision + 1);
  });

  it("a cascade failing at its last step keeps the lens inclusions it removed first", async () => {
    const team = await call("POST", `${MODEL}/entity-types`, { key: "team", displayName: "Team" });
    expect(team.status).toBe(201);
    expect((await call("POST", `${MODEL}/lenses/${ids.hrViewId}/includes/entity-types`, { key: "team" })).status).toBe(
      201,
    );
    const revisionBefore = await revision();

    // The inclusion goes first; the final delete fails.
    await expect(
      modeling.deleteEntityType(
        team.body.entityTypeId as string,
        true,
        failingOn(await getModelingStore(O), "deleteEntityType"),
      ),
    ).rejects.toThrow("injected failure");
    const included = await call("GET", `${MODEL}/lenses/${ids.hrViewId}/includes/entity-types`);
    expect(included.body.map((inc: Row) => inc.key).sort()).toEqual(["company", "person", "team"]);
    expect((await call("GET", `${MODEL}/entity-types/${team.body.entityTypeId as string}`)).status).toBe(200);
    expect(await revision()).toEqual(revisionBefore);
  });
});

describe("the design lock", () => {
  it("a design change waiting for a write is not overtaken by later writes", async () => {
    const reader = await holdRaw(async (querier) => {
      await querier.query(`SELECT pg_advisory_xact_lock_shared(${LOCK_KEY})`);
    });
    const change = modeling.createLens({ key: "later", name: "Later" }, await getModelingStore(O));
    expect(await settlesWithin(change, 300)).toBe(false);
    // A write arriving now queues behind the waiting change.
    const write = createPerson(ALL, { name: "Ada" });
    expect(await settlesWithin(write, 300)).toBe(false);

    reader.release();
    await reader.done;
    await change;
    expect((await write).status).toBe(201);
  });

  it("a write waiting past the lock timeout for a design change is a 409, with nothing written", async () => {
    // Warm the cache, so the wait is the write's.
    expect((await call("GET", `${ALL}/schema`)).status).toBe(200);
    const change = await holdRaw(async (querier) => {
      await querier.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    });
    try {
      const refused = await createPerson(ALL, { name: "Ada" });
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toBe("Another operation holds this data; try again");
    } finally {
      change.release();
      await change.done;
    }
    expect(await sql(`SELECT id FROM entity`)).toEqual([]);
  }, 15_000);
});
