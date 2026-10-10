/**
 * The AI engine with a scripted model (the "mock the model" unit plan of
 * session 11): toolset computation (allowlist ∩ availability), prompt
 * assembly, the tool-error self-correction loop vs abort, trace shape,
 * history mapping, and the FEATURE_DISABLED rejection without a provider.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_AGENT_CONFIG, setAiModel, type AgentConfig } from "../../src/core/ai.js";
import { RELATIVE_SCORE_PROMISE, TOOL_MIN_SIMILARITY } from "../../src/runtime/search/strategies.js";
import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import {
  CHAT_TOOLS,
  describeSchema,
  runAgentChat,
  type ChatHistoryEntry,
} from "../../src/runtime/aiService.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../../src/runtime/schemaCache.js";
import { FakeToolCallingModel, toolCallMessage } from "./aiHelpers.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, unknown>;

/** Chat with the built-in default agent. */
const aiChat = (
  lensKey: string,
  message: string,
  runtime: Parameters<typeof runAgentChat>[3],
  history: ChatHistoryEntry[] | null = null,
  includeToolCalls = false,
) => runAgentChat(DEFAULT_AGENT_CONFIG, lensKey, message, runtime, history, includeToolCalls);

let store: MockRuntimeStore;

beforeEach(() => {
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(makeUnscopedSchema());
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

/** Keyword ranking is the search indices': give the store an index store
 * that holds no index yet, so search answers from it with no hits. */
function withEmptySearchIndices(target: MockRuntimeStore): void {
  target.supportsKeywordRanking.mockReturnValue(true);
  const indexStore = {
    listIndices: async () => [],
    getSearchSettings: async () => ({ keywordLanguages: ["english"], disabledDefaults: {} }),
    listGenerations: async () => [],
  };
  Object.assign(target, { searchIndices: () => indexStore });
}

// ---------------------------------------------------------------------------
// Toolset computation
// ---------------------------------------------------------------------------

describe("toolset computation", () => {
  it("default agent without embedding provider drops the embedding tools", async () => {
    const fake = installFake([new AIMessage("hi")]);

    await aiChat("full_lens", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(
      CHAT_TOOLS.filter(
        (t) => t !== "search" && t !== "search_documents" && t !== "search_saved_queries",
      ),
    );
  });

  it("default agent with embedding provider gets every tool", async () => {
    setEmbeddingProvider(fakeEmbedding);
    const fake = installFake([new AIMessage("hi")]);

    await aiChat("full_lens", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(CHAT_TOOLS);
  });

  it("keeps both search tools with keyword ranking and no embedding provider", async () => {
    withEmptySearchIndices(store);
    const fake = installFake([
      toolCallMessage("search", { query: "engineer" }),
      new AIMessage("Found them."),
    ]);
    await aiChat("full_lens", "find an engineer", asRuntimeStore(store));
    expect(boundToolNames(fake)).toContain("search");
    expect(boundToolNames(fake)).toContain("search_documents");
    expect(boundToolNames(fake)).not.toContain("semantic_search");
    expect(boundToolNames(fake)).not.toContain("search_saved_queries");
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload).toEqual({ query: "engineer", type: null, in: ["properties", "document"], strategy: "keyword", minSimilarity: null, filter: {}, hits: [] });
    for (const tool of fake.boundTools[0]! as { name: string; description: string; schema: { shape: Record<string, unknown> } }[]) {
      if (!["search", "search_documents"].includes(tool.name)) continue;
      expect(tool.description).toContain(RELATIVE_SCORE_PROMISE);
      expect(tool.description).toContain("semanticSimilarity");
      // Matches carry no property attribution any more.
      expect(tool.description).not.toContain("keywordPropertyKeys");
      expect(tool.description).toContain("unknown or unmeasured");
      expect(tool.description).toContain("distinct query words matched plus the full-text rank");
      expect(tool.description).not.toMatch(/adapter/i);
      expect(tool.description.length).toBeLessThanOrEqual(2000);
      expect(Object.keys(tool.schema.shape).sort()).toEqual((tool.name === "search" ? ["query", "entity_type_key", "limit"] : ["query", "entity_type_key", "limit", "property"]).sort());
    }
  });

  it("run_saved_query preserves a final search envelope", async () => {
    withEmptySearchIndices(store);
    store.getSavedQueries.mockResolvedValue([{
      key: "find_people", name: "Find people", description: "Find people",
      steps: JSON.stringify([{ name: "people", type: "search", entityTypeKey: "person", query: "engineer" }]),
      parameters: "[]",
    }]);
    const fake = installFake([toolCallMessage("run_saved_query", { query_key: "find_people" }), new AIMessage("Done")]);
    await aiChat("full_lens", "run the query", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload).toEqual({ query: "engineer", type: "person", in: ["properties", "document"], strategy: "keyword", minSimilarity: null, filter: {}, hits: [] });
  });

  it("search tools apply the fixed floor under a hybrid default", async () => {
    setEmbeddingProvider(fakeEmbedding);
    withEmptySearchIndices(store);
    const fake = installFake([
      toolCallMessage("search", { query: "engineer", entity_type_key: "person" }),
      new AIMessage("Found."),
    ]);
    await aiChat("full_lens", "find an engineer", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload.strategy).toBe("hybrid");
    expect(payload.minSimilarity).toBe(TOOL_MIN_SIMILARITY);
  });

  it("search tools apply the fixed floor under a semantic default", async () => {
    setEmbeddingProvider(fakeEmbedding);
    store.propertySearchSemantic.mockResolvedValue([
      { entity: { _id: "a", _entityTypeKey: "person", name: "a" }, score: 0.8 },
      { entity: { _id: "b", _entityTypeKey: "person", name: "b" }, score: 0.7 },
    ]);
    store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { _id: id, _entityTypeKey: "person", name: id }])),
    );
    const fake = installFake([
      toolCallMessage("search", { query: "engineer", entity_type_key: "person" }),
      new AIMessage("Found."),
    ]);
    await aiChat("full_lens", "find an engineer", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload.strategy).toBe("semantic");
    expect(payload.minSimilarity).toBe(TOOL_MIN_SIMILARITY);
    expect((payload.hits as Row[]).map((h) => (h.entity as Row)._id)).toEqual(["a"]);
    for (const tool of fake.boundTools[0]! as { name: string; description: string }[]) {
      if (!["search", "search_documents"].includes(tool.name)) continue;
      expect(tool.description).toContain("fixed similarity floor");
      expect(tool.description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("search tools pass no floor under a keyword default", async () => {
    withEmptySearchIndices(store);
    const schema = makeUnscopedSchema();
    (schema.entityTypes as Row[])[0]!.properties = [
      ...((schema.entityTypes as Row[])[0]!.properties as Row[]),
      { key: "bio", displayName: "Bio", dataType: "document" },
    ];
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    const fake = installFake([
      toolCallMessage("search_documents", { query: "engineer" }),
      new AIMessage("Found."),
    ]);
    await aiChat("full_lens", "find an engineer", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload.strategy).toBe("keyword");
    expect(payload.minSimilarity).toBeNull();
    expect(store.propertySearchSemantic).not.toHaveBeenCalled();
  });

  it("explicit allowlist is intersected with availability, keeping its order", async () => {
    const fake = installFake([new AIMessage("hi")]);
    const config: AgentConfig = {
      key: "restricted",
      name: "Restricted",
      description: null,
      systemPrompt: null,
      tools: ["search", "execute_query", "get_schema", "not_a_tool"],
    };

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store));

    // search dropped (no provider), unknown name dropped silently.
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
      tools: ["search"],
    };

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(["search"]);
  });

  it("an empty effective toolset still answers (plain model call)", async () => {
    const fake = installFake([new AIMessage("plain answer")]);
    const config: AgentConfig = {
      key: "toolless",
      name: "Toolless",
      description: null,
      systemPrompt: null,
      tools: ["search"], // dropped without a provider -> empty
    };

    const result = await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store));

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

    await aiChat("full_lens", "hello", asRuntimeStore(store));

    const loaded = await loadSchema("full_lens", asRuntimeStore(store));
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

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store));

    const loaded = await loadSchema("full_lens", asRuntimeStore(store));
    const content = String(fake.calls[0]![0]!.content);
    expect(content).toBe("You are a test agent\n\nSCHEMA:\n" + describeSchema(loaded.scoped));
  });

  it("the schema description names the lens, types, properties and flags", async () => {
    const loaded = await loadSchema("full_lens", asRuntimeStore(store));
    const desc = describeSchema(loaded.scoped);

    expect(desc).toContain("Lens: Full Lens (key: full_lens)");
    expect(desc).toContain("  - _id: string (unique identifier)");
    expect(desc).toContain("  - person");
    expect(desc).toContain("    - name: string (required)");
    expect(desc).toContain("    - age: integer");
    expect(desc).toContain("  - works_for: person -> company");
  });
});

// ---------------------------------------------------------------------------
// Document reads
// ---------------------------------------------------------------------------

/** The unscoped fixture with a document property on person. */
function schemaWithDocument(): Row {
  const schema = makeFullSchema({ lensKey: "full_lens", lensName: "Full Lens" });
  const person = (schema.entityTypes as Row[])[0]!;
  (person.properties as Row[]).push({
    key: "bio",
    displayName: "Bio",
    dataType: "document",
    required: false,
    defaultValue: null,
  });
  return schema;
}

describe("document reads", () => {
  const BIO = "Alice joined in 2019. ".repeat(20);

  beforeEach(() => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithDocument());
    invalidateLoadedSchemaCache();
  });

  it("get_document reads the segment the model asked for", async () => {
    const fake = installFake([
      toolCallMessage("get_document", {
        entity_type_key: "person",
        entity_id: "ent-1",
        property_key: "bio",
        offset: 22,
        limit: 21,
      }),
      new AIMessage("She joined in 2019."),
    ]);
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", bio: BIO }));

    const result = await aiChat("full_lens", "what does her bio say?", asRuntimeStore(store));

    expect(result.reply).toBe("She joined in 2019.");
    const toolMessages = fake.calls[1]!.filter((m) => m instanceof ToolMessage);
    expect(JSON.parse(String(toolMessages[0]!.content))).toEqual({
      propertyKey: "bio",
      content: "Alice joined in 2019.",
      offset: 22,
      length: 21,
      totalLength: BIO.length,
    });
  });

  it("get_document without offset and limit reads the whole document, as the MCP tool does", async () => {
    const fake = installFake([
      toolCallMessage("get_document", {
        entity_type_key: "person",
        entity_id: "ent-1",
        property_key: "bio",
      }),
      new AIMessage("read it"),
    ]);
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice", bio: BIO }));

    await aiChat("full_lens", "read the bio", asRuntimeStore(store));

    const toolMessages = fake.calls[1]!.filter((m) => m instanceof ToolMessage);
    const payload = JSON.parse(String(toolMessages[0]!.content)) as Row;
    expect(payload.content).toBe(BIO);
    expect(payload.offset).toBe(0);
  });

  it("search_documents ranks passages and hands back retrieval coordinates", async () => {
    setEmbeddingProvider(fakeEmbedding);
    const fake = installFake([
      toolCallMessage("search_documents", { query: "when did she join" }),
      new AIMessage("In 2019."),
    ]);
    store.documentSearchSemantic.mockResolvedValue([
      {
        chunk: {
          _id: "chunk-1",
          _entityId: "ent-1",
          _entityTypeKey: "person",
          _propertyKey: "bio",
          _index: 0,
          startChar: 22,
          charLength: 21,
          text: "Alice joined in 2019.",
        },
        score: 0.91,
      },
    ]);
    store.getEntitiesByIds.mockResolvedValue({
      "ent-1": makeEntity({ name: "Alice", bio: BIO }),
    });

    const result = await aiChat("full_lens", "when did Alice join?", asRuntimeStore(store), null, true);

    expect(result.reply).toBe("In 2019.");
    const toolMessages = fake.calls[1]!.filter((m) => m instanceof ToolMessage);
    const payload = JSON.parse(String(toolMessages[0]!.content)) as Row;
    const hit = (payload.hits as Row[])[0]!;
    expect(hit.matches).toEqual([{ kind: "document", propertyKey: "bio", charOffset: 22, charLength: 21, evidence: { semanticSimilarity: 0.91, keywordMatch: null, keywordScore: null } }]);
    expect(hit.relativeScore).toBe(1);
    // Only the passage ranking runs — the entity ranking is not consulted.
    expect(store.propertySearchSemantic).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([
      { tool: "search_documents", args: { query: "when did she join" } },
    ]);
  });

  it("search_documents is dropped without an embedding provider", async () => {
    const fake = installFake([new AIMessage("hi")]);
    const config: AgentConfig = {
      key: "reader",
      name: "Reader",
      description: null,
      systemPrompt: null,
      tools: ["get_document", "search_documents"],
    };

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store));

    expect(boundToolNames(fake)).toEqual(["get_document"]);
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

    const result = await aiChat("full_lens", "list them", asRuntimeStore(store), null, true);

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

    const result = await aiChat("full_lens", "query", asRuntimeStore(store));

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

    const result = await aiChat("full_lens", "find Alice", asRuntimeStore(store), null, true);

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

    await expect(aiChat("full_lens", "list", asRuntimeStore(store))).rejects.toThrow("boom");
  });

  it("a tool name outside the toolset aborts the run", async () => {
    installFake([
      toolCallMessage("drop_everything", {}),
      new AIMessage("never reached"),
    ]);

    await expect(aiChat("full_lens", "go", asRuntimeStore(store))).rejects.toThrow(
      'Tool "drop_everything" not found.',
    );
  });
});

// ---------------------------------------------------------------------------
// Trace shape and history mapping
// ---------------------------------------------------------------------------

describe("chat trace and history", () => {
  it("trace off by default: toolCalls is null", async () => {
    installFake([new AIMessage("hi")]);

    const result = await aiChat("full_lens", "hello", asRuntimeStore(store));

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

    const result = await aiChat("full_lens", "explore", asRuntimeStore(store), null, true);

    expect(result.toolCalls).toEqual([
      { tool: "list_entities", args: { entity_type_key: "person" } },
      { tool: "execute_query", args: { query: "MATCH (p:person) RETURN count(p)" } },
    ]);
  });

  it("history turns are replayed as user/assistant messages before the new one", async () => {
    const fake = installFake([new AIMessage("She is 30.")]);

    await aiChat("full_lens", "And how old is she?", asRuntimeStore(store), [
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

  it("chat is rejected with FEATURE_DISABLED", async () => {
    await expectDisabled(() => aiChat("full_lens", "hi", asRuntimeStore(store)));
  });

  it("an unknown lens still answers not-found before the provider check", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(null);
    await expect(aiChat("missing", "hi", asRuntimeStore(store))).rejects.toThrow(NotFoundError);
  });
});
