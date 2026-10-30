/**
 * Search through named indices with real embeddings (bge-m3): the MCP
 * tool `search` with `indices` over a custom index with a relation group
 * created through the modeling API — "CTO ACME" finds the CTO of ACME
 * through that very employment, "CTO Foo" the CTO of Foo through his —
 * both methods under the tools' fixed floor, a German query finding an
 * English passage, and the catalog `GET search-indices` offering both
 * modes. PostgreSQL only; SKIPPED when Ollama or the model is unavailable.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { closeStores, initStores } from "../../../src/core/ports.js";
import { createRuntimeMcpServer } from "../../../src/mcp/runtime.js";
import { drainSearchWork } from "../../../src/runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache } from "../../../src/runtime/schemaCache.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, any>;

const ollamaUp = await checkOllamaModel();
const O = "runtime_search_emb";
const MODEL = `/api/ontologies/${O}/model`;
const RUNTIME = `/api/ontologies/${O}/runtime/lenses/all`;

describe.skipIf(!ollamaUp)("search through named indices (Ollama)", () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};

  async function post(url: string, payload: object): Promise<Row> {
    const res = await app.inject({ method: "POST", url, payload });
    expect(res.statusCode, `POST ${url}: ${res.body}`).toBeLessThan(300);
    return res.json();
  }

  /** `search`'s answer; the call must succeed. */
  async function search(args: object): Promise<Row> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createRuntimeMcpServer(O, "all").connect(serverTransport);
    const client = new Client({ name: "runtime-search-api-embedding", version: "0.0.1" });
    await client.connect(clientTransport);
    try {
      const result = (await client.callTool({ name: "search", arguments: { ...args } })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      expect(result.isError, result.content[0]!.text).toBeFalsy();
      return JSON.parse(result.content[0]!.text);
    } finally {
      await client.close();
    }
  }

  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    invalidateLoadedSchemaCache();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();

    await post("/api/ontologies", { key: O });
    await post(`${MODEL}/lenses`, { key: "all", name: "All" });
    const person = await post(`${MODEL}/entity-types`, { key: "person", displayName: "Person" });
    await post(`${MODEL}/entity-types/${person.entityTypeId}/properties`, {
      key: "bio",
      displayName: "Biography",
      dataType: "document",
    });
    await post(`${MODEL}/entity-types`, { key: "company", displayName: "Company" });
    const worksFor = await post(`${MODEL}/relation-types`, {
      key: "works_for",
      displayName: "Works for",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "company",
    });
    for (const [key, dataType] of [["role", "string"], ["since", "integer"]] as const) {
      await post(`${MODEL}/relation-types/${worksFor.relationTypeId}/properties`, {
        key,
        displayName: key[0]!.toUpperCase() + key.slice(1),
        dataType,
      });
    }
    await post(`${MODEL}/search-indices`, {
      key: "person_employment",
      name: "People by employment",
      description: "People with their roles at companies and since when.",
      entityType: "person",
      fields: ["name"],
      relations: [
        {
          relationType: "works_for",
          direction: "outgoing",
          fields: ["role", "since"],
          target: { company: ["name"] },
          label: "Employment",
        },
      ],
    });

    for (const [name, bio] of [
      ["Ada Lovelace", "Ada designs analytical engines and writes programs computing Bernoulli numbers."],
      ["Bob Miller", "Bob grows tomatoes in his garden and keeps honey bees."],
    ]) {
      ids[name!] = (await post(`${RUNTIME}/entities/person`, { name, bio }))._id;
    }
    for (const name of ["ACME", "Foo"]) ids[name] = (await post(`${RUNTIME}/entities/company`, { name }))._id;
    for (const [person, company, role, since] of [
      ["Ada Lovelace", "ACME", "CTO", 2020],
      ["Ada Lovelace", "Foo", "Advisor", 2018],
      ["Bob Miller", "Foo", "CTO", 2021],
    ] as const) {
      const relation = await post(`${RUNTIME}/relations/works_for`, {
        fromEntityId: ids[person],
        toEntityId: ids[company],
        role,
        since,
      });
      ids[`${person}@${company}`] = relation._id;
    }
    await drainSearchWork({ ontologyKey: O });
  }, 300_000);

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  it("both methods under the fixed floor: each employment pairs with its own company", async () => {
    const acme = await search({ query: "CTO ACME", indices: ["person_employment"] });
    expect(acme.ran).toEqual(["semantic", "keyword"]);
    expect(acme.items[0]).toMatchObject({
      entity: { _id: ids["Ada Lovelace"] },
      match: {
        part: "relation",
        relationType: "works_for",
        target: { _id: ids["ACME"], _entityTypeKey: "company", name: "ACME" },
      },
    });
    const foo = await search({ query: "CTO Foo", indices: ["person_employment"] });
    expect(foo.items[0]).toMatchObject({
      entity: { _id: ids["Bob Miller"] },
      match: { target: { _id: ids["Foo"] } },
    });
  });

  it("both methods cross languages: a German query finds the English passage", async () => {
    const body = await search({ query: "Bienenzucht im Garten", indices: ["person~bio"] });
    expect(body.items[0]).toMatchObject({
      entity: { _id: ids["Bob Miller"] },
      match: { index: "person~bio", part: "passage", property: "bio", charOffset: 0 },
    });
  });

  it("the catalog offers both modes with a provider", async () => {
    const res = await app.inject({ url: `${RUNTIME}/search-indices` });
    expect(res.statusCode).toBe(200);
    const catalog = res.json() as Row[];
    expect(catalog.find((index) => index.key === "person_employment")).toMatchObject({
      modes: ["semantic", "keyword"],
      relations: [{ relationType: "works_for", direction: "outgoing", label: "Employment" }],
      status: "ready",
    });
    expect(catalog.find((index) => index.key === "person~bio")).toMatchObject({
      kind: "passage",
      documentProperty: "bio",
      fields: ["bio"],
    });
  });
});
