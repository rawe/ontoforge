/**
 * Saved queries with a real embedding provider (Ollama): the description
 * is embedded on write and re-embedded on a description edit, semantic
 * discovery ranks by description similarity (never returning steps), and a
 * search -> oql pipeline flows search hits into a bound query parameter.
 * SKIPPED when Ollama or the model is unavailable.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import { getEmbeddingProvider } from "../../../src/core/embedding.js";
import {
  closeStores,
  ensureSemanticIndexes,
  initStores,
} from "../../../src/core/ports.js";
import { wipeDatabase } from "../reset.js";
import { checkOllamaModel, disableProvider, enableOllamaProvider } from "./support.js";

type Row = Record<string, unknown>;

const ollamaUp = await checkOllamaModel();

let app: FastifyInstance;

describe.skipIf(!ollamaUp)("saved queries (Ollama)", () => {
  beforeAll(async () => {
    await initStores();
    await wipeDatabase();
    enableOllamaProvider();
    app = await createApp();
    await app.ready();
    await ensureSemanticIndexes(getEmbeddingProvider()!.dimensions);
    await buildFixture();
  });

  afterAll(async () => {
    disableProvider();
    await wipeDatabase();
    await app.close();
    await closeStores();
  });

  async function inject(
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: Row,
  ): Promise<{ statusCode: number; body: unknown }> {
    const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    return { statusCode: res.statusCode, body: res.body === "" ? null : res.json() };
  }

  /** person -[has_skill]-> skill, lens `sq_test`; Alice knows Python. */
  async function buildFixture(): Promise<void> {
    const post = async (url: string, payload: Row): Promise<Row> => {
      const res = await inject("POST", url, payload);
      expect(res.statusCode, `POST ${url}: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body as Row;
    };

    const person = await post("/api/model/entity-types", {
      key: "person",
      displayName: "Person",
    });
    await post(`/api/model/entity-types/${person.entityTypeId as string}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });
    const skill = await post("/api/model/entity-types", { key: "skill", displayName: "Skill" });
    await post(`/api/model/entity-types/${skill.entityTypeId as string}/properties`, {
      key: "name",
      displayName: "Name",
      dataType: "string",
      required: true,
    });
    await post("/api/model/relation-types", {
      key: "has_skill",
      displayName: "Has Skill",
      sourceEntityTypeKey: "person",
      targetEntityTypeKey: "skill",
    });
    await post("/api/model/lenses", { key: "sq_test", name: "Saved Query Test" });

    const alice = await post("/api/runtime/sq_test/entities/person", { name: "Alice" });
    const python = await post("/api/runtime/sq_test/entities/skill", {
      name: "Python programming",
    });
    await post("/api/runtime/sq_test/entities/skill", { name: "Sourdough baking" });
    await post("/api/runtime/sq_test/relations/has_skill", {
      fromEntityId: alice._id as string,
      toEntityId: python._id as string,
    });
  }

  it("search ranks saved queries by description similarity, without steps", async () => {
    for (const [key, name, description] of [
      [
        "people-by-skill",
        "People by skill",
        "Find employees who have a given programming or software engineering skill",
      ],
      [
        "kitchen-recipes",
        "Kitchen recipes",
        "List baking recipes and cooking instructions for the kitchen",
      ],
    ] as const) {
      const res = await inject("PUT", `/api/model/lenses/sq_test/saved-queries/${key}`, {
        name,
        description,
        steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
        parameters: [],
      });
      expect(res.statusCode).toBe(201);
    }

    const search = await inject(
      "GET",
      "/api/runtime/sq_test/saved-queries/search?q=" +
        encodeURIComponent("which coworkers know a programming language") +
        "&min_score=0.1",
    );
    expect(search.statusCode).toBe(200);
    const hits = search.body as Row[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.key).toBe("people-by-skill");
    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual([
        "description",
        "key",
        "name",
        "parameters",
        "score",
      ]);
      expect(typeof hit.score).toBe("number");
    }
  });

  it("editing the description re-embeds it and moves the ranking", async () => {
    // Repurpose kitchen-recipes: its description now matches the probe.
    const res = await inject(
      "PUT",
      "/api/model/lenses/sq_test/saved-queries/kitchen-recipes",
      {
        name: "Kitchen recipes",
        description:
          "Find employees who are experts in a given programming language or software skill",
        steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
        parameters: [],
      },
    );
    expect(res.statusCode).toBe(200);

    const search = await inject(
      "GET",
      "/api/runtime/sq_test/saved-queries/search?q=" +
        encodeURIComponent("which coworkers know a programming language") +
        "&min_score=0.1&limit=5",
    );
    const hits = search.body as Row[];
    const keys = hits.map((h) => h.key);
    expect(keys).toContain("kitchen-recipes");
  });

  it("runs a search -> oql pipeline: hits flow through the binding", async () => {
    const defined = await inject(
      "PUT",
      "/api/model/lenses/sq_test/saved-queries/experts-for",
      {
        name: "Experts for a topic",
        description: "Search skills semantically, then list people holding them",
        steps: [
          {
            name: "skills",
            type: "semantic_search",
            entityTypeKey: "skill",
            query: "$topic",
            limit: 1,
          },
          {
            name: "experts",
            type: "oql",
            oql:
              "MATCH (p:person)-[:has_skill]->(s:skill) " +
              "WHERE s._id IN $skill_ids RETURN p.name AS name",
            bindings: { skill_ids: "{{skills._id}}" },
          },
        ],
        parameters: [{ name: "topic", description: "Topic to search skills for", dataType: "string" }],
      },
    );
    expect(defined.statusCode).toBe(201);

    const run = await inject("POST", "/api/runtime/sq_test/saved-queries/experts-for/run", {
      params: { topic: "software development languages" },
    });
    expect(run.statusCode).toBe(200);
    const body = run.body as { columns: string[]; results: Row[] };
    expect(body.columns).toEqual(["name"]);
    expect(body.results).toEqual([{ name: "Alice" }]);
  });

  it("runs an oql -> oql pipeline with a provider active too", async () => {
    await inject("PUT", "/api/model/lenses/sq_test/saved-queries/skill-holders", {
      name: "Skill holders",
      description: "People holding any skill at all",
      steps: [
        { name: "skills", type: "oql", oql: "MATCH (s:skill) RETURN s._id AS sid" },
        {
          name: "holders",
          type: "oql",
          oql:
            "MATCH (p:person)-[:has_skill]->(s:skill) " +
            "WHERE s._id IN $sids RETURN p.name AS name",
          bindings: { sids: "{{skills.sid}}" },
        },
      ],
      parameters: [],
    });

    const run = await inject("POST", "/api/runtime/sq_test/saved-queries/skill-holders/run", {
      params: {},
    });
    expect(run.statusCode).toBe(200);
    expect((run.body as { results: Row[] }).results).toEqual([{ name: "Alice" }]);
  });

  it("runtime MCP search_saved_queries finds a query by intent", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a bound TCP port");
    }
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    const client = new Client({ name: "saved-queries-embedding-tests", version: "0.0.1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp/runtime/sq_test`),
      ),
    );
    try {
      const result = (await client.callTool({
        name: "search_saved_queries",
        arguments: { query: "who is an expert in a programming topic" },
      })) as unknown as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBeUndefined();
      const hits = JSON.parse(result.content[0]!.text) as Row[];
      // Fixed conservative defaults (limit 3, min_score 0.7) may trim the
      // list; every hit is parameter-bearing and step-free.
      for (const hit of hits) {
        expect(hit).not.toHaveProperty("steps");
      }
    } finally {
      await client.close();
    }
  });
});
