/**
 * Custom search indices through the modeling API on PostgreSQL: CRUD,
 * the preview's full-build estimate, status until ready and rebuild;
 * managed indices only switched; relation groups end to end (pairing,
 * a target-field change fanning out, a relation deletion); the cascade
 * of every schema removal with `affectedIndices` and the definitions it
 * leaves; index deletion under the cascade protocol; and transfer 6.0
 * carrying custom definitions and switches into a fresh ontology, where
 * the worker builds them. A deterministic fake provider embeds; the
 * worker is drained explicitly. Requires the docker-compose PostgreSQL.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runQuery } from "../../../src/adapters/postgres/errors.js";
import { createApp } from "../../../src/app.js";
import { settings } from "../../../src/config.js";
import { setEmbeddingProvider } from "../../../src/core/embedding.js";
import {
  closeStores,
  getRuntimeStore,
  getSearchIndexStore,
  initStores,
} from "../../../src/core/ports.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../../../src/runtime/schemaCache.js";
import { rankThroughIndices, searchByIndices } from "../../../src/runtime/search/indexSearch.js";
import { fakeEmbeddingProvider } from "../../fakeEmbedding.js";
import { wipeDatabase } from "../reset.js";

type Row = Record<string, any>;

const O = "index_api";
const COPY = "index_api_copy";
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

/** Passages the preview expects for a document of `length` characters. */
function passagesOf(length: number): number {
  const size = settings.DOCUMENT_CHUNK_SIZE;
  if (length === 0) return 0;
  return length <= size ? 1 : 1 + Math.ceil((length - size) / (size - settings.DOCUMENT_CHUNK_OVERLAP));
}

describe.skipIf(settings.DB_BACKEND !== "postgres")("custom search indices through the API", () => {
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

  /** The definitions of the ontology's custom indices, by key. */
  async function customDefinitions(o = O): Promise<Record<string, Row>> {
    const list = (await ok("GET", `${modelOf(o)}/search-indices`)) as unknown as Row[];
    return Object.fromEntries(list.filter((i) => i.kind === "custom").map((i) => [i.key, i.definition]));
  }

  async function liveGenerationIds(key: string, o = O): Promise<string[]> {
    const store = await getSearchIndexStore(o);
    const index = (await store.getIndex(key))!;
    return (await store.listGenerations(index.searchIndexId))
      .filter((g) => g.state === "building" || g.state === "ready")
      .map((g) => g.generationId)
      .sort();
  }

  async function includeIndexInLens(lensId: string, key: string, o = O): Promise<void> {
    await post(`${modelOf(o)}/lenses/${lensId}/includes/search-indices`, { key });
  }

  /** person (name, bio) —works_for (role, since)→ company (name, founded). */
  async function schema(o = O): Promise<{ personId: string; companyId: string; worksForId: string }> {
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
    return { personId: person.entityTypeId, companyId: company.entityTypeId, worksForId: worksFor.relationTypeId };
  }

  const BIO = "Ada wrote the first program. ".repeat(120);

  /** Ada (CTO at ACME, Advisor at Foo), Bob (CTO at Foo). */
  async function people() {
    const ada = await post(`${RUNTIME}/entities/person`, { name: "Ada", bio: BIO });
    const bob = await post(`${RUNTIME}/entities/person`, { name: "Bob" });
    const acme = await post(`${RUNTIME}/entities/company`, { name: "ACME", founded: 1999 });
    const foo = await post(`${RUNTIME}/entities/company`, { name: "Foo", founded: 2010 });
    const relation = (from: Row, to: Row, role: string, since: number) =>
      post(`${RUNTIME}/relations/works_for`, { fromEntityId: from._id, toEntityId: to._id, role, since });
    const adaAcme = await relation(ada, acme, "CTO", 2020);
    await relation(ada, foo, "Advisor", 2018);
    await relation(bob, foo, "CTO", 2021);
    return { ada, bob, acme, foo, adaAcme };
  }

  async function keywordHits(query: string, matching: "any" | "all" = "all", key = EMPLOYMENT.key) {
    await drainSearchWork({ ontologyKey: O });
    const runtime = await getRuntimeStore(O);
    const index = (await (await getSearchIndexStore(O)).getIndex(key))!;
    const hits = await rankThroughIndices(await loadSchema("all", runtime), runtime.searchIndices!(), {
      targets: [{ index, conditions: [] }],
      query,
      mode: "keyword",
      matching,
      relations: null,
      minScore: null,
      limit: 10,
    });
    return hits.map((hit) => hit.entityId);
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

  // -------------------------------------------------------------------
  // CRUD, preview, status, rebuild
  // -------------------------------------------------------------------

  it("previews the full-build cost, creates, lists with managed indices and builds until ready", async () => {
    await schema();
    await people();
    const { key: _key, ...draft } = EMPLOYMENT;
    const preview = await post(`${INDICES}/preview`, draft);
    const entries = 2 + 3 + passagesOf(BIO.length);
    expect(preview).toMatchObject({ valid: true, issues: [], estimate: { entities: 2, entries } });
    expect(preview.estimate.perRepresentation.map((r: Row) => [r.representation, r.entries])).toEqual([
      ["keyword", entries],
      ["semantic", entries],
    ]);
    expect(preview.estimate.seconds).toBeGreaterThan(0);

    const created = await request("POST", INDICES, EMPLOYMENT);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      key: "person_employment",
      kind: "custom",
      enabled: true,
      documentProperty: "bio",
      definition: { ...EMPLOYMENT, header: null },
      status: { state: "building" },
    });

    // Key order is the database's collation order; compare as a set.
    const list = (await ok("GET", INDICES)) as unknown as Row[];
    expect(list.map((i) => [i.key, i.kind, i.enabled]).sort()).toEqual([
      ["company~default", "default", true],
      ["person_employment", "custom", true],
      ["person~bio", "passage", true],
      ["person~default", "default", true],
    ].sort());

    await drainSearchWork({ ontologyKey: O });
    const status = await ok("GET", `${INDICES}/person_employment/status`);
    expect(status).toEqual({
      state: "ready",
      representations: [
        { representation: "keyword", state: "ready", done: 0, total: 0, pending: 0, failed: 0 },
        { representation: "semantic", state: "ready", done: 0, total: 0, pending: 0, failed: 0 },
      ],
      lastErrors: [],
    });
    expect((await ok("GET", `${INDICES}/person_employment`)).status.state).toBe("ready");
  });

  it("invalid drafts: 422 by dotted path, managed and taken keys refused, preview never 422", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    const invalid = await request("POST", INDICES, {
      ...EMPLOYMENT,
      key: "broken",
      relations: [{ relationType: "works_for", direction: "incoming", fields: ["role"] }],
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.details.fields).toEqual({
      "relations.0.direction": "Relation type 'works_for' does not end at entity type 'person'",
    });
    // The definition is closed: an unknown key is named, not dropped.
    const unknown = await request("POST", INDICES, { ...EMPLOYMENT, key: "extra", kind: "custom" });
    expect(unknown.statusCode).toBe(422);
    expect(Object.keys(unknown.json().error.details.fields)).toEqual(["definition"]);
    const managed = await request("POST", INDICES, { ...EMPLOYMENT, key: "person~default" });
    expect(managed.statusCode).toBe(422);
    expect(Object.keys(managed.json().error.details.fields)).toEqual(["key"]);
    const taken = await request("POST", INDICES, EMPLOYMENT);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe("RESOURCE_CONFLICT");

    const preview = await request("POST", `${INDICES}/preview`, { ...EMPLOYMENT, fields: ["ghost"] });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      valid: false,
      issues: [{ path: "fields.0", message: "Property 'ghost' does not exist on entity type 'person'" }],
      estimate: null,
    });
  });

  it("an edit builds a new generation; managed indices are only switched; rebuild answers 202", async () => {
    await schema();
    await people();
    await post(INDICES, EMPLOYMENT);
    await drainSearchWork({ ontologyKey: O });
    const before = await liveGenerationIds("person_employment");

    // Name and description change no entry: same generations.
    await ok("PUT", `${INDICES}/person_employment`, { ...EMPLOYMENT, name: "Employment" });
    expect(await liveGenerationIds("person_employment")).toEqual(before);
    const edited = await ok("PUT", `${INDICES}/person_employment`, { ...EMPLOYMENT, fields: ["name"] });
    expect(edited.definition.fields).toEqual(["name"]);
    expect(edited.status.state).toBe("building");
    await drainSearchWork({ ontologyKey: O });
    const after = await liveGenerationIds("person_employment");
    expect(after).toHaveLength(2);
    expect(after.filter((id) => before.includes(id))).toEqual([]);

    const mismatch = await request("PUT", `${INDICES}/person_employment`, { ...EMPLOYMENT, key: "other" });
    expect(mismatch.statusCode).toBe(422);
    const managed = await request("PUT", `${INDICES}/person~default`, { ...EMPLOYMENT, key: "person~default" });
    expect(managed.statusCode).toBe(409);
    expect(managed.json().error.message).toContain("managed indices can only be switched");
    expect((await request("DELETE", `${INDICES}/person~default`)).statusCode).toBe(409);
    expect((await request("PUT", `${INDICES}/nope`, EMPLOYMENT)).statusCode).toBe(404);

    const rebuilt = await request("POST", `${INDICES}/person_employment/rebuild`);
    expect(rebuilt.statusCode, rebuilt.body).toBe(202);
    expect(rebuilt.json().state).toBe("building");
    await drainSearchWork({ ontologyKey: O });
    expect((await ok("GET", `${INDICES}/person_employment/status`)).state).toBe("ready");

    // A switched-off managed index: listed, disabled, not rebuildable.
    await ok("PUT", `${MODEL}/search-settings`, { disabledIndices: ["company~default"] });
    const company = await ok("GET", `${INDICES}/company~default`);
    expect(company).toMatchObject({
      enabled: false,
      status: { state: "disabled", representations: [], lastErrors: [] },
    });
    const refused = await request("POST", `${INDICES}/company~default/rebuild`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("RESOURCE_CONFLICT");
  });

  it("status reports the last errors of failed items with entity, part and time", async () => {
    await schema();
    const { ada, bob } = await people();
    const provider = fakeEmbeddingProvider();
    provider.failWith = "provider down";
    setEmbeddingProvider(provider);
    await post(INDICES, { ...EMPLOYMENT, keyword: { enabled: false } });
    // Retried without delay until the attempts are used up.
    await drainSearchWork({ ontologyKey: O, backoffMs: () => 0 });
    const status = await ok("GET", `${INDICES}/person_employment/status`);
    expect(status.state).toBe("failed");
    expect(status.representations).toEqual([
      { representation: "semantic", state: "failed", done: 0, total: 2, pending: 0, failed: 2 },
    ]);
    expect(status.lastErrors).toHaveLength(1);
    expect(status.lastErrors[0]).toMatchObject({ partKind: "entity", message: expect.stringContaining("provider down") });
    expect([ada._id, bob._id]).toContain(status.lastErrors[0].entityId);
    expect(new Date(status.lastErrors[0].at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  // -------------------------------------------------------------------
  // Relation groups end to end
  // -------------------------------------------------------------------

  it("pairs a relation with its own target; a target change fans out; a deleted relation's entries go", async () => {
    await schema();
    const { ada, bob, acme, adaAcme } = await people();
    await post(INDICES, EMPLOYMENT);
    expect(await keywordHits("CTO ACME")).toEqual([ada._id]);
    expect(await keywordHits("CTO Foo")).toEqual([bob._id]);
    expect(await keywordHits("Advisor ACME")).toEqual([]);

    const response = await searchByIndices(
      "all",
      { query: "CTO ACME", indices: ["person_employment"], mode: "keyword" },
      await getRuntimeStore(O),
    );
    expect(response.hits[0]!.entity._id).toBe(ada._id);
    expect(response.hits[0]!.matched).toMatchObject({
      index: "person_employment",
      partKind: "relation",
      relationId: adaAcme._id,
      target: { id: acme._id, type: "company", label: "ACME" },
    });

    // The target's field changes: every relation pointing to it recomposes.
    await ok("PATCH", `${RUNTIME}/entities/company/${acme._id}`, { name: "Initech" });
    expect(await keywordHits("CTO Initech")).toEqual([ada._id]);
    expect(await keywordHits("CTO ACME")).toEqual([]);

    await ok("DELETE", `${RUNTIME}/relations/works_for/${adaAcme._id}`);
    expect(await keywordHits("CTO Initech")).toEqual([]);
    expect(await keywordHits("Advisor Foo")).toEqual([ada._id]);
  });

  // -------------------------------------------------------------------
  // The cascade
  // -------------------------------------------------------------------

  it("keyword ranking puts entries holding more query words first, whatever the term density", async () => {
    await schema();
    const { ada, bob } = await people();
    // One query word, many times: a high cover density for "ACME" alone.
    const fan = await post(`${RUNTIME}/entities/person`, { name: "ACME ACME ACME ACME" });
    await post(INDICES, EMPLOYMENT);
    await drainSearchWork({ ontologyKey: O });
    const runtime = await getRuntimeStore(O);
    const store = await getSearchIndexStore(O);
    const rank = async (query: string) => {
      const targets = await Promise.all(
        ["person~default", EMPLOYMENT.key].map(async (key) => ({ index: (await store.getIndex(key))!, conditions: [] })),
      );
      const hits = await rankThroughIndices(await loadSchema("all", runtime), runtime.searchIndices!(), {
        targets, query, mode: "keyword", matching: "any", relations: null, minScore: null, limit: 10,
      });
      return hits.map((hit) => [hit.entityId, hit.matched.entry.partKind, hit.score] as const);
    };
    const acme = await rank("CTO ACME");
    expect(acme[0]!.slice(0, 2)).toEqual([ada._id, "relation"]);
    expect(acme[0]![2]).toBeGreaterThanOrEqual(2);
    expect(acme.map(([id]) => id)).toContain(fan._id);
    expect(acme.find(([id]) => id === fan._id)![2]).toBeLessThan(2);
    const foo = await rank("CTO Foo");
    expect(foo[0]!.slice(0, 2)).toEqual([bob._id, "relation"]);
  });

  it("deleting a property a custom index reads needs cascade, then removes the field everywhere", async () => {
    const { companyId, worksForId } = await schema();
    await post(INDICES, EMPLOYMENT);
    const founded = (await ok("GET", `${MODEL}/entity-types/${companyId}/properties`)) as unknown as Row[];
    const foundedId = founded.find((p) => p.key === "founded")!.propertyId;
    const url = `${MODEL}/entity-types/${companyId}/properties/${foundedId}`;

    const refused = await request("DELETE", url);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: "CASCADE_REQUIRED",
      details: { affectedLenses: [], affectedIndices: ["person_employment"] },
    });
    const generations = await liveGenerationIds("person_employment");
    expect((await request("DELETE", `${url}?cascade=true`)).statusCode).toBe(204);
    expect((await customDefinitions()).person_employment!.relations[0].target).toEqual({ company: ["name"] });
    // A changed custom definition gets new generations.
    expect((await liveGenerationIds("person_employment")).some((id) => generations.includes(id))).toBe(false);

    // A relation property: removed from the group's fields.
    const relationProps = (await ok("GET", `${MODEL}/relation-types/${worksForId}/properties`)) as unknown as Row[];
    const since = relationProps.find((p) => p.key === "since")!.propertyId;
    const sinceUrl = `${MODEL}/relation-types/${worksForId}/properties/${since}`;
    expect((await request("DELETE", sinceUrl)).json().error.details.affectedIndices).toEqual(["person_employment"]);
    await ok("DELETE", `${sinceUrl}?cascade=true`);
    expect((await customDefinitions()).person_employment!.relations[0].fields).toEqual(["role"]);
  });

  it("deleting a grouped relation type removes the group; managed indices never trigger", async () => {
    const { worksForId } = await schema();
    await post(INDICES, EMPLOYMENT);
    const refused = await request("DELETE", `${MODEL}/relation-types/${worksForId}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ affectedLenses: [], affectedIndices: ["person_employment"] });
    await ok("DELETE", `${MODEL}/relation-types/${worksForId}?cascade=true`);
    expect((await customDefinitions()).person_employment).toMatchObject({ fields: ["name", "bio"], relations: [] });

    // A document property read only by managed indices deletes silently.
    await ok("DELETE", `${INDICES}/person_employment`);
    const personId = ((await ok("GET", `${MODEL}/entity-types`)) as unknown as Row[]).find((t) => t.key === "person")!
      .entityTypeId;
    const bio = ((await ok("GET", `${MODEL}/entity-types/${personId}/properties`)) as unknown as Row[]).find((p) => p.key === "bio")!;
    expect((await request("DELETE", `${MODEL}/entity-types/${personId}/properties/${bio.propertyId}`)).statusCode).toBe(204);
  });

  it("deleting the root type deletes its indices and their lens inclusions; an index left empty goes", async () => {
    await schema();
    const note = await post(`${MODEL}/entity-types`, { key: "note", displayName: "Note" });
    const notes = { key: "notes", name: "Notes", description: "Notes by name", entityType: "note", fields: ["name"] };
    await post(INDICES, notes);
    const lens = await post(`${MODEL}/lenses`, { key: "desk", name: "Desk" });
    await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "note" });
    await includeIndexInLens(lens.lensId, "notes");

    const refused = await request("DELETE", `${MODEL}/entity-types/${note.entityTypeId}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details).toEqual({ affectedLenses: ["desk"], affectedIndices: ["notes"] });
    await ok("DELETE", `${MODEL}/entity-types/${note.entityTypeId}?cascade=true`);
    expect(Object.keys(await customDefinitions())).toEqual([]);
    expect((await request("GET", `${INDICES}/notes`)).statusCode).toBe(404);

    // An index whose only field goes is deleted by the cascade.
    const companyId = ((await ok("GET", `${MODEL}/entity-types`)) as unknown as Row[]).find((t) => t.key === "company")!
      .entityTypeId;
    await post(INDICES, { key: "years", name: "Years", description: "Companies by year", entityType: "company", fields: ["founded"] });
    const founded = ((await ok("GET", `${MODEL}/entity-types/${companyId}/properties`)) as unknown as Row[]).find((p) => p.key === "founded")!;
    await ok("DELETE", `${MODEL}/entity-types/${companyId}/properties/${founded.propertyId}?cascade=true`);
    expect((await request("GET", `${INDICES}/years`)).statusCode).toBe(404);
  });

  it("deleting an index a lens includes needs cascade; the inclusion goes with it", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    const lens = await post(`${MODEL}/lenses`, { key: "hr", name: "HR" });
    await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "person" });
    await includeIndexInLens(lens.lensId, "person_employment");
    const refused = await request("DELETE", `${INDICES}/person_employment`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: "CASCADE_REQUIRED",
      details: { affectedLenses: ["hr"], affectedIndices: [] },
    });
    expect((await request("DELETE", `${INDICES}/person_employment?cascade=true`)).statusCode).toBe(204);
    const left = await runQuery(
      `SELECT count(*)::int AS n FROM ont_${O}.lens_includes WHERE search_index_id IS NOT NULL AND lens_id = $1`,
      [lens.lensId],
    );
    expect(left.rows[0]!["n"]).toBe(0);
  });

  // -------------------------------------------------------------------
  // Transfer 6.0
  // -------------------------------------------------------------------

  it("transfer 6.0 carries custom definitions and switches; the copy builds through the worker", async () => {
    await schema();
    await people();
    await post(INDICES, EMPLOYMENT);
    await ok("PUT", `${MODEL}/search-settings`, { disabledIndices: ["person~bio"] });
    const exported = await ok("GET", `${MODEL}/export`);
    expect(exported.searchIndices).toEqual({
      custom: [{ ...EMPLOYMENT, header: null, relations: [{ ...EMPLOYMENT.relations[0], template: null }], semantic: { enabled: true, template: null }, keyword: { enabled: true } }],
      disabled: ["person~bio"],
    });

    await post("/api/ontologies", { key: COPY });
    await post(`${modelOf(COPY)}/import`, exported);
    const copied = (await ok("GET", `${modelOf(COPY)}/search-indices`)) as unknown as Row[];
    expect(copied.map((i) => [i.key, i.enabled]).sort()).toEqual([
      ["company~default", true],
      ["person_employment", true],
      ["person~bio", false],
      ["person~default", true],
    ].sort());
    expect((await customDefinitions(COPY)).person_employment).toEqual(exported.searchIndices.custom[0]);
    expect((await ok("GET", `${modelOf(COPY)}/search-settings`)).disabledIndices).toEqual(["person~bio"]);

    // Instance data arrives later; the worker builds the imported index.
    const copyRuntime = `/api/ontologies/${COPY}/runtime/lenses/all`;
    const grace = await post(`${copyRuntime}/entities/person`, { name: "Grace" });
    const navy = await post(`${copyRuntime}/entities/company`, { name: "Navy" });
    await post(`${copyRuntime}/relations/works_for`, { fromEntityId: grace._id, toEntityId: navy._id, role: "Admiral" });
    await drainSearchWork({ ontologyKey: COPY });
    expect((await ok("GET", `${modelOf(COPY)}/search-indices/person_employment/status`)).state).toBe("ready");
    const found = await searchByIndices(
      "all",
      { query: "Admiral Navy", indices: ["person_employment"], mode: "keyword" },
      await getRuntimeStore(COPY),
    );
    expect(found.hits.map((h) => h.entity._id)).toEqual([grace._id]);
  });

  it("import validates every custom definition against the imported schema, all or nothing", async () => {
    await schema();
    await post(INDICES, EMPLOYMENT);
    const exported = await ok("GET", `${MODEL}/export`);
    await post("/api/ontologies", { key: COPY });

    const broken = {
      ...exported,
      searchIndices: { custom: [{ ...EMPLOYMENT, fields: ["ghost"] }], disabled: ["person~nope"] },
    };
    const refused = await request("POST", `${modelOf(COPY)}/import`, broken);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details.errors).toEqual([
      "Import error: search index 'person_employment' is invalid at fields.0: " +
        "Property 'ghost' does not exist on entity type 'person'",
      "Import error: switched-off search index 'person~nope' is not a managed index of the payload",
    ]);
    expect((await ok("GET", `${modelOf(COPY)}/entity-types`)) as unknown as Row[]).toEqual([]);

    // A 5.0 payload has no indices of its own: the managed ones derive.
    const legacy = {
      ...exported,
      formatVersion: "5.0",
      textSearchLanguage: "english",
      keywordLanguages: undefined,
    };
    await post(`${modelOf(COPY)}/import`, legacy);
    const copied = (await ok("GET", `${modelOf(COPY)}/search-indices`)) as unknown as Row[];
    expect(copied.map((i) => i.kind)).not.toContain("custom");
    expect(copied.length).toBeGreaterThan(0);
  });
});
