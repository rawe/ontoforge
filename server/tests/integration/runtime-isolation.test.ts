/**
 * Runtime isolation between ontologies: the same type key, lens key, and
 * saved-query key exist independently in two ontologies, and every
 * runtime operation — entity/relation/document CRUD, OQL, saved queries
 * — sees only the ontology its path names. Also pins the surface itself:
 * the runtime and AI routes answer under
 * `/api/ontologies/:key/runtime/lenses/:lensKey`, an unknown ontology
 * answers 404 before any lens logic, the old `/api/runtime` tree is
 * gone, and the feature report lives at `/api/server/features`.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createOntology, modelPrefix, runtimePrefix } from "./fixture.js";
import { wipeDatabase } from "./reset.js";

let app: FastifyInstance;

type Row = Record<string, unknown>;

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

async function post(url: string, payload: Row): Promise<Row> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
  return res.json() as Row;
}

async function getJson(url: string): Promise<Row> {
  const res = await app.inject({ method: "GET", url });
  expect(res.statusCode, `GET ${url}: ${res.body}`).toBe(200);
  return res.json() as Row;
}

/**
 * Two ontologies, deliberately near-identical: both hold an entity type
 * `person`, a relation type `knows`, and an unscoped lens `default` —
 * every addressable name collides, so only the ontology segment of the
 * path can tell them apart. They differ in one schema detail (`crm`'s
 * person has an extra `title` property) so schema reads are attributable.
 */
async function buildTwinOntologies(): Promise<void> {
  for (const ontologyKey of ["crm", "hr"]) {
    await createOntology(app, ontologyKey);
    const model = modelPrefix(ontologyKey);
    const person = await post(`${model}/entity-types`, {
      key: "person",
      displayName: "Person",
    });
    const personId = person.entityTypeId as string;
    await post(`${model}/entity-types/${personId}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });
    await post(`${model}/entity-types/${personId}/properties`, {
      key: "bio",
      displayName: "Bio",
      dataType: "document",
      required: false,
    });
    if (ontologyKey === "crm") {
      await post(`${model}/entity-types/${personId}/properties`, {
        key: "title",
        displayName: "Title",
        dataType: "string",
        required: false,
      });
    }
    await post(`${model}/relation-types`, {
      key: "knows",
      displayName: "Knows",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "person",
    });
    await post(`${model}/lenses`, { key: "default", name: `Default (${ontologyKey})` });
  }
}

const crm = runtimePrefix("crm", "default");
const hr = runtimePrefix("hr", "default");

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  await buildTwinOntologies();
});

describe("the same names in two ontologies stay disjoint", () => {
  it("schema reads through the same lens key serve each ontology's own schema", async () => {
    const crmSchema = await getJson(`${crm}/schema`);
    const hrSchema = await getJson(`${hr}/schema`);

    const crmPerson = (crmSchema.entityTypes as Row[]).find((et) => et.key === "person")!;
    const hrPerson = (hrSchema.entityTypes as Row[]).find((et) => et.key === "person")!;
    expect((crmPerson.properties as Row[]).map((p) => p.key).sort()).toEqual([
      "bio",
      "name",
      "title",
    ]);
    expect((hrPerson.properties as Row[]).map((p) => p.key).sort()).toEqual(["bio", "name"]);
  });

  it("entity CRUD sees only the addressed ontology", async () => {
    const alice = await post(`${crm}/entities/person`, { name: "Alice" });
    const bob = await post(`${hr}/entities/person`, { name: "Bob" });

    const crmList = await getJson(`${crm}/entities/person`);
    expect((crmList.items as Row[]).map((e) => e.name)).toEqual(["Alice"]);
    const hrList = await getJson(`${hr}/entities/person`);
    expect((hrList.items as Row[]).map((e) => e.name)).toEqual(["Bob"]);

    // Reads across the boundary answer not-found.
    const crossRead = await app.inject({
      method: "GET",
      url: `${hr}/entities/person/${alice._id as string}`,
    });
    expect(crossRead.statusCode).toBe(404);
    const crossDelete = await app.inject({
      method: "DELETE",
      url: `${crm}/entities/person/${bob._id as string}`,
    });
    expect(crossDelete.statusCode).toBe(404);
    // Both survived the cross-boundary delete attempts.
    expect(((await getJson(`${crm}/entities/person`)).items as Row[])).toHaveLength(1);
    expect(((await getJson(`${hr}/entities/person`)).items as Row[])).toHaveLength(1);
  });

  it("relation CRUD sees only the addressed ontology", async () => {
    const a1 = await post(`${crm}/entities/person`, { name: "Alice" });
    const a2 = await post(`${crm}/entities/person`, { name: "Ann" });
    await post(`${crm}/relations/knows`, {
      fromEntityId: a1._id as string,
      toEntityId: a2._id as string,
    });

    const crmRelations = await getJson(`${crm}/relations/knows`);
    expect(crmRelations.total).toBe(1);
    const hrRelations = await getJson(`${hr}/relations/knows`);
    expect(hrRelations.total).toBe(0);

    // The other ontology's entities are not valid endpoints here.
    const cross = await app.inject({
      method: "POST",
      url: `${hr}/relations/knows`,
      payload: { fromEntityId: a1._id, toEntityId: a2._id },
    });
    expect(cross.statusCode).toBe(422);
  });

  it("document reads see only the addressed ontology", async () => {
    const alice = await post(`${crm}/entities/person`, {
      name: "Alice",
      bio: "Grew up around graph databases.",
    });

    const own = await getJson(
      `${crm}/entities/person/${alice._id as string}/documents/bio`,
    );
    expect(own.content).toBe("Grew up around graph databases.");

    const cross = await app.inject({
      method: "GET",
      url: `${hr}/entities/person/${alice._id as string}/documents/bio`,
    });
    expect(cross.statusCode).toBe(404);
  });

  it("OQL queries only the addressed ontology", async () => {
    await post(`${crm}/entities/person`, { name: "Alice" });
    await post(`${hr}/entities/person`, { name: "Bob" });

    const query = { query: "MATCH (p:person) RETURN p.name AS name" };
    const crmRes = await app.inject({ method: "POST", url: `${crm}/query`, payload: query });
    expect(crmRes.statusCode).toBe(200);
    expect((crmRes.json().results as Row[]).map((r) => r.name)).toEqual(["Alice"]);
    const hrRes = await app.inject({ method: "POST", url: `${hr}/query`, payload: query });
    expect(hrRes.statusCode).toBe(200);
    expect((hrRes.json().results as Row[]).map((r) => r.name)).toEqual(["Bob"]);
  });

  it("the same saved-query key runs independently per ontology", async () => {
    await post(`${crm}/entities/person`, { name: "Alice" });
    await post(`${hr}/entities/person`, { name: "Bob" });

    // Same key `everyone` in both ontologies' `default` lenses, with
    // deliberately different projections.
    const upsert = async (ontologyKey: string, column: string) => {
      const res = await app.inject({
        method: "PUT",
        url: `${modelPrefix(ontologyKey)}/lenses/default/saved-queries/everyone`,
        payload: {
          name: "Everyone",
          description: "All persons",
          steps: [
            {
              name: "main",
              type: "oql",
              oql: `MATCH (p:person) RETURN p.name AS ${column}`,
            },
          ],
          parameters: [],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    };
    // No manual cache invalidation: the modeling upsert itself must
    // invalidate the runtime cache, as every modeling mutation does.
    await upsert("crm", "crm_name");
    await upsert("hr", "hr_name");

    const crmRun = await app.inject({
      method: "POST",
      url: `${crm}/saved-queries/everyone/run`,
      payload: { params: {} },
    });
    expect(crmRun.statusCode).toBe(200);
    expect((crmRun.json().results as Row[]).map((r) => r.crm_name)).toEqual(["Alice"]);

    const hrRun = await app.inject({
      method: "POST",
      url: `${hr}/saved-queries/everyone/run`,
      payload: { params: {} },
    });
    expect(hrRun.statusCode).toBe(200);
    expect((hrRun.json().results as Row[]).map((r) => r.hr_name)).toEqual(["Bob"]);
  });

  it("a modeling mutation invalidates the runtime schema cache per today's rule", async () => {
    // Prime both ontologies' cache entries for the shared lens key.
    await getJson(`${crm}/schema`);
    await getJson(`${hr}/schema`);

    // Mutate hr's schema through the modeling surface.
    const hrPerson = (await getJson(`${modelPrefix("hr")}/entity-types`)) as unknown as Row[];
    const personId = hrPerson.find((et) => et.key === "person")!.entityTypeId as string;
    await post(`${modelPrefix("hr")}/entity-types/${personId}/properties`, {
      key: "badge",
      displayName: "Badge",
      dataType: "string",
      required: false,
    });

    const refreshed = await getJson(`${hr}/schema`);
    const person = (refreshed.entityTypes as Row[]).find((et) => et.key === "person")!;
    expect((person.properties as Row[]).map((p) => p.key)).toContain("badge");
  });
});

describe("the runtime surface itself", () => {
  it("AI routes answer under the new prefix (FEATURE_DISABLED without a provider)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${crm}/ai/query`,
      payload: { question: "How many people?" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.code).toBe("FEATURE_DISABLED");

    const agents = await getJson(`${crm}/ai/agents`);
    expect((agents as unknown as Row[])[0]!.key).toBe("_default");
  });

  it("the A2A agent card advertises the ontology-scoped task URL", async () => {
    const card = await getJson(`${crm}/ai/.well-known/agent.json`);
    expect(card.url as string).toContain(
      "/api/ontologies/crm/runtime/lenses/default/ai/a2a",
    );
  });

  it("an unknown ontology answers 404 on every runtime shape", async () => {
    for (const url of [
      `${runtimePrefix("ghost", "default")}/schema`,
      `${runtimePrefix("ghost", "default")}/entities/person`,
      `${runtimePrefix("ghost", "default")}/saved-queries`,
      `${runtimePrefix("ghost", "default")}/ai/agents`,
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    }
  });

  it("the old /api/runtime tree no longer exists", async () => {
    for (const url of [
      "/api/runtime/features",
      "/api/runtime/default/schema",
      "/api/runtime/default/entities/person",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it("the feature report answers at /api/server/features", async () => {
    const res = await app.inject({ method: "GET", url: "/api/server/features" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ semanticSearch: false, ai: false });
  });
});
