/**
 * The retriever-agent pipeline with a fake model and a mocked search
 * engine: exactly planner + answer model, the stream's events and
 * diagnostics `meta` shapes (contract), the follow-up token, planner
 * failures before any answer, cancellation, and follow-up references.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ invoke: vi.fn(), stream: vi.fn(), withConfig: vi.fn() }));
const engine = vi.hoisted(() => ({
  rankThroughIndices: vi.fn(),
  describeMatches: vi.fn(async () => new Map()),
  availableModes: vi.fn(() => ["keyword"]),
  indexStoreOf: vi.fn(),
  searchableIndices: vi.fn(),
  searchIndexCatalog: vi.fn(),
}));
vi.mock("../../../src/config.js", () => ({
  settings: { AI_PROVIDER: "fake", AI_MODEL: "test", AI_BASE_URL: "http://unused" },
}));
vi.mock("../../../src/core/ai.js", () => ({ createAiModel: vi.fn(() => fake) }));
vi.mock("../../../src/runtime/search/indexSearch.js", () => engine);

import { createAiModel } from "../../../src/core/ai.js";
import type { RuntimeStore, SearchIndexRecord, SearchIndexStore } from "../../../src/core/ports.js";
import type { LoadedSchema } from "../../../src/runtime/schemaCache.js";
import { PLANNER_RESPONSE_FORMAT } from "../../../src/runtime/retrieverAgents/plan.js";
import { chat, type RunnableAgent } from "../../../src/runtime/retrieverAgents/runtime.js";
import { CONFIG, LENS, SCHEMA } from "./fixture.js";

const store = {
  ontologyKey: "o",
  listEntities: vi.fn(async () => [[{ _id: "ada", name: "Berlin" }], 1]),
  listRelations: vi.fn(async () => [[{ fromEntityId: "ada", toEntityId: "ada" }], 1]),
  getEntitiesByIds: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { _id: id, name: "Ada", email: "a@x" }]))),
} as unknown as RuntimeStore;

const agent: RunnableAgent = {
  key: "people",
  config: CONFIG,
  scope: {
    config: CONFIG,
    lens: LENS,
    loaded: { scoped: SCHEMA, full: SCHEMA } as unknown as LoadedSchema,
    store,
    indexStore: {} as SearchIndexStore,
    records: [{ key: "person~default", definition: { entityType: "person" } } as unknown as SearchIndexRecord],
  },
};

const sub = (overrides: Record<string, unknown> = {}) => ({
  indices: ["person~default"],
  relations: [],
  query: "",
  variants: [],
  mode: "keyword",
  filters: [{ id: "city", value: "Berlin", quote: "Berlin" }],
  previous: null,
  ...overrides,
});
const planned = (subQueries: unknown[]) => ({ content: JSON.stringify({ subQueries, unsupportedReason: null }), usage_metadata: { input_tokens: 1, output_tokens: 2 } });

async function run(message: string, diagnostics = true, turnToken?: string, signal = new AbortController().signal) {
  const events: Record<string, unknown>[] = [];
  const result = await chat("all", agent, message, [], { signal, onToolEvent: async (event) => { events.push(event); } }, turnToken, diagnostics);
  return { events, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.withConfig.mockReturnValue({ invoke: fake.invoke });
  fake.invoke.mockResolvedValue(planned([sub()]));
  fake.stream.mockImplementation(async () =>
    (async function* () {
      yield { content: "Ada", usage_metadata: { input_tokens: 1, output_tokens: 1 } };
      yield { content: "." };
    })(),
  );
});

describe("retriever agent pipeline", () => {
  it("performs exactly planner + answer, streams the reply and emits the contract's diagnostics", async () => {
    const { events, result } = await run("Everyone in Berlin");
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.withConfig).toHaveBeenCalledWith({ response_format: PLANNER_RESPONSE_FORMAT });
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(createAiModel).toHaveBeenCalledWith("fake", "test", "http://unused", { maxRetries: 0 });
    expect(result.reply).toBe(events.filter((e) => e.type === "delta").map((e) => e.text).join(""));
    expect(events.filter((e) => e.type === "phase").map((e) => `${e.phase}:${e.status}`)).toEqual([
      "plan:start", "plan:end", "retrieve:start", "retrieve:end", "answer:start", "answer:end",
    ]);
    const plan = events.find((e) => e.type === "meta" && e.plan)!.plan as { subQueries: Record<string, unknown>[] };
    expect(plan.subQueries).toEqual([
      { indices: ["person~default"], relations: [], query: "", variants: [], mode: "keyword", filters: [{ id: "city", value: "Berlin", quote: "Berlin" }], previous: null },
    ]);
    const retrieved = events.find((e) => e.type === "meta" && e.results)!;
    expect(retrieved.results).toEqual([
      { entityId: "ada", entityType: "person", label: "Ada", subQuery: 0, answerFields: { name: "Ada", email: "a@x" } },
    ]);
    expect(retrieved.searchCalls).toBe(0);
    expect(retrieved.limitations).toEqual([]);
    const summary = events.find((e) => e.type === "meta" && e.llmCalls !== undefined)!;
    expect(summary.llmCalls).toBe(2);
    expect(Object.keys(summary.timings as object)).toEqual(
      expect.arrayContaining(["plan", "planModel", "validation", "retrieve", "search", "context", "answer", "firstDelta", "answerModel", "total"]),
    );
    const calls = summary.modelIO as { phase: string; systemPrompt: string; input: string }[];
    expect(calls.map((c) => c.phase)).toEqual(["plan", "answer"]);
    expect(calls[0]!.input).toBe(fake.invoke.mock.calls[0]![0][1].content);
    expect(calls[1]!.systemPrompt).toBe(fake.stream.mock.calls[0]![0][0].content);
    expect(events.at(-1)).toEqual({ type: "meta", turnToken: expect.any(String) });
  });

  it("without diagnostics streams progress, answer and only the turn token as metadata", async () => {
    const { events } = await run("Everyone in Berlin", false);
    expect(events.filter((e) => e.type === "meta")).toEqual([{ type: "meta", turnToken: expect.any(String) }]);
    expect(events.some((e) => e.type === "phase")).toBe(true);
    expect(events.some((e) => e.type === "delta")).toBe(true);
  });

  it("shows the planner's output before a parse failure and never calls the answer model", async () => {
    fake.invoke.mockResolvedValue({ content: '{"subQueries":[', usage_metadata: { output_tokens: 1800 }, response_metadata: { finish_reason: "length" } });
    const events: Record<string, unknown>[] = [];
    await expect(chat("all", agent, "Who?", [], { signal: new AbortController().signal, onToolEvent: async (e) => { events.push(e); } }, undefined, true)).rejects.toThrow("token limit");
    expect(events.find((e) => e.type === "meta" && e.modelIO)?.modelIO).toEqual([
      expect.objectContaining({ output: '{"subQueries":[', finishReason: "length", usage: { output_tokens: 1800 } }),
    ]);
    expect(fake.stream).not.toHaveBeenCalled();
  });

  it("rejects an invented query before any search or answer", async () => {
    fake.invoke.mockResolvedValue(planned([sub({ query: "revenue in millions", filters: [] })]));
    await expect(run("Who works in Berlin?", false)).rejects.toThrow("user evidence");
    expect(engine.rankThroughIndices).not.toHaveBeenCalled();
    expect(fake.stream).not.toHaveBeenCalled();
  });

  it("propagates cancellation before planning", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run("Who?", false, undefined, controller.signal)).rejects.toBeDefined();
    expect(fake.invoke).not.toHaveBeenCalled();
  });

  it("a follow-up refers to the previous exact results through its token", async () => {
    const first = await run("Everyone in Berlin", false);
    const token = (first.events.at(-1) as { turnToken: string }).turnToken;
    engine.rankThroughIndices.mockResolvedValue([]);
    fake.invoke.mockResolvedValue(planned([sub({ query: "CTO", filters: [], previous: { filterId: null, quote: "these people" } })]));
    await run("Which of these people is CTO?", false, token);
    // The search is restricted to the previous result.
    expect(engine.rankThroughIndices.mock.calls[0]![2].targets[0].entityIds).toEqual(["ada"]);
    await expect(run("Which of these people is CTO?", false, "unknown-token")).rejects.toThrow("expired");
  });
});
