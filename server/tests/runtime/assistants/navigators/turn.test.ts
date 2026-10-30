/**
 * A whole navigator turn with a fake model and an in-memory graph: the
 * event sequence of the contract, exactly two model calls, the step
 * summaries, the widen rules, a turn that finds nothing, failures and
 * cancellation — and follow-ups on the same thread, which start from what
 * the previous answer cited.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ invoke: vi.fn(), stream: vi.fn(), withConfig: vi.fn() }));
const graph = vi.hoisted(() => ({ reader: null as unknown }));
vi.mock("../../../../src/config.js", () => ({
  settings: { AI_PROVIDER: "fake", AI_MODEL: "test", AI_BASE_URL: "http://unused" },
}));
vi.mock("../../../../src/core/ai.js", () => ({ createAiModel: vi.fn(() => fake), getAiModel: vi.fn(() => null) }));
vi.mock("../../../../src/runtime/assistants/navigators/reader.js", () => ({ lensReader: () => graph.reader }));

import { settings } from "../../../../src/config.js";
import { createAiModel } from "../../../../src/core/ai.js";
import type { RuntimeStore } from "../../../../src/core/ports.js";
import { ANSWER } from "../../../../src/runtime/assistants/navigators/answer.js";
import { deriveNavigator, type NavigatorConfig } from "../../../../src/runtime/assistants/navigators/config.js";
import { NAVIGATOR_TOPOLOGY } from "../../../../src/runtime/assistants/navigators/index.js";
import type { Intent } from "../../../../src/runtime/assistants/navigators/understand.js";
import { runNavigatorTurn } from "../../../../src/runtime/assistants/navigators/runtime.js";
import type { StreamEvent } from "../../../../src/runtime/chatStream.js";
import type { LoadedSchema } from "../../../../src/runtime/schemaCache.js";
import type { GraphThread } from "../../../../src/runtime/threads/threadStore.js";
import { graphValues, newGraphThread } from "../../threads/graphThread.js";
import { LENS, orgReader, type FakeReader } from "./fixture.js";

let reader: FakeReader;

async function newThread(): Promise<GraphThread> {
  return newGraphThread();
}

const plan = (intent: Partial<Intent>) => ({
  content: JSON.stringify({ mentions: [], targets: [], path: [], useFocus: false, search: "", ...intent }),
});
const answer = (...chunks: string[]) =>
  fake.stream.mockImplementationOnce(async () => (async function* () {
    for (const content of chunks) yield { content };
  })());

async function turn(
  message: string,
  options: { thread?: GraphThread; config?: Partial<NavigatorConfig>; signal?: AbortSignal } = {},
) {
  const events: StreamEvent[] = [];
  const thread = options.thread ?? (await newThread());
  const runnable = {
    key: "_default",
    config: { ...deriveNavigator(), ...options.config },
    loaded: { scoped: LENS, full: LENS } as unknown as LoadedSchema,
  };
  const { reply } = await runNavigatorTurn(runnable, "org", {} as RuntimeStore, message, thread, {
    signal: options.signal ?? new AbortController().signal,
    // As the stream does: each event as it was when emitted.
    onToolEvent: async (event) => { events.push(structuredClone(event)); },
  });
  return { events, reply, thread };
}

type Card = { ref: string; label: string; role: string; hop: number; reason: string; evidence: boolean; id: string };
const steps = (events: StreamEvent[]) =>
  events.filter((e) => e.type === "navigator.step").map((e) => `${e.id}:${e.status}:${e.round}`);
const stepDone = (events: StreamEvent[], id: string, round = 1) =>
  events.find((e) => e.type === "navigator.step" && e.id === id && e.round === round && e.status !== "running")!;
const lastCards = (events: StreamEvent[]) =>
  events.filter((e) => e.type === "entities").at(-1)!.entities as Card[];
const understandInput = (call = -1) => fake.invoke.mock.calls.at(call)![0][1].content as string;
const answerInput = (call = -1) => fake.stream.mock.calls.at(call)![0][1].content as string;

/** "Which projects do Lena's reports work on?" planned as a two-hop path. */
const TWO_HOPS: Pick<Intent, "mentions" | "targets" | "path"> = {
  mentions: [{ text: "Lena", types: ["person"] }],
  targets: ["project"],
  path: [{ relation: "manages", direction: "outgoing" }, { relation: "works_on", direction: "outgoing" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  reader = orgReader();
  graph.reader = reader;
  fake.withConfig.mockReturnValue({ invoke: fake.invoke });
  fake.invoke.mockResolvedValue(plan(TWO_HOPS));
  fake.stream.mockImplementation(async () => (async function* () { yield { content: "Nothing." }; })());
});

describe("a navigator turn", () => {
  it("streams the contract's events in order and answers with two model calls", async () => {
    answer("Kira Novak [E2] works on Apollo [E4]", "; Omar Haddad [E3] on Zeus [E5].");
    const { events, reply } = await turn("Which projects do Lena's reports work on?");

    expect(events.map((e) => (e.type === "navigator.step" ? `step ${e.id}:${e.status}` : e.type))).toEqual([
      "navigator.graph",
      "step understand:running", "step understand:done",
      "step anchor:running", "step anchor:done", "entities",
      "step walk:running", "step walk:done", "entities",
      "step focus:running", "step focus:done", "entities",
      "step answer:running", "delta", "delta", "step answer:done",
      "navigator.summary",
    ]);
    expect(events[0]).toEqual({ type: "navigator.graph", ...NAVIGATOR_TOPOLOGY });
    expect(reply).toBe("Kira Novak [E2] works on Apollo [E4]; Omar Haddad [E3] on Zeus [E5].");
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toBe(reply);

    expect(createAiModel).toHaveBeenCalledWith("fake", "test", "http://unused", { maxRetries: 0 });
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(fake.withConfig).toHaveBeenCalledWith({
      response_format: { type: "json_schema", json_schema: { name: "navigator_intent", strict: true, schema: expect.any(Object) } },
    });
  });

  it("summarises each step in plain words with its duration", async () => {
    answer("Kira Novak [E2] works on Apollo [E4], Omar Haddad [E3] on Zeus [E5] [E9].");
    const { events } = await turn("Which projects do Lena's reports work on?");
    expect(stepDone(events, "understand")).toMatchObject({
      status: "done", durationMs: expect.any(Number),
      summary: "Looking for Project · starting at “Lena” · path manages → works on",
    });
    expect(stepDone(events, "anchor").summary).toBe("“Lena” → Lena Vogt (Person)");
    expect(stepDone(events, "walk").summary).toBe("Path manages → works on: 4 entities · reached Project at hop 2");
    expect(stepDone(events, "focus").summary).toBe("Kept 5 of 5 · 2 matches of Project with their paths");
    // E9 is no evidence: not counted.
    expect(stepDone(events, "answer").summary).toBe("Cited 4 entities");
    expect(events.at(-1)).toEqual({
      type: "navigator.summary",
      modelCalls: 2,
      durationMs: expect.any(Number),
      entities: 5,
      evidence: 5,
      hops: 2,
      timings: { understand: expect.any(Number), anchor: expect.any(Number), walk: expect.any(Number), focus: expect.any(Number), answer: expect.any(Number) },
    });
  });

  it("streams the cards before the answer: anchors first, then upserts with links and evidence", async () => {
    const { events } = await turn("Which projects do Lena's reports work on?");
    const sidebar = events.filter((e) => e.type === "entities");
    expect(events.findIndex((e) => e.type === "entities")).toBeLessThan(events.findIndex((e) => e.type === "delta"));
    // After anchor: the anchor alone, not yet evidence.
    expect(sidebar[0]!.entities).toEqual([{
      ref: "E1", id: "lena", type: "person", typeName: "Person", label: "Lena Vogt", role: "anchor", hop: 0,
      reason: "Named in the question: “Lena”",
      fields: [{ name: "Email", value: "lena@corvane.example" }, { name: "Level", value: "6" }],
      evidence: false,
    }]);
    expect(sidebar[0]!.links).toEqual([]);
    // After the walk: every entity met, in discovery order.
    expect((sidebar[1]!.entities as Card[]).map((c) => [c.ref, c.label, c.hop])).toEqual([
      ["E1", "Lena Vogt", 0], ["E2", "Kira Novak", 1], ["E3", "Omar Haddad", 1], ["E4", "Apollo", 2], ["E5", "Zeus", 2],
    ]);
    expect(sidebar[1]!.links).toEqual([
      { id: "manages:lena:kira", from: "E1", to: "E2", type: "manages", label: "manages" },
      { id: "manages:lena:omar", from: "E1", to: "E3", type: "manages", label: "manages" },
      { id: "works_on:kira:apollo", from: "E2", to: "E4", type: "works_on", label: "works on" },
      { id: "works_on:omar:zeus", from: "E3", to: "E5", type: "works_on", label: "works on" },
    ]);
    // After focus: evidence marked.
    expect(lastCards(events).every((c) => c.evidence)).toBe(true);
    expect(lastCards(events).find((c) => c.ref === "E4")).toMatchObject({ role: "reached", reason: "Kira Novak works on Apollo" });
  });

  it("the answer model receives the evidence in display names, and the instructions appended", async () => {
    await turn("Which projects do Lena's reports work on?", { config: { instructions: "Answer in one sentence." } });
    expect(fake.stream.mock.calls[0]![0][0].content).toBe(`${ANSWER}\n\nADDITIONAL INSTRUCTIONS:\nAnswer in one sentence.`);
    const input = answerInput();
    expect(input).toContain('[E4] Project "Apollo" — Status: active');
    expect(input).toContain("Kira Novak [E2] works on Apollo [E4]");
    expect(input.endsWith("QUESTION: Which projects do Lena's reports work on?")).toBe(true);
    expect(input).not.toContain("works_on");
  });

  it("hands Anthropic the intent schema as its own output format, and reads JSON in a fence", async () => {
    fake.invoke.mockResolvedValueOnce({ content: [{ type: "text", text: `\`\`\`json\n${plan(TWO_HOPS).content}\n\`\`\`` }] });
    settings.AI_PROVIDER = "anthropic";
    try {
      const { events } = await turn("Which projects do Lena's reports work on?");
      expect(stepDone(events, "walk").summary).toContain("reached Project at hop 2");
    } finally {
      settings.AI_PROVIDER = "fake";
    }
    expect(fake.withConfig).toHaveBeenCalledWith({ outputConfig: { format: { type: "json_schema", schema: expect.any(Object) } } });
  });

  it("finding nothing skips walk and focus, and the answer is told", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Zed", types: [] }] }));
    const { events } = await turn("Who is Zed?");
    expect(steps(events)).toEqual([
      "understand:running:1", "understand:done:1", "anchor:running:1", "anchor:done:1",
      "walk:skipped:1", "focus:skipped:1", "answer:running:1", "answer:done:1",
    ]);
    expect(stepDone(events, "anchor").summary).toBe("Nothing found for “Zed” · Nothing matches the topic “Who is Zed?”");
    expect(stepDone(events, "walk").summary).toBe("Nothing to walk from");
    expect(stepDone(events, "focus").summary).toBe("Nothing to focus on");
    expect(events.filter((e) => e.type === "entities")).toHaveLength(1);
    expect(answerInput()).toContain("ENTITIES: none were found.");
    expect(answerInput()).toContain("- No entity of the question was found in the graph.");
    expect(events.at(-1)).toMatchObject({ type: "navigator.summary", modelCalls: 2, entities: 0, evidence: 0, hops: 0 });
  });

  it("a closest match is told to the answer", async () => {
    reader.searchWith = () => [{ entity: reader.byId.get("lena")!, score: 1 }];
    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Lina", types: ["person"] }], targets: ["person"] }));
    const { events } = await turn("Who does Lina manage?");
    expect(lastCards(events)[0]).toMatchObject({ label: "Lena Vogt", reason: "Closest match for “Lina” — not the same name" });
    expect(answerInput()).toContain("- Nothing is named “Lina”; the closest match was used instead: Lena Vogt (Person).");
  });

  it("a failed understand call fails the step and the turn; no answer, no retry", async () => {
    fake.invoke.mockRejectedValueOnce(new Error("overloaded"));
    const events: StreamEvent[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(runNavigatorTurn({ key: "_default", config: deriveNavigator(), loaded: { scoped: LENS, full: LENS } as unknown as LoadedSchema },
      "org", {} as RuntimeStore, "Who?", await newThread(), { signal: new AbortController().signal, onToolEvent: async (e) => { events.push(e); } }))
      .rejects.toThrow("The language model failed (navigator_intent); no automatic retry.");
    expect(steps(events)).toEqual(["understand:running:1", "understand:failed:1"]);
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    expect(fake.stream).not.toHaveBeenCalled();

    fake.invoke.mockResolvedValueOnce({ content: "not json" });
    await expect(turn("Who?")).rejects.toThrow("The language model answered no readable JSON (navigator_intent).");
  });

  it("a failed answer fails the answer step", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.stream.mockImplementationOnce(async () => { throw new Error("down"); });
    await expect(turn("Which projects?")).rejects.toThrow("The language model failed while answering; no automatic retry.");
  });

  it("a cancelled request calls no model", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(turn("Who?", { signal: controller.signal })).rejects.toBeDefined();
    expect(fake.invoke).not.toHaveBeenCalled();
    expect(fake.stream).not.toHaveBeenCalled();
  });
});

describe("widening the walk", () => {
  it("a planned path that reaches nothing is widened once by exploring the configured hops", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ ...TWO_HOPS, path: [{ relation: "requires", direction: "any" }] }));
    const { events } = await turn("Which projects?");
    expect(steps(events).filter((s) => s.startsWith("walk"))).toEqual([
      "walk:running:1", "walk:done:1", "walk:running:2", "walk:done:2",
    ]);
    expect(stepDone(events, "walk", 1).summary).toBe("Path requires: 0 entities · the path ends without a match");
    expect(stepDone(events, "walk", 2).summary).toBe("Explored 2 hops: 7 entities · reached Project at hop 2");
    expect(answerInput()).toContain("- The planned route did not reach everything asked for, so the walk also explored every relation.");
    // Entities after each walk round.
    expect(events.filter((e) => e.type === "entities")).toHaveLength(4);
  });

  it("a planned path that misses one of the target types is widened too", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ ...TWO_HOPS, targets: ["project", "team"] }));
    const { events } = await turn("Which projects and teams?");
    expect(stepDone(events, "walk", 1).summary).toBe("Path manages → works on: 4 entities · reached Project, Team at hop 2");
    // Round two explores the configured two hops and finds the teams.
    expect(stepDone(events, "walk", 2).summary).toBe("Explored 2 hops: 3 entities · reached Project, Team at hop 2");
    expect(lastCards(events).filter((c) => c.label === "Platform" || c.label === "Data")).toHaveLength(2);
    expect(answerInput()).toContain("- The planned route did not reach everything asked for, so the walk also explored every relation.");
  });

  it("a target type met only as an anchor counts as missed; met by the walk it does not", async () => {
    // Kira's path reaches Apollo; the only person is the anchor Kira herself.
    fake.invoke.mockResolvedValueOnce(plan({
      mentions: [{ text: "Kira", types: ["person"] }],
      targets: ["person", "project"],
      path: [{ relation: "works_on", direction: "outgoing" }],
    }));
    const missed = await turn("Who is on Kira's project?");
    expect(steps(missed.events)).toContain("walk:running:2");

    fake.invoke.mockResolvedValueOnce(plan({
      mentions: [{ text: "Lena", types: ["person"] }],
      targets: ["person"],
      path: [{ relation: "manages", direction: "outgoing" }],
    }));
    const met = await turn("Who does Lena manage?");
    expect(steps(met.events).filter((s) => s.startsWith("walk"))).toEqual(["walk:running:1", "walk:done:1"]);
    expect(answerInput()).not.toContain("explored every relation");
  });

  it("a planned path that reaches every target is not widened", async () => {
    const { events } = await turn("Which projects do Lena's reports work on?");
    expect(steps(events).filter((s) => s.startsWith("walk"))).toEqual(["walk:running:1", "walk:done:1"]);
  });

  it("widening a planned path keeps the configured hop budget", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ ...TWO_HOPS, path: [{ relation: "requires", direction: "any" }] }));
    const { events } = await turn("Which projects?", { config: { hops: 1 } });
    expect(stepDone(events, "walk", 2).summary).toBe("Explored 1 hop: 2 entities");
    // Widened once only.
    expect(steps(events)).not.toContain("walk:running:3");
  });

  it("an exploration that reached no target goes one hop further, once", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Lena", types: [] }], targets: ["skill"] }));
    const { events } = await turn("Which skills?", { config: { hops: 1 } });
    expect(stepDone(events, "walk", 1).summary).toBe("Explored 1 hop: 2 entities");
    // Round two explores two hops; Kira and Omar are known already.
    expect(stepDone(events, "walk", 2).summary).toBe("Explored 2 hops: 5 entities");
    expect(steps(events)).not.toContain("walk:running:3");
  });

  it("an exploration widened from two hops reaches the third", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Lena", types: [] }], targets: ["skill"] }));
    const { events } = await turn("Which skills?");
    expect(stepDone(events, "walk", 1).summary).toBe("Explored 2 hops: 7 entities");
    expect(stepDone(events, "walk", 2).summary).toBe("Explored 3 hops: 2 entities · reached Skill at hop 3");
  });

  it("an exploration already at three hops, or without targets, is not widened", async () => {
    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Tom", types: [] }], targets: ["team"] }));
    const atMost = await turn("Which teams?", { config: { hops: 3, relationTypes: ["manages"] } });
    expect(steps(atMost.events).filter((s) => s.startsWith("walk"))).toEqual(["walk:running:1", "walk:done:1"]);

    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Tom", types: [] }] }));
    const untargeted = await turn("What about Tom?", { config: { hops: 1 } });
    expect(steps(untargeted.events).filter((s) => s.startsWith("walk"))).toEqual(["walk:running:1", "walk:done:1"]);
  });
});

describe("follow-ups on a thread", () => {
  it("a follow-up that refers back starts from the entities the previous answer cited", async () => {
    answer("Kira Novak [E2] works on Apollo [E4]; Omar Haddad [E3] on Zeus [E5].");
    const first = await turn("Which projects do Lena's reports work on?");

    fake.invoke.mockResolvedValueOnce(plan({ targets: ["team"], path: [{ relation: "member_of", direction: "outgoing" }], useFocus: true }));
    answer("Kira Novak [E1] is in Platform [E5].");
    const { events, reply } = await turn("And which teams are they in?", { thread: first.thread });

    // The understand step sees the conversation and the cited entities, in order of citation.
    const input = understandInput();
    expect(input).toContain("CONVERSATION (oldest first):\n\nuser: Which projects do Lena's reports work on?\n\nassistant: Kira Novak [E2]");
    expect(input).toContain("ENTITIES OF THE PREVIOUS ANSWER: Kira Novak (person); Apollo (project); Omar Haddad (person); Zeus (project)");
    // They are re-read and become focus cards; refs start again at E1.
    expect(reader.calls.entity).toEqual([["person", "kira"], ["project", "apollo"], ["person", "omar"], ["project", "zeus"]]);
    const anchored = events.find((e) => e.type === "entities")!.entities as Card[];
    expect(anchored.map((c) => [c.ref, c.label, c.role, c.hop, c.reason])).toEqual([
      ["E1", "Kira Novak", "focus", 0, "From the previous answer"],
      ["E2", "Apollo", "focus", 0, "From the previous answer"],
      ["E3", "Omar Haddad", "focus", 0, "From the previous answer"],
      ["E4", "Zeus", "focus", 0, "From the previous answer"],
    ]);
    expect(stepDone(events, "understand").summary).toBe("Looking for Team · continuing from the previous answer · path member of");
    expect(stepDone(events, "anchor").summary).toBe("Continuing from the previous answer: 4 entities");
    expect(lastCards(events).map((c) => c.label)).toEqual(["Kira Novak", "Apollo", "Omar Haddad", "Zeus", "Platform", "Data"]);
    expect(reply).toBe("Kira Novak [E1] is in Platform [E5].");
    // The answer sees the conversation too.
    expect(answerInput()).toContain("CONVERSATION SO FAR (context only, not evidence):");
  });

  it("the thread keeps the conversation and what the answer cited, nothing else", async () => {
    answer("Apollo [E4] and Zeus [E5].");
    const { thread } = await turn("Which projects do Lena's reports work on?");
    const values = await graphValues(thread);
    const kept = Object.entries(values).filter(([key, value]) => value !== undefined && !key.startsWith("__"));
    expect(kept.map(([key]) => key).sort()).toEqual(["carried", "messages", "round"]);
    expect((values.messages as { text: string }[]).map((m) => m.text)).toEqual([
      "Which projects do Lena's reports work on?",
      "Apollo [E4] and Zeus [E5].",
    ]);
    expect(values.carried).toEqual([
      { id: "apollo", type: "project", label: "Apollo" },
      { id: "zeus", type: "project", label: "Zeus" },
    ]);
  });

  it("an answer that cites nothing carries its evidence beyond the anchors", async () => {
    answer("I could not tell.");
    const { thread } = await turn("Which projects do Lena's reports work on?");
    expect(((await graphValues(thread)).carried as { label: string }[]).map((c) => c.label)).toEqual([
      "Kira Novak", "Apollo", "Omar Haddad", "Zeus",
    ]);
  });

  it("a follow-up that does not refer back reads nothing of the previous answer", async () => {
    answer("Apollo [E4].");
    const first = await turn("Which projects do Lena's reports work on?");
    fake.invoke.mockResolvedValueOnce(plan({ mentions: [{ text: "Tom", types: [] }], targets: ["team"] }));
    const { events } = await turn("Which team is Tom in?", { thread: first.thread });
    expect(reader.calls.entity).toEqual([]);
    expect(lastCards(events)[0]).toMatchObject({ ref: "E1", label: "Tom Berg", role: "anchor" });
  });

  it("a target type met among the carried-over entities counts as reached", async () => {
    answer("Apollo [E4] and Zeus [E5].");
    const first = await turn("Which projects do Lena's reports work on?");
    fake.invoke.mockResolvedValueOnce(plan({
      useFocus: true, targets: ["project", "skill"], path: [{ relation: "requires", direction: "outgoing" }],
    }));
    const { events } = await turn("Which of them require which skills?", { thread: first.thread });
    expect(steps(events).filter((s) => s.startsWith("walk"))).toEqual(["walk:running:1", "walk:done:1"]);
  });

  it("a focus entity deleted since the previous turn drops out", async () => {
    answer("Apollo [E4] and Zeus [E5].");
    const first = await turn("Which projects do Lena's reports work on?");
    reader.byId.delete("zeus");
    fake.invoke.mockResolvedValueOnce(plan({ useFocus: true, targets: ["skill"], path: [{ relation: "requires", direction: "outgoing" }] }));
    const { events } = await turn("What do they require?", { thread: first.thread });
    expect(stepDone(events, "anchor").summary).toBe("Continuing from the previous answer: 1 entity");
    expect(lastCards(events).map((c) => c.label)).toEqual(["Apollo", "Kubernetes"]);
  });
});
