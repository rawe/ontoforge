/**
 * Semantic search isolation between ontologies, against the
 * docker-compose database and a local Ollama: the same type key and lens
 * key exist in two ontologies, and every retrieval path — per-type
 * search, cross-type search (`semanticSearchAll`), and saved-query
 * discovery — sees only the ontology the path names, even when the other
 * ontology holds the semantically better match. Two ontologies at
 * once — multi-ontology tier (`tiers.ts`). SKIPPED when Ollama or the
 * model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { modelPrefix, runtimePrefix } from "../fixture.js";
import { wipeDatabase } from "../reset.js";
import { supportsMultipleOntologies } from "../tiers.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

const crm = runtimePrefix("crm", "default");
const hr = runtimePrefix("hr", "default");

describe.skipIf(!ollamaUp || !supportsMultipleOntologies)("semantic search isolation between ontologies (Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  async function post(url: string, payload: Row): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(201);
    return res.json() as Row;
  }

  async function search(prefix: string, query: string): Promise<Row[]> {
    const res = await app.inject({
      method: "GET",
      url: `${prefix}/search/semantic?q=${encodeURIComponent(query)}&searchIn=entities`,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { results: Row[] }).results;
  }

  /** Both ontologies: entity type `person` (name/bio) and an unscoped
   * lens `default` — same keys everywhere; only the path differs. */
  async function buildTwinOntologies(): Promise<void> {
    for (const ontologyKey of ["crm", "hr"]) {
      await post("/api/ontologies", { key: ontologyKey });
      const model = modelPrefix(ontologyKey);
      const et = await post(`${model}/entity-types`, { key: "person", displayName: "Person" });
      const etId = et.entityTypeId as string;
      for (const prop of [
        { key: "name", displayName: "Name", dataType: "string", required: true },
        { key: "bio", displayName: "Bio", dataType: "string", required: false },
      ]) {
        await post(`${model}/entity-types/${etId}/properties`, prop);
      }
      await post(`${model}/lenses`, { key: "default", name: `Default (${ontologyKey})` });
    }
  }

  beforeEach(async () => {
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    await buildTwinOntologies();
    // The best match for "distributed systems" lives in hr; crm holds
    // only an unrelated person. A leak across the boundary would rank
    // hr's Dana first in a crm search.
    await post(`${crm}/entities/person`, {
      name: "Carl Baker",
      bio: "Runs the office plant-watering rota",
    });
    await post(`${hr}/entities/person`, {
      name: "Dana Fischer",
      bio: "Expert in distributed systems and consensus protocols",
    });
  });

  it("cross-type search (semanticSearchAll) sees only the addressed ontology", async () => {
    const crmHits = await search(crm, "distributed systems expert");
    expect(crmHits.map((r) => (r.entity as Row).name)).not.toContain("Dana Fischer");

    const hrHits = await search(hr, "distributed systems expert");
    expect(hrHits.map((r) => (r.entity as Row).name)).toEqual(["Dana Fischer"]);
  });

  it("per-type search sees only the addressed ontology", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${crm}/search/semantic?q=${encodeURIComponent("distributed systems expert")}&type=person&searchIn=entities`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const names = ((res.json() as { results: Row[] }).results).map(
      (r) => (r.entity as Row).name,
    );
    expect(names).not.toContain("Dana Fischer");
  });

  it("saved-query discovery sees only the addressed ontology's lens", async () => {
    const upsert = async (ontologyKey: string, description: string) => {
      const res = await app.inject({
        method: "PUT",
        url: `${modelPrefix(ontologyKey)}/lenses/default/saved-queries/the_query`,
        payload: {
          name: "The query",
          description,
          steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
          parameters: [],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    };
    await upsert("crm", "Lists everyone on the plant-watering rota");
    await upsert("hr", "Finds experts in orbital mechanics and spaceflight");

    const res = await app.inject({
      method: "GET",
      url: `${crm}/saved-queries/search?q=${encodeURIComponent("orbital mechanics spaceflight")}&min_score=0`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const hits = res.json() as Row[];
    // Only crm's own saved query is reachable — hr's better match never
    // appears, whatever the score floor.
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.description).toBe("Lists everyone on the plant-watering rota");
    }
  });
});
