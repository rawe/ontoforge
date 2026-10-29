/**
 * The HTTP contract of the passage search (`POST search/passages`), run
 * with and without local embeddings: the scope rules and their errors,
 * managed passage indices by default and custom ones only when named,
 * documents the lens hides, two indices over one document collapsing,
 * `perEntity`, filters on the owning entity, `ran` and every limitation,
 * and the item with its text. Search answers from search indices, whose
 * entries the worker builds asynchronously: a search first drains the
 * queued work, unless it asks for what is not built yet.
 *
 * person (status, bio, notes) —works_for (role)→ company (city, no
 * document). Ada's bio is three passages, each naming the engine; Bob's
 * one. The custom index `person_notes` reads the name, the status, the
 * notes and the employments.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { settings } from "../../src/config.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { drainSearchWork } from "../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { chunkDocument } from "../../src/runtime/search/chunking.js";
import { disableProvider, enableOllamaProvider } from "./embedding/support.js";
import { wipeDatabase } from "./reset.js";

type Row = Record<string, any>;

const O = "passage_search";
const MODEL = `/api/ontologies/${O}/model`;
const runtimeOf = (lens: string) => `/api/ontologies/${O}/runtime/lenses/${lens}`;
const RUNTIME = runtimeOf("all");

/** About 1,000 characters led by `lead`: three make three passages at
 * the default chunk size, each holding one lead. */
const paragraph = (lead: string) => `${lead} ${"Filler words pad the paragraph out. ".repeat(27)}`.trim();
const ADA_BIO = [
  "The analytical engine was designed by Babbage.",
  "Ada wrote the first program for the engine.",
  "The engine was never completed in her lifetime.",
]
  .map(paragraph)
  .join("\n\n");
const BOB_BIO = "Bob grows tomatoes in his garden and repairs an old engine.";

const NOTES = {
  key: "person_notes",
  name: "People by notes",
  description: "People with their notes and roles at companies.",
  entityType: "person",
  fields: ["name", "status", "notes"],
  relations: [
    { relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name"] } },
  ],
};

export function passageSearchContract(embedding: boolean, enabled = true) {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};

  async function post(url: string, payload: object): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBeLessThan(300);
    return res.json();
  }

  /** The search, after the worker built what is queued (`built`). */
  async function search(body: object, lens = "all", built = true) {
    if (built) await drainSearchWork({ ontologyKey: O });
    return app.inject({ method: "POST", url: `${runtimeOf(lens)}/search/passages`, payload: body });
  }

  async function found(body: object, lens = "all", built = true): Promise<Row> {
    const res = await search(body, lens, built);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  async function fields(body: object, lens = "all"): Promise<Record<string, string>> {
    const res = await search(body, lens);
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    return res.json().error.details.fields;
  }

  /** Each item as entity, document and ordinal. */
  const passagesOf = (body: Row) =>
    body.items.map((item: Row) => [item.entity._id, item.passage.property, item.passage.ordinal]);

  async function switchOff(...keys: string[]): Promise<void> {
    const res = await app.inject({ method: "PUT", url: `${MODEL}/search-settings`, payload: { disabledIndices: keys } });
    expect(res.statusCode, res.body).toBe(200);
  }

  /** A lens showing person by name and bio — not notes — with `indices` included. */
  async function bioLens(indices: string[]): Promise<void> {
    const lens = await post(`${MODEL}/lenses`, { key: "bios", name: "Bios" });
    await post(`${MODEL}/lenses/${lens.lensId}/includes/entity-types`, { key: "person", properties: ["name", "bio"] });
    for (const key of indices) await post(`${MODEL}/lenses/${lens.lensId}/includes/search-indices`, { key });
    invalidateLoadedSchemaCache();
  }

  describe.skipIf(!enabled)(`passage search contract (${embedding ? "Ollama" : "no provider"})`, () => {
    beforeAll(async () => {
      await initStores();
      if (embedding) enableOllamaProvider();
      app = await createApp();
      await app.ready();
    });
    afterAll(async () => {
      if (embedding) disableProvider();
      await wipeDatabase();
      await app.close();
      await closeStores();
    });
    beforeEach(async () => {
      await wipeDatabase();
      invalidateLoadedSchemaCache();
      await post("/api/ontologies", { key: O });
      await post(`${MODEL}/lenses`, { key: "all", name: "All" });
      const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
      for (const [key, dataType] of [["status", "string"], ["bio", "document"], ["notes", "document"]] as const) {
        await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, { key, displayName: key, dataType });
      }
      const company = await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company" });
      await post(`${MODEL}/entity-types/${company.entityTypeId}/properties`, {
        key: "city",
        displayName: "City",
        dataType: "string",
      });
      const worksFor = await post(`${MODEL}/relation-types`, {
        key: "works_for",
        displayName: "Works for",
        sourceEntityTypeKey: "person",
        targetEntityTypeKey: "company",
      });
      await post(`${MODEL}/relation-types/${worksFor.relationTypeId}/properties`, {
        key: "role",
        displayName: "Role",
        dataType: "string",
      });
      ids.ada = (
        await post(`${RUNTIME}/entities/person`, {
          name: "Ada",
          status: "active",
          bio: ADA_BIO,
          notes: "Ada keeps a diary about looms.",
        })
      )._id;
      ids.bob = (
        await post(`${RUNTIME}/entities/person`, {
          name: "Bob",
          status: "retired",
          bio: BOB_BIO,
          notes: "Bob collects stamps.",
        })
      )._id;
      ids.acme = (await post(`${RUNTIME}/entities/company`, { name: "ACME", city: "Berlin" }))._id;
      ids.foo = (await post(`${RUNTIME}/entities/company`, { name: "Foo", city: "Hamburg" }))._id;
      for (const [person, company] of [["ada", "acme"], ["bob", "foo"]] as const) {
        await post(`${RUNTIME}/relations/works_for`, { fromEntityId: ids[person], toEntityId: ids[company], role: "CTO" });
      }
      await post(`${MODEL}/search-indices`, NOTES);
    });

    it("the blocks sent choose the methods; neither runs both where semantic can", async () => {
      const keyword = await found({ query: "tomatoes", keyword: {} });
      expect(keyword).toMatchObject({ ran: ["keyword"], limitations: [] });
      expect(passagesOf(keyword)).toEqual([[ids.bob, "bio", 0]]);

      const neither = await found({ query: "tomatoes" });
      expect(passagesOf(neither)).toContainEqual([ids.bob, "bio", 0]);
      expect(neither.limitations).toEqual([]);
      if (embedding) {
        expect(neither.ran).toEqual(["semantic", "keyword"]);
        expect((await found({ query: "tomatoes", semantic: {} })).ran).toEqual(["semantic"]);
        const floored = await found({ query: "tomatoes", semantic: { minSimilarity: 1 }, keyword: {} });
        expect(floored.ran).toEqual(["semantic", "keyword"]);
        expect(passagesOf(floored)).toEqual([[ids.bob, "bio", 0]]);
      } else {
        expect(neither.ran).toEqual(["keyword"]);
        const refused = await search({ query: "tomatoes", semantic: {} });
        expect(refused.statusCode).toBe(422);
        expect(refused.json().error.details.code).toBe("FEATURE_DISABLED");
      }
    });

    it("managed passage indices by default; a custom one only when named; its self and relation entries do not count", async () => {
      // Every document of every type, through its managed passage index.
      expect(passagesOf(await found({ query: "stamps", keyword: {} }))).toEqual([[ids.bob, "notes", 0]]);
      expect(passagesOf(await found({ query: "stamps", types: ["person"], keyword: {} }))).toEqual([
        [ids.bob, "notes", 0],
      ]);
      expect(passagesOf(await found({ query: "stamps", documents: ["person.bio"], keyword: {} }))).toEqual([]);
      expect(passagesOf(await found({ query: "stamps", documents: ["person.notes"], keyword: {} }))).toEqual([
        [ids.bob, "notes", 0],
      ]);

      // With the managed notes index switched off, only the custom one, named, reads the notes.
      await switchOff("person~notes");
      expect((await found({ query: "stamps", keyword: {} })).items).toEqual([]);
      const named = await found({ query: "stamps", indices: [NOTES.key], keyword: {} });
      expect(passagesOf(named)).toEqual([[ids.bob, "notes", 0]]);
      // "retired" is in Bob's self entry, "CTO" in the employments: neither is a passage.
      expect((await found({ query: "retired", indices: [NOTES.key], keyword: {} })).items).toEqual([]);
      expect((await found({ query: "CTO", indices: [NOTES.key], keyword: {} })).items).toEqual([]);
    });

    it("two indices over one document find one passage, once", async () => {
      const both = await found({ query: "stamps", indices: ["person~notes", NOTES.key], keyword: {} });
      expect(passagesOf(both)).toEqual([[ids.bob, "notes", 0]]);
      if (embedding) {
        const hybrid = await found({ query: "stamps", indices: ["person~notes", NOTES.key] });
        const keys = passagesOf(hybrid).map((passage: unknown[]) => JSON.stringify(passage));
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toHaveLength(2);
      }
    });

    it("a scope the lens cannot serve is an error at its path; a type or document without an index a limitation", async () => {
      expect(await fields({ query: "x", types: ["ghost", "person"] })).toEqual({
        "types.0": "Entity type 'ghost' not found",
      });
      expect(
        await fields({ query: "x", documents: ["person.bio", "ghost.bio", "person.ghost", "person.status", "person"] }),
      ).toEqual({
        "documents.1": "Entity type 'ghost' not found",
        "documents.2": "Property 'ghost' not found on entity type 'person'",
        "documents.3": "Property 'status' of entity type 'person' is not a document",
        "documents.4": "Expected entityType.property",
      });
      expect(await fields({ query: "x", indices: ["person~bio", "person~default", "ghost"] })).toEqual({
        "indices.1": "Search index 'person~default' reads no document this lens shows",
        "indices.2": "Search index 'ghost' is not available in this lens",
      });
      expect(await fields({ query: "x", types: ["person"], documents: ["person.bio"] })).toEqual({
        documents: "Name one of types, documents or indices",
      });
      expect(await fields({ query: "x", types: ["person"], indices: ["person~bio"] })).toEqual({
        indices: "Name one of types, documents or indices",
      });
      expect(
        Object.keys(await fields({ query: "x", types: ["person"], documents: ["person.bio"], indices: ["person~bio"] })),
      ).toEqual(["documents", "indices"]);
      expect(await fields({ query: "x", types: [] })).toEqual({ types: "Name at least one entity type, or omit types" });
      expect(await fields({ query: "x", documents: [] })).toEqual({
        documents: "Name at least one document, or omit documents",
      });
      expect(await fields({ query: "x", indices: [] })).toEqual({ indices: "Name at least one index, or omit indices" });

      // company reads no document: visible, without a passage index.
      const company = await found({ query: "ACME", types: ["company"], keyword: {} });
      expect(company).toEqual({
        ran: [],
        items: [],
        limitations: [
          {
            code: "not-searchable",
            message: "These entity types have no passage index this lens can search",
            types: ["company"],
          },
        ],
      });
      // A document whose managed index is switched off — even with a custom index over it.
      await switchOff("person~notes");
      const partly = await found({ query: "stamps tomatoes", documents: ["person.notes", "person.bio"], keyword: {} });
      expect(passagesOf(partly)).toEqual([[ids.bob, "bio", 0]]);
      expect(partly.limitations).toEqual([
        {
          code: "not-searchable",
          message: "These documents have no passage index this lens can search",
          documents: ["person.notes"],
        },
      ]);
      expect(await fields({ query: "x", indices: ["person~notes"] })).toEqual({
        "indices.0": "Search index 'person~notes' is not available in this lens",
      });
    });

    it("excludes documents the lens hides", async () => {
      await bioLens(["person~bio", "person~notes", NOTES.key]);
      expect(passagesOf(await found({ query: "tomatoes stamps", keyword: {} }, "bios"))).toEqual([[ids.bob, "bio", 0]]);
      expect(await fields({ query: "x", documents: ["person.notes"] }, "bios")).toEqual({
        "documents.0": "Property 'notes' not found on entity type 'person'",
      });
      // The entity search may still search these indices; the passage search may not.
      expect(await fields({ query: "x", indices: ["person~notes", NOTES.key] }, "bios")).toEqual({
        "indices.0": "Search index 'person~notes' reads no document this lens shows",
        "indices.1": "Search index 'person_notes' reads no document this lens shows",
      });
    });

    it("perEntity keeps at most that many passages per entity, in rank order; omitted, no cap", async () => {
      const all = await found({ query: "engine", types: ["person"], keyword: {} });
      expect(new Set(passagesOf(all).map((passage: unknown[]) => JSON.stringify(passage)))).toEqual(
        new Set(
          [
            [ids.ada, "bio", 0],
            [ids.ada, "bio", 1],
            [ids.ada, "bio", 2],
            [ids.bob, "bio", 0],
          ].map((passage) => JSON.stringify(passage)),
        ),
      );
      expect(all.items.map((item: Row) => item.rank)).toEqual([1, 2, 3, 4]);

      const one = await found({ query: "engine", types: ["person"], keyword: {}, perEntity: 1 });
      expect(passagesOf(one)).toEqual(
        all.items
          .filter((item: Row, i: number) => all.items.findIndex((other: Row) => other.entity._id === item.entity._id) === i)
          .map((item: Row) => [item.entity._id, item.passage.property, item.passage.ordinal]),
      );
      expect(one.items.map((item: Row) => item.rank)).toEqual([1, 2]);
      const two = await found({ query: "engine", types: ["person"], keyword: {}, perEntity: 2 });
      expect(two.items.filter((item: Row) => item.entity._id === ids.ada)).toHaveLength(2);
      expect(two.items).toHaveLength(3);
      const limited = await found({ query: "engine", types: ["person"], keyword: {}, limit: 2 });
      expect(passagesOf(limited)).toEqual(passagesOf(all).slice(0, 2));

      expect(await fields({ query: "engine", limit: 2, perEntity: 3 })).toEqual({
        perEntity: "Expected integer from 1 to limit",
      });
      expect(Object.keys(await fields({ query: "engine", perEntity: 0 }))).toEqual(["perEntity"]);
      expect(Object.keys(await fields({ query: "engine", perEntity: 1.5 }))).toEqual(["perEntity"]);
    });

    it("filters are hard facts on the entity that owns the document", async () => {
      const retired = await found({ query: "engine", keyword: {}, filter: { status: "retired" } });
      expect(passagesOf(retired)).toEqual([[ids.bob, "bio", 0]]);
      expect(retired.limitations).toEqual([]);
      // No scope: person and company. works_for:out leaves person only.
      const atAcme = await found({ query: "engine", keyword: {}, filter: { "works_for:out.name": "ACME" } });
      expect(atAcme.limitations).toEqual([]);
      expect(new Set(atAcme.items.map((item: Row) => item.entity._id))).toEqual(new Set([ids.ada]));
      // No searched type declares city: company reads no document.
      const nobody = await found({ query: "engine", keyword: {}, filter: { city: "Berlin" } });
      expect(nobody).toEqual({
        ran: [],
        items: [],
        limitations: [
          {
            code: "filter-excludes-all-types",
            message: "No searched entity type declares every filter key",
            types: ["person"],
          },
        ],
      });
      expect(Object.keys(await fields({ query: "x", documents: ["person.bio"], filter: { city: "Berlin" } }))).toEqual([
        "filter.city",
      ]);
      // The path drops company, city drops person.
      expect(await found({ query: "engine", keyword: {}, filter: { "works_for:out.name": "ACME", city: "Berlin" } })).toEqual(
        nobody,
      );
      expect(Object.keys(await fields({ query: "x", filter: { "works_for:out.ghost": "1" } }))).toEqual([
        "filter.works_for:out.ghost",
      ]);
    });

    it("collects every broken rule at the request's own path; the body is strict", async () => {
      expect(
        await fields({
          query: " ",
          keyword: { match: "most" },
          semantic: { minSimilarity: 1.5 },
          limit: 101,
          perEntity: 0,
          filter: { ghost: "1" },
        }),
      ).toEqual({
        query: "Required non-empty query",
        limit: "Expected integer from 1 to 100",
        perEntity: "Expected integer from 1 to limit",
        "keyword.match": "Expected any or all",
        "semantic.minSimilarity": "Expected number from 0 to 1",
        "filter.ghost": "Unknown filter property or relation type: 'ghost'",
      });
      for (const body of [
        { query: "x", mode: "keyword" },
        { query: "x", text: "yes" },
        { query: "x", documents: "person.bio" },
        { query: "x", keyword: { match: "any", fuzzy: true } },
        { types: ["person"] },
      ]) {
        const res = await search(body);
        expect(res.statusCode, JSON.stringify(body)).toBe(422);
        expect(res.json().error.details.errors.length).toBeGreaterThan(0);
      }
    });

    it("an item names the entity and the passage, with its text from the current document", async () => {
      const bob = await found({ query: "tomatoes", documents: ["person.bio"], keyword: {} });
      expect(bob.items).toEqual([
        {
          rank: 1,
          entity: { _id: ids.bob, _entityTypeKey: "person", name: "Bob" },
          passage: { property: "bio", ordinal: 0, charOffset: 0, charLength: BOB_BIO.length, text: BOB_BIO },
        },
      ]);
      const bare = await found({ query: "tomatoes", documents: ["person.bio"], keyword: {}, text: false });
      expect(bare.items).toEqual([
        {
          rank: 1,
          entity: { _id: ids.bob, _entityTypeKey: "person", name: "Bob" },
          passage: { property: "bio", ordinal: 0, charOffset: 0, charLength: BOB_BIO.length },
        },
      ]);
      expect("text" in bare.items[0].passage).toBe(false);

      // Each of Ada's passages is its chunk of the document — no header in front.
      const chunks = chunkDocument(ADA_BIO, settings.DOCUMENT_CHUNK_SIZE, settings.DOCUMENT_CHUNK_OVERLAP);
      expect(chunks).toHaveLength(3);
      const ada = await found({ query: "engine", documents: ["person.bio"], keyword: {}, filter: { status: "active" } });
      expect(ada.items).toHaveLength(3);
      for (const { passage } of ada.items) {
        const chunk = chunks[passage.ordinal]!;
        expect(passage).toEqual({
          property: "bio",
          ordinal: passage.ordinal,
          charOffset: chunk.startChar,
          charLength: chunk.charLength,
          text: chunk.text,
        });
      }

      // The text is read when the search answers, from the document as it is then.
      const changed = "Bob sold his garden and the engine.";
      const res = await app.inject({ method: "PATCH", url: `${RUNTIME}/entities/person/${ids.bob}`, payload: { bio: changed } });
      expect(res.statusCode, res.body).toBe(200);
      const stale = await found({ query: "tomatoes", documents: ["person.bio"], keyword: {} }, "all", false);
      expect(stale.items[0].passage).toEqual({
        property: "bio",
        ordinal: 0,
        charOffset: 0,
        charLength: BOB_BIO.length,
        text: changed,
      });
    });

    it("a method that cannot run on an index is a limitation: switched off, not built yet", async () => {
      await post(`${MODEL}/search-indices`, {
        ...NOTES,
        key: "notes_meaning",
        name: "Notes by meaning",
        keyword: { enabled: false },
      });
      const off = await found({ query: "stamps", indices: ["notes_meaning", NOTES.key], keyword: {} });
      expect(off.ran).toEqual(["keyword"]);
      expect(passagesOf(off)).toEqual([[ids.bob, "notes", 0]]);
      expect(off.limitations).toEqual([
        {
          code: "switched-off",
          message: "Keyword search is switched off on these indices",
          method: "keyword",
          indices: ["notes_meaning"],
        },
      ]);
      expect(await found({ query: "stamps", indices: ["notes_meaning"], keyword: {} })).toMatchObject({
        ran: [],
        items: [],
      });

      await post(`${MODEL}/search-indices`, { ...NOTES, key: "notes_new", name: "New notes" });
      const pending = await found({ query: "stamps", indices: ["notes_new", NOTES.key] }, "all", false);
      expect(pending.ran).toEqual(embedding ? ["semantic", "keyword"] : ["keyword"]);
      expect(passagesOf(pending)).toContainEqual([ids.bob, "notes", 0]);
      const notReady = (method: string) => ({
        code: "not-ready",
        message: `${method === "semantic" ? "Semantic" : "Keyword"} search entries of these indices are not built yet`,
        method,
        indices: ["notes_new"],
      });
      expect(pending.limitations).toEqual(embedding ? [notReady("semantic"), notReady("keyword")] : [notReady("keyword")]);
    });

    it.skipIf(!embedding)("hybrid over every document fuses both methods into one ranking of passages", async () => {
      const body = await found({ query: "who programmed the analytical engine", perEntity: 2 });
      expect(body.ran).toEqual(["semantic", "keyword"]);
      expect(body.limitations).toEqual([]);
      expect(body.items.map((item: Row) => item.rank)).toEqual(body.items.map((_: Row, i: number) => i + 1));
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(["entity", "passage", "rank"]);
        expect(Object.keys(item.passage).sort()).toEqual(["charLength", "charOffset", "ordinal", "property", "text"]);
        expect(["bio", "notes"]).toContain(item.passage.property);
      }
      for (const id of [ids.ada, ids.bob]) {
        expect(body.items.filter((item: Row) => item.entity._id === id).length).toBeLessThanOrEqual(2);
      }
    });
  });
}
