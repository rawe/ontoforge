/**
 * Lens index inclusions on PostgreSQL through the real routes: CRUD and
 * the root-type rule, search availability following every change at
 * once (the schema cache is invalidated), relation entries of hidden
 * types skipped at query time without a rebuild or a warning, validation
 * warnings (hidden properties, a root type the lens no longer includes —
 * the inclusion is kept), the cascade of index and property
 * deletion through inclusions, and transfer: 6.0 carries each lens's
 * list exactly, 5.0 (and a 6.0 lens without one) gets the managed indices
 * of the types it exposes. A deterministic fake provider embeds; the
 * worker is drained explicitly. Requires the docker-compose PostgreSQL.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { setEmbeddingProvider } from "../../../src/core/embedding.js";
import { ValidationError } from "../../../src/core/exceptions.js";
import { closeStores, getRuntimeStore, getSearchIndexStore, initStores } from "../../../src/core/ports.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { searchByIndices } from "../../../src/runtime/search/indexSearch.js";
import { fakeEmbeddingProvider } from "../../fakeEmbedding.js";
import { wipeDatabase } from "../reset.js";

type Row = Record<string, any>;

const O = "lens_indices";
const COPY = "lens_indices_copy";
const modelOf = (o: string) => `/api/ontologies/${o}/model`;
const MODEL = modelOf(O);
const INDICES = `${MODEL}/search-indices`;
const RUNTIME = `/api/ontologies/${O}/runtime/lenses/all`;

const EMPLOYMENT = {
  key: "person_employment",
  name: "People by employment",
  description: "People with their roles at companies and since when.",
  entityType: "person",
  fields: ["name", "bio"],
  relations: [
    {
      relationType: "works_for",
      direction: "outgoing",
      fields: ["role", "since"],
      target: { company: ["name", "founded"] },
      label: "Employment",
    },
  ],
};

describe.skipIf(settings.DB_BACKEND !== "postgres")("lens index inclusions", () => {
  let app: FastifyInstance;

  type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

  async function request(method: Method, url: string, payload?: object) {
    return app.inject({ method, url, ...(payload ? { payload } : {}) });
  }
  async function ok(method: Method, url: string, payload?: object): Promise<Row> {
    const res = await request(method, url, payload);
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return res.statusCode === 204 ? {} : res.json();
  }
  const post = (url: string, payload: object) => ok("POST", url, payload);

  const typeId = async (key: string, o = O): Promise<string> =>
    ((await ok("GET", `${modelOf(o)}/entity-types`)) as unknown as Row[]).find((t) => t.key === key)!.entityTypeId;

  /** person (name, bio) —works_for (role, since)→ company (name, founded). */
  async function schema(o = O): Promise<void> {
    const model = modelOf(o);
    await post("/api/ontologies", { key: o });
    await post(`${model}/lenses`, { key: "all", name: "All" });
    const person = await post(`${model}/entity-types`, { key: "person", displayName: "Person" });
    await post(`${model}/entity-types/${person.entityTypeId}/properties`, {
      key: "bio",
      displayName: "Bio",
      dataType: "document",
    });
    const company = await post(`${model}/entity-types`, { key: "company", displayName: "Company" });
    await post(`${model}/entity-types/${company.entityTypeId}/properties`, {
      key: "founded",
      displayName: "Founded",
      dataType: "integer",
    });
    const worksFor = await post(`${model}/relation-types`, {
      key: "works_for",
      displayName: "Works for",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "company",
    });
    for (const [key, dataType] of [["role", "string"], ["since", "integer"]]) {
      await post(`${model}/relation-types/${worksFor.relationTypeId}/properties`, {
        key,
        displayName: key[0]!.toUpperCase() + key.slice(1),
        dataType,
      });
    }
  }

  /** Ada (CTO at ACME), Bob (Advisor at Foo). */
  async function people(): Promise<{ ada: Row; bob: Row }> {
    const ada = await post(`${RUNTIME}/entities/person`, { name: "Ada", bio: "Ada wrote the first program." });
    const bob = await post(`${RUNTIME}/entities/person`, { name: "Bob" });
    const acme = await post(`${RUNTIME}/entities/company`, { name: "ACME", founded: 1999 });
    const foo = await post(`${RUNTIME}/entities/company`, { name: "Foo", founded: 2010 });
    await post(`${RUNTIME}/relations/works_for`, { fromEntityId: ada._id, toEntityId: acme._id, role: "CTO", since: 2020 });
    await post(`${RUNTIME}/relations/works_for`, { fromEntityId: bob._id, toEntityId: foo._id, role: "Advisor", since: 2018 });
    return { ada, bob };
  }

  /** A lens with entity type inclusions (by key, optional allowlists). */
  async function lens(key: string, types: (string | { key: string; properties: string[] })[], o = O): Promise<string> {
    const created = await post(`${modelOf(o)}/lenses`, { key, name: key });
    for (const type of types) {
      await post(`${modelOf(o)}/lenses/${created.lensId}/includes/entity-types`, typeof type === "string" ? { key: type } : type);
    }
    return created.lensId as string;
  }

  const inclusionsUrl = (lensId: string, o = O) => `${modelOf(o)}/lenses/${lensId}/includes/search-indices`;
  // Key order is the database's collation order; compare as sets.
  async function inclusions(lensId: string, o = O): Promise<string[]> {
    return ((await ok("GET", inclusionsUrl(lensId, o))) as unknown as Row[]).map((row) => row.key).sort();
  }
  const listsOf = (lenses: Row[]) => Object.fromEntries(lenses.map((l) => [l.key, [...l.indexInclusions].sort()]));

  /** Keyword hits of the employment index in a lens, by entity id — or the
   * error status when the index is not searchable there. */
  async function search(lensKey: string, query: string): Promise<string[] | number> {
    try {
      const response = await searchByIndices(
        lensKey,
        { query, indices: [EMPLOYMENT.key], mode: "keyword" },
        await getRuntimeStore(O),
      );
      return response.hits.map((hit) => hit.entity._id as string);
    } catch (error) {
      if (error instanceof ValidationError) return 422;
      throw error;
    }
  }

  async function liveGenerationIds(key: string): Promise<string[]> {
    const store = await getSearchIndexStore(O);
    const index = (await store.getIndex(key))!;
    return (await store.listGenerations(index.searchIndexId))
      .filter((g) => g.state === "ready" || g.state === "building")
      .map((g) => g.generationId)
      .sort();
  }

  beforeAll(async () => {
    await initStores();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    setEmbeddingProvider(null);
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    setEmbeddingProvider(fakeEmbeddingProvider());
  });

  it("includes, lists and removes indices; the root-type rule, conflicts and unknown keys", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    const companies = await lens("companies", ["company"]);
    // Creating the lens and its type inclusion included nothing on its own.
    expect(await inclusions(companies)).toEqual([]);

    const refused = await request("POST", inclusionsUrl(companies), { key: EMPLOYMENT.key });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Root entity type 'person' of search index 'person_employment' is not included in this lens",
    });

    const hr = await lens("hr", ["person"]);
    const created = await request("POST", inclusionsUrl(hr), { key: EMPLOYMENT.key });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toEqual({ key: EMPLOYMENT.key });
    await post(inclusionsUrl(hr), { key: "person~default" });
    expect(await inclusions(hr)).toEqual(["person_employment", "person~default"]);

    expect((await request("POST", inclusionsUrl(hr), { key: EMPLOYMENT.key })).statusCode).toBe(409);
    expect((await request("POST", inclusionsUrl(hr), { key: "nope" })).statusCode).toBe(404);
    const noLens = inclusionsUrl("00000000-0000-0000-0000-000000000000");
    expect((await request("GET", noLens)).statusCode).toBe(404);

    expect((await request("DELETE", `${inclusionsUrl(hr)}/person~default`)).statusCode).toBe(204);
    expect(await inclusions(hr)).toEqual(["person_employment"]);
    expect((await request("DELETE", `${inclusionsUrl(hr)}/person~default`)).statusCode).toBe(404);

    // An unscoped lens keeps an inclusion; it never makes the lens scoped.
    const all = ((await ok("GET", `${MODEL}/lenses`)) as unknown as Row[]).find((l) => l.key === "all")!;
    await post(inclusionsUrl(all.lensId), { key: "company~default" });
    expect((await ok("GET", `${RUNTIME}/schema`)).entityTypes.map((t: Row) => t.key).sort()).toEqual(["company", "person"]);
  });

  it("search availability follows every inclusion change at once", async () => {
    await schema();
    const { ada } = await people();
    await post(INDICES, EMPLOYMENT);
    await drainSearchWork({ ontologyKey: O });
    const hr = await lens("hr", ["person", "company"]);

    // Load (and cache) the lens before any change.
    expect(await search("hr", "CTO ACME")).toBe(422);
    await post(inclusionsUrl(hr), { key: EMPLOYMENT.key });
    expect(await search("hr", "CTO ACME")).toEqual([ada._id]);
    await ok("DELETE", `${inclusionsUrl(hr)}/${EMPLOYMENT.key}`);
    expect(await search("hr", "CTO ACME")).toBe(422);
  });

  it("skips relation entries of a type the lens hides, without a rebuild", async () => {
    await schema();
    const { ada, bob } = await people();
    await post(INDICES, EMPLOYMENT);
    await drainSearchWork({ ontologyKey: O });
    const generations = await liveGenerationIds(EMPLOYMENT.key);

    // Without company the inferred lens hides works_for: only self entries.
    const people_ = await lens("people", ["person"]);
    await post(inclusionsUrl(people_), { key: EMPLOYMENT.key });
    expect(await search("all", "CTO ACME")).toEqual([ada._id]);
    expect(await search("people", "CTO ACME")).toEqual([]);
    expect(await search("people", "Advisor")).toEqual([]);
    expect(await search("people", "Bob")).toEqual([bob._id]);

    // Including company shows the relation entries again.
    await post(`${MODEL}/lenses/${people_}/includes/entity-types`, { key: "company" });
    expect(await search("people", "CTO ACME")).toEqual([ada._id]);
    expect(await liveGenerationIds(EMPLOYMENT.key)).toEqual(generations);
  });

  it("validation warns about hidden properties, not skipped groups; a removed root type keeps the inclusion", async () => {
    await schema();
    await people();
    await post(INDICES, EMPLOYMENT);
    const hr = await lens("hr", [{ key: "person", properties: ["name"] }]);
    await post(inclusionsUrl(hr), { key: EMPLOYMENT.key });
    await post(inclusionsUrl(hr), { key: "person~default" });

    const validated = await post(`${MODEL}/lenses/${hr}/validate`, {});
    expect(validated).toEqual({
      valid: true,
      errors: [],
      warnings: [
        // works_for is hidden (no company): its entries are skipped, no warning.
        {
          path: "lenses.hr.includes.searchIndices.person_employment.fields.1",
          message: "Search index 'person_employment' reads property 'bio' of entity type 'person', which this lens hides",
        },
      ],
    });

    // Removing the root type's inclusion keeps the index inclusions; they
    // are reported and no longer searchable.
    await post(`${MODEL}/lenses/${hr}/includes/entity-types`, { key: "company" });
    await ok("DELETE", `${MODEL}/lenses/${hr}/includes/entity-types/${await typeId("person")}`);
    expect(await inclusions(hr)).toEqual(["person_employment", "person~default"]);
    expect(await search("hr", "CTO")).toBe(422);
    const removed = await post(`${MODEL}/lenses/${hr}/validate`, {});
    expect(removed.valid).toBe(true);
    expect(removed.warnings.map((w: Row) => w.path).sort()).toEqual([
      "lenses.hr.includes.searchIndices.person_employment.entityType",
      "lenses.hr.includes.searchIndices.person~default.entityType",
    ]);
    const all = await post(`${MODEL}/schema/validate`, {});
    expect(all.warnings).toEqual(removed.warnings);
  });

  it("index and property deletion cascade through inclusions; affectedLenses names them", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    // Reads only the role: deleting it leaves the index empty — deleted.
    await post(INDICES, {
      key: "roles",
      name: "Roles",
      description: "People by role",
      entityType: "person",
      fields: [],
      relations: [{ relationType: "works_for", direction: "outgoing", fields: ["role"] }],
    });
    const staff = await lens("staff", ["person"]);
    await post(inclusionsUrl(staff), { key: "roles" });
    const hr = await lens("hr", ["person"]);
    await post(inclusionsUrl(hr), { key: EMPLOYMENT.key });

    const worksFor = ((await ok("GET", `${MODEL}/relation-types`)) as unknown as Row[])[0]!;
    const role = ((await ok("GET", `${MODEL}/relation-types/${worksFor.relationTypeId}/properties`)) as unknown as Row[]).find(
      (p) => p.key === "role",
    )!;
    const url = `${MODEL}/relation-types/${worksFor.relationTypeId}/properties/${role.propertyId}`;
    const refused = await request("DELETE", url);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({
      affectedLenses: ["staff"],
      affectedIndices: ["person_employment", "roles"],
    });
    await ok("DELETE", `${url}?cascade=true`);
    expect((await request("GET", `${INDICES}/roles`)).statusCode).toBe(404);
    expect(await inclusions(staff)).toEqual([]);
    expect(await inclusions(hr)).toEqual([EMPLOYMENT.key]);

    // Deleting an included index needs cascade; the inclusion goes with it.
    const index = await request("DELETE", `${INDICES}/${EMPLOYMENT.key}`);
    expect(index.statusCode).toBe(409);
    expect(index.json().error.details).toEqual({ affectedLenses: ["hr"], affectedIndices: [] });
    await ok("DELETE", `${INDICES}/${EMPLOYMENT.key}?cascade=true`);
    expect(await inclusions(hr)).toEqual([]);
  });

  it("transfer 6.0 carries each lens's index inclusions exactly", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    const hr = await lens("hr", ["person", "company"]);
    for (const key of [EMPLOYMENT.key, "person~default"]) await post(inclusionsUrl(hr), { key });
    // Kept after its root type's inclusion went: travels as it is.
    const desk = await lens("desk", ["person"]);
    await post(inclusionsUrl(desk), { key: "person~bio" });
    await post(`${MODEL}/lenses/${desk}/includes/entity-types`, { key: "company" });
    await ok("DELETE", `${MODEL}/lenses/${desk}/includes/entity-types/${await typeId("person")}`);

    const exported = await ok("GET", `${MODEL}/export`);
    const listed = listsOf(exported.lenses);
    expect(listed).toEqual({ all: [], desk: ["person~bio"], hr: ["person_employment", "person~default"] });

    await post("/api/ontologies", { key: COPY });
    await post(`${modelOf(COPY)}/import`, exported);
    const copied = (await ok("GET", `${modelOf(COPY)}/export`)).lenses;
    expect(listsOf(copied)).toEqual(listed);

    const refused = await request("POST", `${modelOf(COPY)}/import`, {
      ...exported,
      searchIndices: { custom: [], disabled: [] },
      entityTypes: exported.entityTypes.map((t: Row) => ({ ...t, key: `${t.key}2` })),
      relationTypes: [],
      lenses: [{ key: "other", name: "Other", indexInclusions: ["person_employment"] }],
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details.errors).toContain(
      "Import error: lens 'other' includes unknown search index 'person_employment'",
    );
  });

  it("5.0 import, and a 6.0 lens without a list, include the managed indices of the exposed types", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    const hr = await lens("hr", ["person"]);
    await post(inclusionsUrl(hr), { key: EMPLOYMENT.key });
    const exported = await ok("GET", `${MODEL}/export`);
    const withoutLists = exported.lenses.map(({ indexInclusions: _, ...rest }: Row) => rest);
    const managedOfPerson = ["person~bio", "person~default"];

    await post("/api/ontologies", { key: COPY });
    await post(`${modelOf(COPY)}/import`, { ...exported, lenses: withoutLists });
    const lensesOf = async (o: string) => listsOf((await ok("GET", `${modelOf(o)}/export`)).lenses);
    expect(await lensesOf(COPY)).toEqual({ all: [], hr: managedOfPerson });

    const legacy = "lens_indices_legacy";
    await post("/api/ontologies", { key: legacy });
    const { keywordLanguages: _languages, searchIndices: _indices, ...rest } = exported;
    await post(`${modelOf(legacy)}/import`, {
      ...rest,
      formatVersion: "5.0",
      textSearchLanguage: "english",
      entityTypes: exported.entityTypes.map(({ nameProperty: _name, ...type }: Row) => type),
      lenses: withoutLists,
    });
    expect(await lensesOf(legacy)).toEqual({ all: [], hr: managedOfPerson });
  });
});
