/**
 * Saved queries and agent configurations against the real docker-compose
 * Neo4j, WITHOUT an embedding provider: definition, listing and running of
 * oql-only pipelines work; saved-query search answers FEATURE_DISABLED; a
 * pipeline containing a semantic_search step fails at run time; deleting
 * the lens cascades to both configuration kinds; and the runtime listing
 * (served from the schema cache) reflects every modeling upsert. Includes
 * all six modeling MCP tools and the three runtime MCP tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { buildFixture } from "./fixture.js";

type Row = Record<string, unknown>;

let app: FastifyInstance;
let baseUrl: string;

let aliceId: string;
let acmeId: string;

async function inject(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Row,
): Promise<{ statusCode: number; body: unknown }> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  let body: unknown = null;
  if (res.body !== "") {
    body = res.json();
  }
  return { statusCode: res.statusCode, body };
}

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function connectClient(url: string): Promise<Client> {
  const c = new Client({ name: "saved-queries-agents-tests", version: "0.0.1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
}

async function call(
  c: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  return (await c.callTool({ name, arguments: args })) as unknown as ToolCallResult;
}

function text(result: ToolCallResult): string {
  return result.content[0]?.text ?? "";
}

function json(result: ToolCallResult): Row {
  return JSON.parse(text(result)) as Row;
}

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  await buildFixture(app);

  const alice = await inject("POST", "/api/runtime/test_ontology/entities/person", {
    name: "Alice",
    age: 30,
  });
  aliceId = (alice.body as Row)._id as string;
  await inject("POST", "/api/runtime/test_ontology/entities/person", {
    name: "Bob",
    age: 40,
  });
  const acme = await inject("POST", "/api/runtime/test_ontology/entities/company", {
    name: "Acme",
  });
  acmeId = (acme.body as Row)._id as string;
  await inject("POST", "/api/runtime/test_ontology/relations/works_for", {
    fromEntityId: aliceId,
    toEntityId: acmeId,
  });
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

describe("agent configurations (modeling REST)", () => {
  it("upserts by key: 201 on create, 200 on replace, full wire shape", async () => {
    const created = await inject(
      "PUT",
      "/api/model/ontologies/test_ontology/ai-agents/hr-assistant",
      {
        name: "HR Assistant",
        description: "Answers HR questions",
        systemPrompt: "You are an HR assistant.",
        tools: ["get_schema", "execute_query"],
      },
    );
    expect(created.statusCode).toBe(201);
    const agent = created.body as Row;
    expect(agent.key).toBe("hr-assistant");
    expect(agent.name).toBe("HR Assistant");
    expect(agent.systemPrompt).toBe("You are an HR assistant.");
    expect(agent.tools).toEqual(["get_schema", "execute_query"]);

    const replaced = await inject(
      "PUT",
      "/api/model/ontologies/test_ontology/ai-agents/hr-assistant",
      { name: "HR Assistant v2", tools: null },
    );
    expect(replaced.statusCode).toBe(200);
    expect((replaced.body as Row).name).toBe("HR Assistant v2");
    expect((replaced.body as Row).tools).toBeNull();

    const list = await inject("GET", "/api/model/ontologies/test_ontology/ai-agents");
    expect(list.statusCode).toBe(200);
    const keys = (list.body as Row[]).map((a) => a.key);
    expect(keys).toContain("hr-assistant");

    const deleted = await inject(
      "DELETE",
      "/api/model/ontologies/test_ontology/ai-agents/hr-assistant",
    );
    expect(deleted.statusCode).toBe(204);
    const again = await inject(
      "DELETE",
      "/api/model/ontologies/test_ontology/ai-agents/hr-assistant",
    );
    expect(again.statusCode).toBe(404);
  });

  it("an unknown tool name is rejected 422 naming the valid set", async () => {
    const res = await inject("PUT", "/api/model/ontologies/test_ontology/ai-agents/bad-tools", {
      name: "Bad",
      tools: ["write_document"],
    });
    expect(res.statusCode).toBe(422);
    const message = ((res.body as Row).error as Row).message as string;
    expect(message).toContain("Unknown tool(s): ['write_document']");
    expect(message).toContain("'run_saved_query'");
  });

  it("rejects a bad key and the reserved '_default'", async () => {
    const bad = await inject("PUT", "/api/model/ontologies/test_ontology/ai-agents/BadKey", {
      name: "X",
    });
    expect(bad.statusCode).toBe(422);
    const reserved = await inject(
      "PUT",
      "/api/model/ontologies/test_ontology/ai-agents/_default",
      { name: "X" },
    );
    expect(reserved.statusCode).toBe(422);
  });
});

describe("saved queries (modeling REST, no provider)", () => {
  it("defines, replaces, lists and deletes an oql-only pipeline", async () => {
    const created = await inject(
      "PUT",
      "/api/model/ontologies/test_ontology/saved-queries/people-by-name",
      {
        name: "People by name",
        description: "Find people whose name contains a fragment",
        steps: [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.name CONTAINS $fragment RETURN p.name AS name",
          },
        ],
        parameters: [{ name: "fragment", description: "Name fragment", dataType: "string" }],
      },
    );
    expect(created.statusCode).toBe(201);
    expect((created.body as Row).key).toBe("people-by-name");

    const replaced = await inject(
      "PUT",
      "/api/model/ontologies/test_ontology/saved-queries/people-by-name",
      {
        name: "People by name (v2)",
        description: "Find people whose name contains a fragment",
        steps: [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.name CONTAINS $fragment RETURN p.name AS name",
          },
        ],
        parameters: [{ name: "fragment", description: "Name fragment", dataType: "string" }],
      },
    );
    expect(replaced.statusCode).toBe(200);
    expect((replaced.body as Row).name).toBe("People by name (v2)");

    const list = await inject("GET", "/api/model/ontologies/test_ontology/saved-queries");
    expect(list.statusCode).toBe(200);
    const found = (list.body as Row[]).find((q) => q.key === "people-by-name")!;
    expect(found).toBeDefined();
    expect((found.steps as Row[])[0]!.type).toBe("oql");
    expect((found.parameters as Row[])[0]!.name).toBe("fragment");

    const deleted = await inject(
      "DELETE",
      "/api/model/ontologies/test_ontology/saved-queries/people-by-name",
    );
    expect(deleted.statusCode).toBe(204);
    const again = await inject(
      "DELETE",
      "/api/model/ontologies/test_ontology/saved-queries/people-by-name",
    );
    expect(again.statusCode).toBe(404);
  });

  it("the definition-time OQL check rejects a type the lens cannot see", async () => {
    const res = await inject(
      "PUT",
      "/api/model/ontologies/hr_view/saved-queries/out-of-scope",
      {
        name: "Out of scope",
        description: "names a type outside the lens",
        steps: [{ name: "main", type: "oql", oql: "MATCH (d:department) RETURN d" }],
        parameters: [],
      },
    );
    expect(res.statusCode).toBe(422);
  });

  it("the definition-time OQL check rejects a property the lens hides", async () => {
    const res = await inject("PUT", "/api/model/ontologies/hr_view/saved-queries/hidden-prop", {
      name: "Hidden property",
      description: "hr_view narrows person to name+email",
      steps: [
        { name: "main", type: "oql", oql: "MATCH (p:person) WHERE p.age > $min RETURN p" },
      ],
      parameters: [{ name: "min", description: "minimum age", dataType: "integer" }],
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("runtime listing reflects the schema cache", () => {
  it("every modeling upsert invalidates the cache the listing is served from", async () => {
    const before = await inject("GET", "/api/runtime/test_ontology/saved-queries");
    expect(before.statusCode).toBe(200);
    expect((before.body as Row[]).map((q) => q.key)).not.toContain("cache-probe");

    await inject("PUT", "/api/model/ontologies/test_ontology/saved-queries/cache-probe", {
      name: "Cache Probe",
      description: "probe",
      steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
      parameters: [],
    });

    const after = await inject("GET", "/api/runtime/test_ontology/saved-queries");
    const probe = (after.body as Row[]).find((q) => q.key === "cache-probe")!;
    expect(probe).toBeDefined();
    expect(probe.name).toBe("Cache Probe");
    // The runtime listing carries the pipeline; absent step fields are omitted.
    expect((probe.steps as Row[])[0]).toEqual({
      name: "main",
      type: "oql",
      oql: "MATCH (p:person) RETURN p.name AS name",
    });

    await inject("PUT", "/api/model/ontologies/test_ontology/saved-queries/cache-probe", {
      name: "Cache Probe v2",
      description: "probe",
      steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
      parameters: [],
    });
    const updated = await inject("GET", "/api/runtime/test_ontology/saved-queries");
    expect((updated.body as Row[]).find((q) => q.key === "cache-probe")!.name).toBe(
      "Cache Probe v2",
    );

    await inject("DELETE", "/api/model/ontologies/test_ontology/saved-queries/cache-probe");
    const gone = await inject("GET", "/api/runtime/test_ontology/saved-queries");
    expect((gone.body as Row[]).map((q) => q.key)).not.toContain("cache-probe");
  });
});

describe("runtime run (no provider)", () => {
  it("runs a one-step oql pipeline with typed parameters", async () => {
    await inject("PUT", "/api/model/ontologies/test_ontology/saved-queries/adults", {
      name: "Adults",
      description: "People above an age threshold",
      steps: [
        {
          name: "main",
          type: "oql",
          oql: "MATCH (p:person) WHERE p.age > $min_age RETURN p.name AS name",
        },
      ],
      parameters: [{ name: "min_age", description: "Age threshold", dataType: "integer" }],
    });

    const run = await inject("POST", "/api/runtime/test_ontology/saved-queries/adults/run", {
      params: { min_age: "35" },
    });
    expect(run.statusCode).toBe(200);
    const body = run.body as { columns: string[]; results: Row[] };
    expect(body.columns).toEqual(["name"]);
    expect(body.results).toEqual([{ name: "Bob" }]);
  });

  it("runs a two-step oql -> oql pipeline through a binding", async () => {
    await inject("PUT", "/api/model/ontologies/test_ontology/saved-queries/company-staff", {
      name: "Company staff",
      description: "People working for any company",
      steps: [
        { name: "companies", type: "oql", oql: "MATCH (c:company) RETURN c._id AS cid" },
        {
          name: "staff",
          type: "oql",
          oql:
            "MATCH (p:person)-[:works_for]->(c:company) " +
            "WHERE c._id IN $cids RETURN p.name AS name",
          bindings: { cids: "{{companies.cid}}" },
        },
      ],
      parameters: [],
    });

    const run = await inject(
      "POST",
      "/api/runtime/test_ontology/saved-queries/company-staff/run",
      { params: {} },
    );
    expect(run.statusCode).toBe(200);
    const body = run.body as { columns: string[]; results: Row[] };
    expect(body.columns).toEqual(["name"]);
    expect(body.results).toEqual([{ name: "Alice" }]);
  });

  it("collects missing and unknown parameters together", async () => {
    const run = await inject("POST", "/api/runtime/test_ontology/saved-queries/adults/run", {
      params: { wrong: 1 },
    });
    expect(run.statusCode).toBe(422);
    const error = (run.body as Row).error as Row;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect((error.details as { errors: string[] }).errors).toEqual([
      "Missing required parameters: ['min_age']",
      "Unknown parameters: ['wrong']",
    ]);
  });

  it("an unknown query key answers 404", async () => {
    const run = await inject(
      "POST",
      "/api/runtime/test_ontology/saved-queries/nonexistent/run",
      { params: {} },
    );
    expect(run.statusCode).toBe(404);
  });

  it("a pipeline containing a semantic_search step fails without a provider", async () => {
    await inject("PUT", "/api/model/ontologies/test_ontology/saved-queries/needs-embeddings", {
      name: "Needs embeddings",
      description: "search feeding a query",
      steps: [
        { name: "hits", type: "semantic_search", entityTypeKey: "person", query: "$who" },
        {
          name: "detail",
          type: "oql",
          oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p.name AS name",
          bindings: { ids: "{{hits._id}}" },
        },
      ],
      parameters: [{ name: "who", description: "Who to look for", dataType: "string" }],
    });

    const run = await inject(
      "POST",
      "/api/runtime/test_ontology/saved-queries/needs-embeddings/run",
      { params: { who: "engineers" } },
    );
    expect(run.statusCode).toBe(422);
    const error = (run.body as Row).error as Row;
    expect((error.details as Row).code).toBe("FEATURE_DISABLED");
  });

  it("saved-query search answers FEATURE_DISABLED without a provider", async () => {
    const res = await inject(
      "GET",
      "/api/runtime/test_ontology/saved-queries/search?q=find+people",
    );
    expect(res.statusCode).toBe(422);
    const error = (res.body as Row).error as Row;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect((error.details as Row).code).toBe("FEATURE_DISABLED");
  });
});

describe("modeling MCP tools", () => {
  it("set/list/delete an agent config, reporting created vs updated", async () => {
    const client = await connectClient(`${baseUrl}/mcp/model`);
    try {
      const created = await call(client, "set_ai_agent", {
        ontology_key: "test_ontology",
        key: "mcp-agent",
        name: "MCP Agent",
        description: "made over MCP",
        system_prompt: "Be terse.",
        tools: ["get_schema"],
      });
      expect(created.isError).toBeUndefined();
      expect(json(created).created).toBe(true);
      expect(json(created).key).toBe("mcp-agent");

      const updated = await call(client, "set_ai_agent", {
        ontology_key: "test_ontology",
        key: "mcp-agent",
        name: "MCP Agent v2",
      });
      expect(json(updated).created).toBe(false);
      expect(json(updated).name).toBe("MCP Agent v2");

      const list = await call(client, "list_ai_agents", { ontology_key: "test_ontology" });
      const keys = (JSON.parse(text(list)) as Row[]).map((a) => a.key);
      expect(keys).toContain("mcp-agent");

      const refused = await call(client, "set_ai_agent", {
        ontology_key: "test_ontology",
        key: "mcp-agent",
        name: "X",
        tools: ["get_document"],
      });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("Unknown tool(s)");

      const deleted = await call(client, "delete_ai_agent", {
        ontology_key: "test_ontology",
        agent_key: "mcp-agent",
      });
      expect(text(deleted)).toBe("AI agent 'mcp-agent' deleted from ontology 'test_ontology'.");
    } finally {
      await client.close();
    }
  });

  it("set/list/delete a saved query; a validation failure flattens every error", async () => {
    const client = await connectClient(`${baseUrl}/mcp/model`);
    try {
      const created = await call(client, "set_saved_query", {
        ontology_key: "test_ontology",
        key: "mcp-query",
        name: "MCP Query",
        description: "made over MCP",
        steps: [
          { name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" },
        ],
      });
      expect(created.isError).toBeUndefined();
      expect(json(created).created).toBe(true);

      const updated = await call(client, "set_saved_query", {
        ontology_key: "test_ontology",
        key: "mcp-query",
        name: "MCP Query v2",
        description: "made over MCP",
        steps: [
          { name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" },
        ],
      });
      expect(json(updated).created).toBe(false);

      const list = await call(client, "list_saved_queries", { ontology_key: "test_ontology" });
      const keys = (JSON.parse(text(list)) as Row[]).map((q) => q.key);
      expect(keys).toContain("mcp-query");

      // One tool error carries every collected failure.
      const refused = await call(client, "set_saved_query", {
        ontology_key: "test_ontology",
        key: "mcp-bad",
        name: "Bad",
        description: "bad",
        steps: [
          { name: "a", type: "oql" },
          { name: "a", type: "oql", oql: "MATCH (p:person) WHERE p.age > $age RETURN p" },
        ],
        parameters: [{ name: "unused", description: "u", dataType: "string" }],
      });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("steps[0].oql: Required for oql steps");
      expect(text(refused)).toContain("'a' already used by steps[0]");
      expect(text(refused)).toContain("not declared: ['age']");
      expect(text(refused)).toContain("not referenced in any step: ['unused']");

      const deleted = await call(client, "delete_saved_query", {
        ontology_key: "test_ontology",
        query_key: "mcp-query",
      });
      expect(text(deleted)).toBe(
        "Saved query 'mcp-query' deleted from ontology 'test_ontology'.",
      );
    } finally {
      await client.close();
    }
  });
});

describe("runtime MCP tools", () => {
  it("list and run work without a provider; search reports FEATURE_DISABLED", async () => {
    await inject("PUT", "/api/model/ontologies/test_ontology/saved-queries/mcp-run-probe", {
      name: "MCP Run Probe",
      description: "runtime MCP probe",
      steps: [
        {
          name: "main",
          type: "oql",
          oql: "MATCH (p:person) WHERE p.name = $who RETURN p.name AS name",
        },
      ],
      parameters: [{ name: "who", description: "Exact name", dataType: "string" }],
    });

    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const list = await call(client, "list_saved_queries");
      const queries = JSON.parse(text(list)) as Row[];
      const probe = queries.find((q) => q.key === "mcp-run-probe")!;
      expect(probe).toBeDefined();
      expect((probe.parameters as Row[])[0]!.name).toBe("who");

      const run = await call(client, "run_saved_query", {
        query_key: "mcp-run-probe",
        params: { who: "Alice" },
      });
      expect(run.isError).toBeUndefined();
      const result = json(run) as { columns: string[]; results: Row[] };
      expect(result.results).toEqual([{ name: "Alice" }]);

      const missing = await call(client, "run_saved_query", { query_key: "mcp-run-probe" });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toContain("Missing required parameters: ['who']");

      const search = await call(client, "search_saved_queries", { query: "probe" });
      expect(search.isError).toBe(true);
      expect(text(search)).toContain("EMBEDDING_PROVIDER");
    } finally {
      await client.close();
    }
  });
});

describe("lens cascade", () => {
  it("deleting the lens deletes its agents and saved queries", async () => {
    const created = await inject("POST", "/api/model/ontologies", {
      key: "cascade_probe",
      name: "Cascade Probe",
    });
    expect(created.statusCode).toBe(201);
    const ontologyId = (created.body as Row).ontologyId as string;

    await inject("PUT", "/api/model/ontologies/cascade_probe/ai-agents/doomed-agent", {
      name: "Doomed",
    });
    await inject("PUT", "/api/model/ontologies/cascade_probe/saved-queries/doomed-query", {
      name: "Doomed",
      description: "doomed",
      steps: [{ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" }],
      parameters: [],
    });

    const deleted = await inject("DELETE", `/api/model/ontologies/${ontologyId}`);
    expect(deleted.statusCode).toBe(204);

    // Recreate the same key: a fresh lens holds neither configuration.
    const recreated = await inject("POST", "/api/model/ontologies", {
      key: "cascade_probe",
      name: "Cascade Probe II",
    });
    expect(recreated.statusCode).toBe(201);
    const agents = await inject("GET", "/api/model/ontologies/cascade_probe/ai-agents");
    expect(agents.body).toEqual([]);
    const queries = await inject("GET", "/api/model/ontologies/cascade_probe/saved-queries");
    expect(queries.body).toEqual([]);
  });
});
