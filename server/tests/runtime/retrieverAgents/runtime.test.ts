/**
 * The retriever-agent pipeline with a fake model and a mocked search
 * engine: exactly planner + answer model, the stream's events and
 * diagnostics `meta` shapes (contract), the follow-up token, planner
 * failures before any answer, cancellation, follow-up references, and the
 * one repeated plan for a follow-up whose first plan searched nothing.
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
import { PLANNER, PLANNER_RESPONSE_FORMAT, REPLAN } from "../../../src/runtime/retrieverAgents/plan.js";
import { chat, retrieveQuestion, type RunnableAgent } from "../../../src/runtime/retrieverAgents/runtime.js";
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

  it("runs the planner's own query words; a filter without a user quote is dropped with a limitation", async () => {
    engine.rankThroughIndices.mockResolvedValue([]);
    fake.invoke.mockResolvedValue(planned([
      sub({ query: "events about artificial intelligence", filters: [{ id: "city", value: "Paris", quote: "Paris" }] }),
    ]));
    const { events } = await run("Which events are about artificial intelligence?");
    expect(events.at(-1)).toEqual({ type: "meta", turnToken: expect.any(String) });
    expect(engine.rankThroughIndices.mock.calls[0]![2].query).toBe("events about artificial intelligence");
    // No filter applied: no restriction.
    expect(engine.rankThroughIndices.mock.calls[0]![2].targets[0].entityIds).toBeNull();
    const limitations = events.find((e) => e.type === "meta" && e.results)!.limitations as string[];
    expect(limitations).toContain(
      'The condition "lives in City Name: Paris" was not applied: the value is not stated verbatim in a user message.',
    );
    expect(fake.stream).toHaveBeenCalledTimes(1);
  });

  it("a follow-up on searched results runs as a fresh search with the history, never failing the turn", async () => {
    engine.rankThroughIndices.mockResolvedValue([]);
    fake.invoke.mockResolvedValue(planned([sub({ query: "CTO at ACME", filters: [] })]));
    const first = await run("Who is CTO at ACME?", false);
    const token = (first.events.at(-1) as { turnToken: string }).turnToken;
    // The planner points at the previous (searched) results with assistant words.
    fake.invoke.mockResolvedValue(planned([sub({ query: "CTO at ACME since", filters: [], previous: { filterId: null, quote: "that person" } })]));
    const events: Record<string, unknown>[] = [];
    const history = [{ role: "user" as const, content: "Who is CTO at ACME?" }, { role: "assistant" as const, content: "Ada is CTO at ACME — that person joined in 2020." }];
    await chat("all", agent, "Since when?", history, { signal: new AbortController().signal, onToolEvent: async (e) => { events.push(e); } }, token, true);
    const plannerInput = JSON.parse(fake.invoke.mock.calls.at(-1)![0][1].content);
    expect(plannerInput.history).toEqual(history);
    expect(plannerInput.previousVerifiedResults).toBeNull();
    const second = engine.rankThroughIndices.mock.calls.at(-1)![2];
    expect(second.query).toBe("CTO at ACME since");
    expect(second.targets[0].entityIds).toBeNull();
    const limitations = events.find((e) => e.type === "meta" && e.results)!.limitations as string[];
    expect(limitations.some((text) => text.includes("reference to previous results was ignored"))).toBe(true);
    expect(events.at(-1)).toEqual({ type: "meta", turnToken: expect.any(String) });
  });

  describe("a follow-up whose first plan searched nothing", () => {
    const unsupported = { content: JSON.stringify({ subQueries: [], unsupportedReason: "already answered" }) };
    const history = [
      { role: "user" as const, content: "Who works at ACME and lives in Berlin?" },
      { role: "assistant" as const, content: "Bob works at ACME and lives in Berlin." },
    ];
    async function followUp() {
      const events: Record<string, unknown>[] = [];
      await chat("all", agent, "And what is his role there?", history, { signal: new AbortController().signal, onToolEvent: async (e) => { events.push(e); } }, undefined, true);
      const summary = events.find((e) => e.type === "meta" && e.llmCalls !== undefined)!;
      const limitations = events.find((e) => e.type === "meta" && e.results)!.limitations as string[];
      return { events, summary, limitations };
    }

    it("is planned once more with the appended instruction, and the second plan is used", async () => {
      engine.rankThroughIndices.mockResolvedValue([]);
      fake.invoke.mockResolvedValueOnce(unsupported).mockResolvedValueOnce(planned([sub({ query: "Bob role at ACME", filters: [] })]));
      const { summary, limitations } = await followUp();
      expect(fake.invoke).toHaveBeenCalledTimes(2);
      expect(fake.invoke.mock.calls[0]![0][0].content).toBe(PLANNER);
      expect(fake.invoke.mock.calls[1]![0][0].content).toBe(`${PLANNER}\n${REPLAN}`);
      // Same planner input both times.
      expect(fake.invoke.mock.calls[1]![0][1].content).toBe(fake.invoke.mock.calls[0]![0][1].content);
      expect(engine.rankThroughIndices.mock.calls[0]![2].query).toBe("Bob role at ACME");
      expect(fake.stream).toHaveBeenCalledTimes(1);
      expect(summary.llmCalls).toBe(3);
      expect((summary.modelIO as { phase: string }[]).map((c) => c.phase)).toEqual(["plan", "replan", "answer"]);
      expect(limitations).toContain("Planning was repeated once: the first plan for this follow-up searched nothing.");
    });

    it("still empty, answers as unsupported", async () => {
      fake.invoke.mockResolvedValue(unsupported);
      const { summary, limitations } = await followUp();
      expect(fake.invoke).toHaveBeenCalledTimes(2);
      expect(engine.rankThroughIndices).not.toHaveBeenCalled();
      const answerInput = JSON.parse(fake.stream.mock.calls[0]![0][1].content);
      expect(answerInput.unsupportedReason).toBe("already answered");
      expect(answerInput.searches).toEqual([]);
      expect(summary.llmCalls).toBe(3);
      expect(limitations).toContain(
        "Planning was repeated once: the first plan for this follow-up searched nothing; the repeated plan searched nothing either.",
      );
    });

    it("a failing repeated plan leaves the first one standing", async () => {
      fake.invoke.mockResolvedValueOnce(unsupported).mockResolvedValueOnce({ content: "not json" });
      const { limitations } = await followUp();
      const answerInput = JSON.parse(fake.stream.mock.calls[0]![0][1].content);
      expect(answerInput.unsupportedReason).toBe("already answered");
      expect(limitations).toContain("Planning was repeated once: the first plan for this follow-up searched nothing; the repeated plan failed.");
    });

    it("a first question answered as unsupported is not planned again", async () => {
      fake.invoke.mockResolvedValue(unsupported);
      const { events } = await run("What is Ada's salary?");
      expect(fake.invoke).toHaveBeenCalledTimes(1);
      expect(events.find((e) => e.type === "meta" && e.llmCalls !== undefined)!.llmCalls).toBe(2);
    });
  });

  it("asks the answer model to answer in the language of the current question", async () => {
    await run("Everyone in Berlin", false);
    expect(fake.stream.mock.calls[0]![0][0].content).toContain("in the language of the user's current question");
  });

  it("tells the answer model that history is no evidence and an unmatched filtered result satisfies only the filter", async () => {
    await run("Everyone in Berlin", false);
    const prompt = fake.stream.mock.calls[0]![0][0].content as string;
    expect(prompt).toContain("The history only tells you what the question refers to");
    expect(prompt).toContain("it is never evidence — do not confirm, dispute or add facts from it");
    expect(prompt).toContain("A match with filters but no index entry (no \"text\") satisfies only those filters, not its search's query");
  });

  it("tells the answer model to keep internals out of the answer and state facts in plain words", async () => {
    await run("Everyone in Berlin", false);
    const prompt = fake.stream.mock.calls[0]![0][0].content as string;
    expect(prompt).toContain("Never mention sub-queries, filter ids or paths, index keys or entity ids");
    expect(prompt).toContain('state facts in plain words (for example "lives in Berlin")');
    expect(prompt).not.toContain("IDs only where needed");
  });

  it("gives the answer model the filter facts each result satisfies, in plain words without ids or paths", async () => {
    await run("Everyone in Berlin", false);
    const content = fake.stream.mock.calls[0]![0][1].content as string;
    const answerInput = JSON.parse(content);
    expect(answerInput.searches).toEqual([{ query: "", relations: [], filters: ["lives in City Name: Berlin"] }]);
    expect(answerInput.results).toEqual([
      { type: "Person", label: "Ada", fields: { Name: "Ada", Email: "a@x" }, matches: [{ search: "", filters: ["lives in City Name: Berlin"] }] },
    ]);
    for (const internal of ['"ada"', '"city"', "lives_in", "→", "subQuery", '"id"']) expect(content).not.toContain(internal);
    expect(fake.stream.mock.calls[0]![0][0].content).toContain("exact filters the entity satisfies");
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

describe("retrieve", () => {
  const signal = () => new AbortController().signal;

  it("makes exactly one planning call, no answer call, and returns chat's results in chat's order", async () => {
    engine.rankThroughIndices.mockResolvedValue([]);
    const { events } = await run("Everyone in Berlin");
    const chatRows = events.find((e) => e.type === "meta" && e.results)!.results as { entityId: string }[];
    vi.clearAllMocks();
    fake.withConfig.mockReturnValue({ invoke: fake.invoke });
    fake.invoke.mockResolvedValue(planned([sub()]));

    const response = await retrieveQuestion(agent, "Everyone in Berlin", false, signal());
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.stream).not.toHaveBeenCalled();
    expect(response.results.map((r) => r.entityId)).toEqual([...new Set(chatRows.map((r) => r.entityId))]);
    expect(response).toEqual({
      results: [
        {
          entityId: "ada",
          entityType: "person",
          label: "Ada",
          conditions: [{ filter: "city", value: "Berlin", text: "lives in City Name: Berlin" }],
          matched: null,
        },
      ],
      limitations: [],
    });
    // Single-shot: no conversation, nothing to refer to.
    const input = JSON.parse(fake.invoke.mock.calls[0]![0][1].content);
    expect(input.history).toEqual([]);
    expect(input.previousVerifiedResults).toBeNull();
  });

  it("reports diagnostics only on request: the plan, search calls, timings and the one planning call", async () => {
    const response = await retrieveQuestion(agent, "Everyone in Berlin", true, signal());
    const diagnostics = response.diagnostics!;
    expect(diagnostics.plan.subQueries).toHaveLength(1);
    expect(diagnostics.searchCalls).toBe(0);
    expect(Object.keys(diagnostics.timings).sort()).toEqual(["plan", "planModel", "retrieve", "search", "total", "validation"]);
    expect(diagnostics.modelIO.map((call) => call.phase)).toEqual(["plan"]);
    expect(diagnostics.modelIO[0]!.input).toBe(fake.invoke.mock.calls[0]![0][1].content);
  });

  it("answers an unsupported question with no results and its reason, not as an error", async () => {
    fake.invoke.mockResolvedValue({ content: JSON.stringify({ subQueries: [], unsupportedReason: "No salaries are stored." }) });
    const response = await retrieveQuestion(agent, "What is Ada's salary?", false, signal());
    expect(response).toEqual({ results: [], limitations: [], unsupportedReason: "No salaries are stored." });
    expect(fake.invoke).toHaveBeenCalledTimes(1);
  });

  it("names plan omissions as limitations", async () => {
    fake.invoke.mockResolvedValue(planned([sub({ filters: [{ id: "city", value: "Paris", quote: "Paris" }] })]));
    const response = await retrieveQuestion(agent, "Everyone in Berlin", false, signal());
    expect(response.limitations).toContain(
      'The condition "lives in City Name: Paris" was not applied: the value is not stated verbatim in a user message.',
    );
  });

  it("refuses as chat does: a failed or malformed plan, no retry", async () => {
    fake.invoke.mockRejectedValueOnce(new Error("boom"));
    await expect(retrieveQuestion(agent, "Who?", false, signal())).rejects.toThrow("Planning model failed; no automatic retry.");
    fake.invoke.mockResolvedValueOnce({ content: "not json" });
    await expect(retrieveQuestion(agent, "Who?", false, signal())).rejects.toThrow();
    expect(fake.invoke).toHaveBeenCalledTimes(2);
  });

  it("refuses a planner input over the cap; the default agent's refusal says a configured agent is needed", async () => {
    const big = "x".repeat(25_000);
    await expect(retrieveQuestion(agent, big, false, signal())).rejects.toThrow("Planning context exceeds the limit");
    const fallback = { ...agent, key: "_default" };
    await expect(retrieveQuestion(fallback, big, false, signal())).rejects.toThrow(
      "This lens is too large for the default retriever agent",
    );
    expect(fake.invoke).not.toHaveBeenCalled();
  });

  it("stops on cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(retrieveQuestion(agent, "Who?", false, controller.signal)).rejects.toBeDefined();
    expect(fake.invoke).not.toHaveBeenCalled();
  });
});
