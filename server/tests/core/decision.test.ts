import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  settings: {
    DECISION_BASE_URL: null as string | null,
    DECISION_MODEL: "local-decision",
    DECISION_API_KEY: null as string | null,
  },
}));
vi.mock("../../src/config.js", () => config);

import {
  createDecisionModel, getDecisionModel, initDecisionModel, setDecisionModel,
  type DecisionQuestion,
} from "../../src/core/decision.js";

const questions: Record<string, DecisionQuestion> = {
  route: { type: "choice", instructions: "Choose a route", criteria: { graph: "Graph data", schema: null } },
  relevant: { type: "noul", instructions: "Is this relevant?" },
};
const answers = {
  route: { type: "choice", choice: "graph", probabilities: { graph: 0.75, schema: 0.25 }, confidence: 0.75 },
  relevant: { type: "noul", noul: 0.6 },
};

describe("Decision HTTP contract", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setDecisionModel(null);
    config.settings.DECISION_BASE_URL = null;
    config.settings.DECISION_API_KEY = null;
  });

  it.each([null, "test-key"])("sends a batch with optional authentication (%s)", async (key) => {
    fetchMock.mockResolvedValue(Response.json({ answers }));
    const state = { text: "Find the schema" };
    const result = await createDecisionModel("http://localhost:8002///", "local-decision", key).decide(state, questions);
    expect(result).toEqual(answers);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8002/v1/systemone");
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(request?.headers).get("authorization")).toBe(key ? `Bearer ${key}` : null);
    expect(JSON.parse(request?.body as string)).toEqual({ model: "local-decision", state, questions });
  });

  it.each([
    ["missing answer", { route: answers.route }],
    ["wrong answer type", { ...answers, relevant: answers.route }],
    ["unknown choice", { ...answers, route: { ...answers.route, choice: "other" } }],
    ["missing option probability", { ...answers, route: { ...answers.route, probabilities: { graph: 1 } } }],
    ["unexpected option probability", { ...answers, route: { ...answers.route, probabilities: { graph: 0.5, schema: 0.25, other: 0.25 } } }],
    ["unnormalized probabilities", { ...answers, route: { ...answers.route, probabilities: { graph: 0.2, schema: 0.2 } } }],
    ["out-of-range probability", { ...answers, relevant: { type: "noul", noul: 1.1 } }],
    ["out-of-range confidence", { ...answers, route: { ...answers.route, confidence: -0.1 } }],
  ])("rejects %s before callers receive it", async (_label, invalidAnswers) => {
    fetchMock.mockResolvedValue(Response.json({ answers: invalidAnswers }));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, questions))
      .rejects.toThrow("invalid answer");
  });

  it.each([{}, { answers: null }, { answers: { relevant: { type: "noul", noul: "yes" } } }])(
    "rejects malformed responses", async (response) => {
      fetchMock.mockResolvedValue(Response.json(response));
      await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, questions))
        .rejects.toThrow("invalid answer");
    },
  );

  it.each([0, 33])("rejects a batch of %i questions without sending it", async (count) => {
    const batch = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), questions.relevant!]));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, batch))
      .rejects.toThrow("1–32 questions");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([1, 256])("rejects a choice of %i options without sending it", async (count) => {
    const criteria = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), null]));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, {
      route: { type: "choice", instructions: "Choose", criteria },
    })).rejects.toThrow("2–255 options");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the maximum batch and option counts", async () => {
    const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [String(i), null]));
    const batch: Record<string, DecisionQuestion> = Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [String(i), { type: "choice", instructions: "Choose", criteria }]),
    );
    const expected = Object.fromEntries(Object.keys(batch).map((key) => [key, {
      type: "choice", choice: "0", confidence: 1,
      probabilities: Object.fromEntries(Object.keys(criteria).map((option) => [option, option === "0" ? 1 : 0])),
    }]));
    fetchMock.mockResolvedValue(Response.json({ answers: expected }));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, batch)).resolves.toEqual(expected);
  });

  it.each([
    ['{"detail":"model unavailable"}', "model unavailable"],
    ['{"detail":{"reason":"unknown model"}}', '{"reason":"unknown model"}'],
    ["service unavailable", "service unavailable"],
  ])("preserves HTTP status and provider error details", async (body, detail) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 503 }));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, questions))
      .rejects.toThrow(`Decision model request failed (503): ${detail}`);
  });

  it.each(["caller", "timeout"])("cancels the request on %s abort", async (source) => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    fetchMock.mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      const signal = request!.signal!;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const result = createDecisionModel("http://localhost:8002", "local", null).decide({}, questions, caller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");
    (source === "caller" ? caller : deadline).abort(new Error("cancelled"));
    await rejected;
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it("leaves the model optional and installs it only when configured", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(getDecisionModel()).toBeNull();
    initDecisionModel();
    expect(getDecisionModel()).toBeNull();
    config.settings.DECISION_BASE_URL = "http://localhost:8002";
    initDecisionModel();
    expect(getDecisionModel()?.decide).toBeTypeOf("function");
    setDecisionModel(null);
    expect(getDecisionModel()).toBeNull();
  });
});
