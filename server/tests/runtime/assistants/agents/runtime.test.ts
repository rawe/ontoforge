/**
 * The AI engine with a scripted model (the "mock the model" unit plan of
 * session 11): toolset computation (allowlist ∩ availability), prompt
 * assembly, the tool-error self-correction loop vs abort, trace shape,
 * turns on a thread (what the model sees, what the thread keeps), and the
 * FEATURE_DISABLED rejection without a provider.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_AGENT_CONFIG, setAiModel, type AgentConfig } from "../../../../src/core/ai.js";
import { setEmbeddingProvider } from "../../../../src/core/embedding.js";
import { NotFoundError, ValidationError } from "../../../../src/core/exceptions.js";
import {
  CHAT_TOOLS,
  describeSchema,
  runAgentChat,
} from "../../../../src/runtime/assistants/agents/runtime.js";
import { TURNS_PER_THREAD, TURNS_THE_MODEL_SEES, type GraphThread } from "../../../../src/assistants/index.js";
import { graphValues, newGraphThread } from "../../../assistants/threads/graphThread.js";
import { invalidateLoadedSchemaCache, loadSchema } from "../../../../src/runtime/schemaCache.js";
import { FakeToolCallingModel, toolCallMessage } from "../../aiHelpers.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
  makeRelation,
  makeScopedSchema,
  makeUnscopedSchema,
  rankedEntry,
  withManagedIndices,
  type MockRuntimeStore,
} from "../../helpers.js";

type Row = Record<string, unknown>;

/** A new thread of the default agent, as a chat without a thread id starts one. */
async function newThread(): Promise<GraphThread> {
  return newGraphThread();
}

/** One turn with the built-in default agent, on a new thread unless one is given. */
const aiChat = async (
  lensKey: string,
  message: string,
  runtime: Parameters<typeof runAgentChat>[3],
  thread?: GraphThread,
) => runAgentChat(DEFAULT_AGENT_CONFIG, lensKey, message, runtime, thread ?? (await newThread()));

/** The same turn on a new thread, with the tool calls its events announced, in order. */
async function tracedChat(lensKey: string, message: string, runtime: Parameters<typeof runAgentChat>[3]) {
  const toolCalls: Row[] = [];
  const result = await runAgentChat(DEFAULT_AGENT_CONFIG, lensKey, message, runtime, await newThread(), {
    onToolEvent: async (event) => {
      if (event.type === "agent.tool_call") toolCalls.push({ tool: event.tool, args: event.args });
    },
  });
  return { ...result, toolCalls };
}

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

const fakeEmbedding = { dimensions: 4, modelId: "fake:4", embed: async () => [0, 0, 0, 0] };

/** What the managed person indices read of the fixture: its own fields
 * and the `bio` document. */
const PERSON_INDEX_SCHEMA = {
  entityTypes: {
    person: {
      key: "person",
      displayName: "Person",
      nameProperty: "name",
      properties: {
        name: { key: "name", displayName: "Name", dataType: "string" },
        bio: { key: "bio", displayName: "Bio", dataType: "document" },
      },
    },
  },
  relationTypes: {},
};

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
    // The entity search's response: no index to search, nothing ran.
    expect(payload).toEqual({ ran: [], items: [], limitations: [] });
    for (const tool of fake.boundTools[0]! as { name: string; description: string; schema: { shape: Record<string, unknown> } }[]) {
      if (!["search", "search_documents"].includes(tool.name)) continue;
      expect(tool.description).toContain("Returns ran (methods that ran), items and limitations");
      expect(tool.description).toContain("scores (each method that found it: semantic, similarity 0.75 to 1");
      expect(tool.description).toContain("fixed similarity floor");
      expect(tool.description).not.toMatch(/relativeScore|strategy|evidence|adapter|list_search_indices/i);
      expect(tool.description.length).toBeLessThanOrEqual(2000);
      expect(Object.keys(tool.schema.shape).sort()).toEqual(
        (tool.name === "search"
          ? ["query", "types", "filters", "limit"]
          : ["query", "types", "documents", "filters", "limit", "per_entity", "text"]
        ).sort(),
      );
    }
  });

  it("run_saved_query answers a final search step with the entity search's response", async () => {
    withEmptySearchIndices(store);
    store.getSavedQueries.mockResolvedValue([{
      key: "find_people", name: "Find people", description: "Find people",
      steps: JSON.stringify([{ name: "people", type: "search", types: ["person"], query: "engineer" }]),
      parameters: "[]",
    }]);
    const fake = installFake([toolCallMessage("run_saved_query", { query_key: "find_people" }), new AIMessage("Done")]);
    await aiChat("full_lens", "run the query", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    // No index to search: nothing ran, and the type is named as a limitation.
    expect(payload).toEqual({
      ran: [],
      items: [],
      limitations: [expect.objectContaining({ code: "not-searchable", types: ["person"] })],
    });
  });

  it("search tools run both methods with an embedding provider, semantic under the fixed floor", async () => {
    setEmbeddingProvider(fakeEmbedding);
    store.supportsKeywordRanking.mockReturnValue(true);
    withManagedIndices(store, PERSON_INDEX_SCHEMA, fakeEmbedding.modelId, (query) =>
      query.generationId.endsWith("semantic") ? [rankedEntry("a", 0.8), rankedEntry("b", 0.7)] : [],
    );
    store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { _id: id, _entityTypeKey: "person", name: id }])),
    );
    const fake = installFake([
      toolCallMessage("search", { query: "engineer", types: ["person"], filters: { name: "a" } }),
      new AIMessage("Found."),
    ]);
    await aiChat("full_lens", "find an engineer", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload.ran).toEqual(["semantic", "keyword"]);
    // b is below the floor of 0.75.
    expect((payload.items as Row[]).map((item) => (item.entity as Row)._id)).toEqual(["a"]);
    const semantic = store.indices.rankEntries.mock.calls.find(([query]) => query.generationId === "person~default/semantic")!;
    expect(semantic[0].conditions).toEqual([expect.objectContaining({ propertyKey: "name", value: "a" })]);
  });

  it("search tools run keyword alone without an embedding provider", async () => {
    store.supportsKeywordRanking.mockReturnValue(true);
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithDocument());
    withManagedIndices(store, PERSON_INDEX_SCHEMA, undefined, () => []);
    const fake = installFake([
      toolCallMessage("search_documents", { query: "engineer" }),
      new AIMessage("Found."),
    ]);
    await aiChat("full_lens", "find an engineer", asRuntimeStore(store));
    const payload = JSON.parse(String(fake.calls[1]!.find((m) => m instanceof ToolMessage)!.content));
    expect(payload).toEqual({ ran: ["keyword"], items: [], limitations: [] });
    expect(store.indices.rankEntries.mock.calls.map(([query]) => query.generationId)).toEqual(["person~bio/keyword"]);
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

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store), await newThread());

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

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store), await newThread());

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

    const result = await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store), await newThread());

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

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store), await newThread());

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
    withManagedIndices(store, PERSON_INDEX_SCHEMA, fakeEmbedding.modelId, (query) =>
      query.generationId === "person~bio/semantic"
        ? [rankedEntry("ent-1", 0.91, { startChar: 22, charLength: 21, text: "Alice joined in 2019." })]
        : [],
    );
    store.getEntitiesByIds.mockResolvedValue({
      "ent-1": makeEntity({ name: "Alice", bio: BIO }),
    });

    const result = await tracedChat("full_lens", "when did Alice join?", asRuntimeStore(store));

    expect(result.reply).toBe("In 2019.");
    const toolMessages = fake.calls[1]!.filter((m) => m instanceof ToolMessage);
    const payload = JSON.parse(String(toolMessages[0]!.content)) as Row;
    expect(payload.items).toEqual([
      {
        rank: 1,
        entity: { _id: "ent-1", _entityTypeKey: "person", name: "Alice" },
        passage: {
          property: "bio",
          ordinal: 0,
          charOffset: 22,
          charLength: 21,
          scores: { semantic: 0.91 },
          text: "Alice joined in 2019.",
        },
      },
    ]);
    // Only the passage index ranks — the entity's own index is not consulted.
    expect(store.indices.rankEntries.mock.calls.map(([query]) => query.generationId).sort()).toEqual([
      "person~bio/keyword",
      "person~bio/semantic",
    ]);
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

    await runAgentChat(config, "full_lens", "hello", asRuntimeStore(store), await newThread());

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

    const result = await tracedChat("full_lens", "list them", asRuntimeStore(store));

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

    const result = await tracedChat("full_lens", "find Alice", asRuntimeStore(store));

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
// Trace shape and turns on a thread
// ---------------------------------------------------------------------------

describe("chat trace and turns on a thread", () => {
  it("trace: ordered tool names with arguments", async () => {
    store.listEntities.mockResolvedValue([[makeEntity({ name: "Alice" })], 1]);
    store.executeOql.mockResolvedValue([["c"], [{ c: 2 }]]);
    installFake([
      toolCallMessage("list_entities", { entity_type_key: "person" }, "c1"),
      toolCallMessage("execute_query", { query: "MATCH (p:person) RETURN count(p)" }, "c2"),
      new AIMessage("done"),
    ]);

    const result = await tracedChat("full_lens", "explore", asRuntimeStore(store));

    expect(result.toolCalls).toEqual([
      { tool: "list_entities", args: { entity_type_key: "person" } },
      { tool: "execute_query", args: { query: "MATCH (p:person) RETURN count(p)" } },
    ]);
  });

  it("a turn continues its thread: the model sees earlier turns with their tool calls and results", async () => {
    store.listEntities.mockResolvedValue([[makeEntity({ name: "Alice", age: 30 })], 1]);
    const fake = installFake([
      toolCallMessage("list_entities", { entity_type_key: "person" }),
      new AIMessage("There is one person: Alice."),
      new AIMessage("She is 30."),
    ]);
    const thread = await newThread();

    await aiChat("full_lens", "Who is there?", asRuntimeStore(store), thread);
    const result = await aiChat("full_lens", "And how old is she?", asRuntimeStore(store), thread);

    expect(result.reply).toBe("She is 30.");
    const messages = fake.calls[2]!;
    expect(messages.map((m) => m.getType())).toEqual(["system", "human", "ai", "tool", "ai", "human"]);
    expect(String(messages[1]!.content)).toBe("Who is there?");
    expect(String(messages[3]!.content)).toContain("Alice");
    expect(String(messages[5]!.content)).toBe("And how old is she?");
    // Only the turn's model calls ran; earlier tool work was not repeated.
    expect(store.listEntities).toHaveBeenCalledTimes(1);
  });

  it(`the model sees the last ${TURNS_THE_MODEL_SEES} turns`, async () => {
    const fake = installFake([new AIMessage("ok")]);
    const thread = await newThread();
    for (let i = 1; i <= TURNS_THE_MODEL_SEES + 2; i++) {
      await aiChat("full_lens", `question ${i}`, asRuntimeStore(store), thread);
    }

    const questions = fake.calls.at(-1)!.filter((m) => m.getType() === "human").map((m) => String(m.content));
    expect(questions).toHaveLength(TURNS_THE_MODEL_SEES);
    expect(questions[0]).toBe("question 3");
    expect(questions.at(-1)).toBe(`question ${TURNS_THE_MODEL_SEES + 2}`);
  });

  it(`the thread keeps at most ${TURNS_PER_THREAD} turns`, async () => {
    installFake(Array.from({ length: TURNS_PER_THREAD + 2 }, (_, i) => new AIMessage(`answer ${i + 1}`)));
    const thread = await newThread();
    for (let i = 1; i <= TURNS_PER_THREAD + 2; i++) {
      await aiChat("full_lens", `question ${i}`, asRuntimeStore(store), thread);
    }

    const messages = (await graphValues(thread)).messages as HumanMessage[];
    const questions = messages.filter((m) => m.getType() === "human").map((m) => String(m.content));
    expect(questions).toHaveLength(TURNS_PER_THREAD);
    expect(questions[0]).toBe("question 3");
    expect(messages).toHaveLength(2 * TURNS_PER_THREAD);
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

// ---------------------------------------------------------------------------
// The shared entities event
// ---------------------------------------------------------------------------

describe("entities event", () => {
  /** One turn with the default agent on a new thread, with every event it streamed, in order. */
  async function eventsOf(lensKey: string, message = "who?") {
    const events: Row[] = [];
    await runAgentChat(DEFAULT_AGENT_CONFIG, lensKey, message, asRuntimeStore(store), await newThread(), {
      onToolEvent: async (event) => { events.push(structuredClone(event)); },
    });
    return events;
  }

  const entityEvents = (events: Row[]) => events.filter((e) => e.type === "entities");
  const cardsOf = (events: Row[]) => entityEvents(events).flatMap((e) => e.entities as Row[]);

  it("follows the tool_result of an entity tool, which stays unchanged", async () => {
    const alice = makeEntity({ name: "Alice", age: 30 }, "person", "p1");
    store.getEntity.mockResolvedValue(alice);
    const fake = installFake([
      toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "p1" }),
      new AIMessage("Alice is 30."),
    ]);

    const events = await eventsOf("full_lens");

    expect(events.map((e) => e.type)).toEqual(["agent.tool_call", "agent.tool_result", "entities"]);
    const result = events[1]!.result as Row;
    expect(result).toEqual(alice);
    expect(events[2]).toEqual({
      type: "entities",
      entities: [{
        ref: "E1", id: "p1", type: "person", typeName: "Person", label: "Alice",
        fields: [{ name: "Age", value: "30" }], evidence: true,
      }],
      links: [],
    });
    // The model's tool message is the plain result, without cards.
    const toolMessage = fake.calls[1]!.find((m) => m instanceof ToolMessage)!;
    expect(String(toolMessage.content)).toBe(JSON.stringify(result));
  });

  it("keeps refs stable across parallel calls and repeated entities, sending each card once", async () => {
    const rows: Record<string, Row> = {
      p1: makeEntity({ name: "Alice" }, "person", "p1"),
      p2: makeEntity({ name: "Bob" }, "person", "p2"),
      p3: makeEntity({ name: "Cleo" }, "person", "p3"),
    };
    store.getEntity.mockImplementation(async (_type: string, id: string) => rows[id] ?? null);
    store.listEntities.mockResolvedValue([[rows.p2, rows.p1, rows.p3], 3]);
    installFake([
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "get_entity", args: { entity_type_key: "person", entity_id: "p1" }, id: "c1", type: "tool_call" },
          { name: "get_entity", args: { entity_type_key: "person", entity_id: "p2" }, id: "c2", type: "tool_call" },
        ],
      }),
      toolCallMessage("list_entities", { entity_type_key: "person" }, "c3"),
      toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "p1" }, "c4"),
      new AIMessage("three people"),
    ]);

    const events = await eventsOf("full_lens");

    // The repeated get_entity sends nothing new.
    expect(entityEvents(events)).toHaveLength(3);
    const cards = cardsOf(events);
    expect(cards.map((c) => c.ref).sort()).toEqual(["E1", "E2", "E3"]);
    const refOf = Object.fromEntries(cards.map((c) => [c.id, c.ref]));
    expect(new Set([refOf.p1, refOf.p2])).toEqual(new Set(["E1", "E2"]));
    // The list met p1 and p2 again: only p3 is new, with the next ref.
    expect(entityEvents(events)[2]!.entities).toEqual([expect.objectContaining({ id: "p3", ref: "E3" })]);
  });

  it("links neighbours as stored and skips entity types the lens does not show", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeScopedSchema());
    invalidateLoadedSchemaCache();
    store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "p1"));
    store.getNeighbors.mockResolvedValue([
      { relation: { ...makeRelation({}, { relationId: "r1" }), direction: "outgoing" },
        entity: makeEntity({ name: "Acme" }, "company", "c1") },
      { relation: { ...makeRelation({}, { relationId: "r2" }), direction: "incoming" },
        entity: makeEntity({ name: "Bob" }, "person", "p2") },
      // A department over an in-lens relation (data the lens cannot
      // produce): dropped, no card, no link.
      { relation: { ...makeRelation({}, { relationId: "r3" }), direction: "outgoing" },
        entity: makeEntity({ name: "Sales", code: "S" }, "department", "d1") },
    ]);
    installFake([
      toolCallMessage("get_neighbors", { entity_type_key: "person", entity_id: "p1" }),
      new AIMessage("Alice works for Acme."),
    ]);

    const events = await eventsOf("hr_view");

    // The tool result does not carry it either.
    const result = events.find((e) => e.type === "agent.tool_result")!.result as Row;
    expect((result.neighbors as Row[]).map((n) => (n.entity as Row)._id)).toEqual(["c1", "p2"]);
    const [event] = entityEvents(events);
    expect((event!.entities as Row[]).map((c) => [c.ref, c.id])).toEqual([["E1", "p1"], ["E2", "c1"], ["E3", "p2"]]);
    expect(event!.links).toEqual([
      { id: "r1", from: "E1", to: "E2", type: "works_for", label: "works for" },
      { id: "r2", from: "E3", to: "E1", type: "works_for", label: "works for" },
    ]);
  });

  it("search items become cards", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithDocument());
    invalidateLoadedSchemaCache();
    setEmbeddingProvider(fakeEmbedding);
    withManagedIndices(store, PERSON_INDEX_SCHEMA, fakeEmbedding.modelId, (query) =>
      query.generationId === "person~bio/semantic" ? [rankedEntry("ent-1", 0.9, { startChar: 0, charLength: 5, text: "Alice" })] : [],
    );
    store.getEntitiesByIds.mockResolvedValue({ "ent-1": makeEntity({ name: "Alice", bio: "Alice joined." }) });
    installFake([toolCallMessage("search_documents", { query: "joined" }), new AIMessage("Alice.")]);

    const events = await eventsOf("full_lens");

    // The document property is no field.
    expect(cardsOf(events)).toEqual([{
      ref: "E1", id: "ent-1", type: "person", typeName: "Person", label: "Alice", fields: [], evidence: true,
    }]);
  });

  it("non-entity tools and failed calls send nothing", async () => {
    store.getEntity.mockImplementation(async (_type: string, id: string) =>
      id === "ent-1" ? makeEntity({ name: "Alice", bio: "Alice joined." }) : null);
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schemaWithDocument());
    invalidateLoadedSchemaCache();
    installFake([
      toolCallMessage("get_schema", {}, "c1"),
      toolCallMessage("get_document", { entity_type_key: "person", entity_id: "ent-1", property_key: "bio" }, "c2"),
      toolCallMessage("get_entity", { entity_type_key: "person", entity_id: "gone" }, "c3"),
      toolCallMessage("list_entities", { entity_type_key: "person", filters: { anyOf: [] } }, "c4"),
      new AIMessage("nothing"),
    ]);

    const events = await eventsOf("full_lens");

    expect(events.map((e) => e.type)).toEqual(Array(4).fill(["agent.tool_call", "agent.tool_result"]).flat());
  });
});
