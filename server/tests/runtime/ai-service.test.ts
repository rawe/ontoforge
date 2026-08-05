/**
 * The AI engine with a scripted model (the "mock the model" unit plan of
 * session 11): toolset computation (allowlist ∩ availability), prompt
 * assembly, the tool-error self-correction loop vs abort, query response
 * with and without a tool call, extract persist rules (same-call matching,
 * silent drop, no dedup), trace shape, history mapping, and the
 * FEATURE_DISABLED rejection without a provider.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setAiModel, type AgentConfig } from "../../src/core/ai.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import {
  CHAT_TOOLS,
  aiChat,
  aiExtract,
  aiQuery,
  describeSchema,
  normalizeExtraction,
  runAgentChat,
} from "../../src/runtime/aiService.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../../src/runtime/schemaCache.js";
import { FakeToolCallingModel, toolCallMessage } from "./aiHelpers.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeRelation,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, unknown>;

let store: MockRuntimeStore;

beforeEach(() => {
  store = createMockRuntimeStore();
  store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
  invalidateLoadedSchemaCache();
});

afterEach(() => {
  setAiModel(null);
  setEmbeddingProvider(null);
});

function installFake(responses: AIMessage[]): FakeToolCallingModel {
  const fake = new FakeToolCallingModel(responses);
  setAiModel(fake);
  return fake;
}

function boundToolNames(fake: FakeToolCallingModel): string[] {
  return (fake.boundTools[0] ?? []).map((t) => (t as { name: string }).name);
}

const fakeEmbedding = { dimensions: 4, embed: async () => [0, 0, 0, 0] };

// ---------------------------------------------------------------------------
// Toolset computation
// ---------------------------------------------------------------------------

describe("toolset computation", () => {
  it("default agent without embedding provider drops the embedding tools", async () => {
    const fake = installFake([new AIMessage("hi")]);

    await aiChat("full_ontology", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(
      CHAT_TOOLS.filter((t) => t !== "semantic_search" && t !== "search_saved_queries"),
    );
  });

  it("default agent with embedding provider gets all ten tools", async () => {
    setEmbeddingProvider(fakeEmbedding);
    const fake = installFake([new AIMessage("hi")]);

    await aiChat("full_ontology", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(CHAT_TOOLS);
  });

  it("explicit allowlist is intersected with availability, keeping its order", async () => {
    const fake = installFake([new AIMessage("hi")]);
    const config: AgentConfig = {
      key: "restricted",
      name: "Restricted",
      description: null,
      systemPrompt: null,
      tools: ["semantic_search", "execute_query", "get_schema", "not_a_tool"],
    };

    await runAgentChat(config, "full_ontology", "hello", asRuntimeStore(store));

    // semantic_search dropped (no provider), unknown name dropped silently.
    expect(boundToolNames(fake)).toEqual(["execute_query", "get_schema"]);
  });

  it("allowlist naming embedding tools still works with the provider present", async () => {
    setEmbeddingProvider(fakeEmbedding);
    const fake = installFake([new AIMessage("hi")]);
    const config: AgentConfig = {
      key: "searcher",
      name: "Searcher",
      description: null,
      systemPrompt: null,
      tools: ["semantic_search"],
    };

    await runAgentChat(config, "full_ontology", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(["semantic_search"]);
  });

  it("an empty effective toolset still answers (plain model call)", async () => {
    const fake = installFake([new AIMessage("plain answer")]);
    const config: AgentConfig = {
      key: "toolless",
      name: "Toolless",
      description: null,
      systemPrompt: null,
      tools: ["semantic_search"], // dropped without a provider -> empty
    };

    const result = await runAgentChat(config, "full_ontology", "hello", asRuntimeStore(store));

    expect(result.reply).toBe("plain answer");
    expect(fake.boundTools).toHaveLength(0);
    expect(fake.calls[0]![0]).toBeInstanceOf(SystemMessage);
  });
});

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

describe("prompt assembly", () => {
  it("no custom prompt: the built-in chat prompt containing the schema", async () => {
    const fake = installFake([new AIMessage("hi")]);

    await aiChat("full_ontology", "hello", asRuntimeStore(store));

    const loaded = await loadSchema("full_ontology", asRuntimeStore(store));
    const system = fake.calls[0]![0]!;
    expect(system).toBeInstanceOf(SystemMessage);
    const content = String(system.content);
    expect(content).toMatch(/^You are a knowledge graph assistant\./);
    expect(content).toContain("SCHEMA:\n" + describeSchema(loaded.scoped));
    expect(content).toContain("Never make up answers");
  });

  it("custom prompt: used verbatim with the schema description appended", async () => {
    const fake = installFake([new AIMessage("hi")]);
    const config: AgentConfig = {
      key: "custom",
      name: "Custom",
      description: null,
      systemPrompt: "You are a test agent",
      tools: null,
    };

    await runAgentChat(config, "full_ontology", "hello", asRuntimeStore(store));

    const loaded = await loadSchema("full_ontology", asRuntimeStore(store));
    const content = String(fake.calls[0]![0]!.content);
    expect(content).toBe("You are a test agent\n\nSCHEMA:\n" + describeSchema(loaded.scoped));
  });

  it("the schema description names the lens, types, properties and flags", async () => {
    const loaded = await loadSchema("full_ontology", asRuntimeStore(store));
    const desc = describeSchema(loaded.scoped);

    expect(desc).toContain("Ontology: Full Ontology (key: full_ontology)");
    expect(desc).toContain("  - _id: string (unique identifier)");
    expect(desc).toContain("  - person");
    expect(desc).toContain("    - name: string (required)");
    expect(desc).toContain("    - age: integer");
    expect(desc).toContain("  - works_for: person -> company");
  });
});

// ---------------------------------------------------------------------------
// Tool-error feedback loop vs abort
// ---------------------------------------------------------------------------

describe("tool failures", () => {
  it("a not-found error becomes the tool result and the run continues", async () => {
    const fake = installFake([
      toolCallMessage("list_entities", { entity_type_key: "nope" }),
      new AIMessage("recovered"),
    ]);

    const result = await aiChat("full_ontology", "list them", asRuntimeStore(store), null, true);

    expect(result.reply).toBe("recovered");
    // The second model call sees the error as the tool's result.
    const toolMessages = fake.calls[1]!.filter((m) => m instanceof ToolMessage);
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0]!.content)).toContain("Entity type 'nope' not found");
    // The failed call still appears in the trace.
    expect(result.toolCalls).toEqual([
      { tool: "list_entities", args: { entity_type_key: "nope" } },
    ]);
  });

  it("a validation error becomes the tool result and the run continues", async () => {
    installFake([
      toolCallMessage("execute_query", { query: "MATCH (p:person) CREATE (q:person)" }),
      new AIMessage("fixed"),
    ]);

    const result = await aiChat("full_ontology", "query", asRuntimeStore(store));

    expect(result.reply).toBe("fixed");
  });

  it("schema-invalid tool arguments become the tool result and the run continues", async () => {
    // The exact shape a real model emitted: filters must map strings to
    // strings, but the model sent an array under "anyOf".
    const fake = installFake([
      toolCallMessage("list_entities", {
        entity_type_key: "person",
        filters: { anyOf: [{ name__contains: "Alice" }] },
      }),
      new AIMessage("recovered"),
    ]);

    const result = await aiChat("full_ontology", "find Alice", asRuntimeStore(store), null, true);

    expect(result.reply).toBe("recovered");
    // The second model call sees the parse failure as the tool's result.
    const toolMessages = fake.calls[1]!.filter((m) => m instanceof ToolMessage);
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0]!.content)).toContain("Invalid arguments for list_entities");
    // The rejected call still appears in the trace.
    expect(result.toolCalls).toEqual([
      {
        tool: "list_entities",
        args: { entity_type_key: "person", filters: { anyOf: [{ name__contains: "Alice" }] } },
      },
    ]);
  });

  it("any other error aborts the run", async () => {
    installFake([
      toolCallMessage("list_entities", { entity_type_key: "person" }),
      new AIMessage("never reached"),
    ]);
    store.listEntities.mockRejectedValue(new Error("boom"));

    await expect(aiChat("full_ontology", "list", asRuntimeStore(store))).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// Query: response with and without a tool call
// ---------------------------------------------------------------------------

describe("aiQuery", () => {
  it("carries the generated OQL and the raw rows when the tool was called", async () => {
    const fake = installFake([
      toolCallMessage("execute_query", { query: "MATCH (p:person) RETURN p.name" }),
      new AIMessage("There are two people."),
    ]);
    store.executeOql.mockResolvedValue([["p.name"], [{ "p.name": "Alice" }, { "p.name": "Bob" }]]);

    const result = await aiQuery("full_ontology", "How many people?", asRuntimeStore(store));

    expect(result.answer).toBe("There are two people.");
    expect(result.query).toBe("MATCH (p:person) RETURN p.name");
    expect(result.results).toEqual({
      columns: ["p.name"],
      results: [{ "p.name": "Alice" }, { "p.name": "Bob" }],
    });
    // The query agent binds exactly one tool.
    expect(boundToolNames(fake)).toEqual(["execute_query"]);
  });

  it("query and results are absent when the tool was never called", async () => {
    installFake([new AIMessage("I answered from thin air.")]);

    const result = await aiQuery("full_ontology", "Anything?", asRuntimeStore(store));

    expect(result.answer).toBe("I answered from thin air.");
    expect(result.query).toBeNull();
    expect(result.results).toBeNull();
  });

  it("a failed query yields the error dict as results (Python parity)", async () => {
    installFake([
      toolCallMessage("execute_query", { query: "MATCH (x:unknown_type) RETURN x" }),
      new AIMessage("That failed."),
    ]);

    const result = await aiQuery("full_ontology", "Bad question", asRuntimeStore(store));

    expect(result.query).toBe("MATCH (x:unknown_type) RETURN x");
    expect(result.results).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Extract: persist rules
// ---------------------------------------------------------------------------

const EXTRACTION = {
  entities: [
    { entityTypeKey: "person", properties: { name: "Charlie", age: 28 } },
    { entityTypeKey: "company", properties: { name: "DataFlow" } },
  ],
  relations: [
    {
      relationTypeKey: "works_for",
      source: { entityTypeKey: "person", match: { name: "Charlie", age: 28 } },
      target: { entityTypeKey: "company", match: { name: "DataFlow" } },
      properties: {},
    },
  ],
};

function installExtractFake(structuredOutput: unknown): FakeToolCallingModel {
  const fake = new FakeToolCallingModel([]);
  fake.structuredOutput = structuredOutput;
  setAiModel(fake);
  return fake;
}

/** Wire the mock store so created entities are echoed back and relation
 * endpoint checks resolve against them. */
function wireCreation(): Row[] {
  const created: Row[] = [];
  store.createEntity.mockImplementation(
    async (entityTypeKey: string, entityId: string, props: Row) => {
      const entity = makeEntity(props, entityTypeKey, entityId);
      created.push(entity);
      return entity;
    },
  );
  store.getEntityById.mockImplementation(
    async (id: string) => created.find((e) => e._id === id) ?? null,
  );
  store.createRelation.mockImplementation(
    async (relationTypeKey: string, relationId: string, fromId: string, toId: string) =>
      makeRelation({}, { relationTypeKey, relationId, fromEntityId: fromId, toEntityId: toId }),
  );
  return created;
}

describe("aiExtract", () => {
  it("propose-only by default: nothing written, proposals echoed", async () => {
    installExtractFake(EXTRACTION);

    const result = await aiExtract("full_ontology", "Charlie ...", asRuntimeStore(store));

    expect(result.created).toBe(false);
    expect(result.entities).toEqual(EXTRACTION.entities);
    expect(result.relations).toEqual(EXTRACTION.relations);
    expect(store.createEntity).not.toHaveBeenCalled();
    expect(store.createRelation).not.toHaveBeenCalled();
  });

  it("persists on request: entities first, relations via same-call match maps", async () => {
    installExtractFake(EXTRACTION);
    const created = wireCreation();

    const result = await aiExtract(
      "full_ontology",
      "Charlie ...",
      asRuntimeStore(store),
      null,
      true,
    );

    expect(result.created).toBe(true);
    expect(store.createEntity).toHaveBeenCalledTimes(2);
    expect(store.createRelation).toHaveBeenCalledTimes(1);
    const [, , fromId, toId] = store.createRelation.mock.calls[0]! as [
      string,
      string,
      string,
      string,
    ];
    const charlie = created.find((e) => e.name === "Charlie")!;
    const dataflow = created.find((e) => e.name === "DataFlow")!;
    expect(fromId).toBe(charlie._id);
    expect(toId).toBe(dataflow._id);
  });

  it("silently drops a relation whose endpoints do not both resolve", async () => {
    installExtractFake({
      ...EXTRACTION,
      relations: [
        {
          relationTypeKey: "works_for",
          source: { entityTypeKey: "person", match: { name: "Nobody" } },
          target: { entityTypeKey: "company", match: { name: "DataFlow" } },
          properties: {},
        },
      ],
    });
    wireCreation();

    const result = await aiExtract(
      "full_ontology",
      "Charlie ...",
      asRuntimeStore(store),
      null,
      true,
    );

    expect(result.created).toBe(true);
    expect(store.createRelation).not.toHaveBeenCalled();
  });

  it("does not deduplicate: the same entity twice is created twice", async () => {
    installExtractFake({
      entities: [
        { entityTypeKey: "person", properties: { name: "Charlie" } },
        { entityTypeKey: "person", properties: { name: "Charlie" } },
      ],
      relations: [],
    });
    wireCreation();

    await aiExtract("full_ontology", "Charlie twice", asRuntimeStore(store), null, true);

    expect(store.createEntity).toHaveBeenCalledTimes(2);
  });

  it("entity-type hints are appended to the prompt, not enforced", async () => {
    const fake = installExtractFake({ entities: [], relations: [] });

    await aiExtract("full_ontology", "text", asRuntimeStore(store), ["person", "company"]);

    const system = fake.calls[0]![0]!;
    expect(String(system.content)).toContain("Focus on these entity types: person, company");
  });

  it("accepts snake_case field names from the model (pydantic alias parity)", () => {
    const normalized = normalizeExtraction({
      entities: [{ entity_type_key: "person", properties: { name: "X" } }],
      relations: [
        {
          relation_type_key: "works_for",
          source: { entity_type_key: "person", match: { name: "X" } },
          target: { entity_type_key: "company", match: { name: "Y" } },
        },
      ],
    });

    expect(normalized.entities[0]!.entityTypeKey).toBe("person");
    expect(normalized.relations[0]!.relationTypeKey).toBe("works_for");
    expect(normalized.relations[0]!.properties).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Trace shape and history mapping
// ---------------------------------------------------------------------------

describe("chat trace and history", () => {
  it("trace off by default: toolCalls is null", async () => {
    installFake([new AIMessage("hi")]);

    const result = await aiChat("full_ontology", "hello", asRuntimeStore(store));

    expect(result.toolCalls).toBeNull();
  });

  it("trace on request: ordered tool names with arguments, no results", async () => {
    store.listEntities.mockResolvedValue([[makeEntity({ name: "Alice" })], 1]);
    store.executeOql.mockResolvedValue([["c"], [{ c: 2 }]]);
    installFake([
      toolCallMessage("list_entities", { entity_type_key: "person" }, "c1"),
      toolCallMessage("execute_query", { query: "MATCH (p:person) RETURN count(p)" }, "c2"),
      new AIMessage("done"),
    ]);

    const result = await aiChat("full_ontology", "explore", asRuntimeStore(store), null, true);

    expect(result.toolCalls).toEqual([
      { tool: "list_entities", args: { entity_type_key: "person" } },
      { tool: "execute_query", args: { query: "MATCH (p:person) RETURN count(p)" } },
    ]);
  });

  it("history turns are replayed as user/assistant messages before the new one", async () => {
    const fake = installFake([new AIMessage("She is 30.")]);

    await aiChat("full_ontology", "And how old is she?", asRuntimeStore(store), [
      { role: "user", content: "How many persons are there?" },
      { role: "assistant", content: "There are 2 persons: Alice and Bob." },
    ]);

    const messages = fake.calls[0]!;
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(String(messages[1]!.content)).toBe("How many persons are there?");
    expect(messages[2]).toBeInstanceOf(AIMessage);
    expect(String(messages[2]!.content)).toBe("There are 2 persons: Alice and Bob.");
    expect(messages[3]).toBeInstanceOf(HumanMessage);
    expect(String(messages[3]!.content)).toBe("And how old is she?");
  });
});

// ---------------------------------------------------------------------------
// FEATURE_DISABLED without a provider
// ---------------------------------------------------------------------------

describe("without a language-model provider", () => {
  const expectDisabled = async (run: () => Promise<unknown>) => {
    try {
      await run();
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.message).toBe("AI feature is disabled (AI_PROVIDER not configured)");
      expect(validation.details).toEqual({ code: "FEATURE_DISABLED" });
    }
  };

  it("query is rejected with FEATURE_DISABLED", async () => {
    await expectDisabled(() => aiQuery("full_ontology", "q", asRuntimeStore(store)));
  });

  it("extract is rejected with FEATURE_DISABLED", async () => {
    await expectDisabled(() => aiExtract("full_ontology", "text", asRuntimeStore(store)));
  });

  it("chat is rejected with FEATURE_DISABLED", async () => {
    await expectDisabled(() => aiChat("full_ontology", "hi", asRuntimeStore(store)));
  });

  it("an unknown lens still answers not-found before the provider check", async () => {
    store.getFullSchema.mockResolvedValue(null);
    await expect(aiQuery("missing", "q", asRuntimeStore(store))).rejects.toThrow(NotFoundError);
  });
});
