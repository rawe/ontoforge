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
  relevance: { type: "score", instructions: "Rate relevance", criteria: ["Unrelated", "Partly related", "Directly related"] },
};
const answers = {
  route: { type: "choice", choice: "graph", probabilities: { graph: 0.75, schema: 0.25 }, confidence: 0.75 },
  relevant: { type: "noul", noul: 0.6 },
  relevance: {
    type: "score", score: 1.5, legend: { "0": "Unrelated", "1": "Partly related", "2": "Directly related" },
    probabilities: { "0": 0.1, "1": 0.3, "2": 0.6 }, confidence: 0.6,
  },
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
    expect(JSON.parse(request?.body as string).questions.relevance.criteria)
      .toEqual(["Unrelated", "Partly related", "Directly related"]);
  });

  it.each([
    ["missing answer", { route: answers.route }],
    ["missing score answer", { route: answers.route, relevant: answers.relevant }],
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

  it.each([
    ["missing score", { ...answers.relevance, score: undefined }],
    ["malformed score", { ...answers.relevance, score: "1.5" }],
    ["missing legend", { ...answers.relevance, legend: undefined }],
    ["malformed legend", { ...answers.relevance, legend: { "0": null, "1": "Partly related", "2": "Directly related" } }],
    ["missing legend level", { ...answers.relevance, legend: { "0": "Unrelated", "1": "Partly related" } }],
    ["unknown legend level", { ...answers.relevance, legend: { ...answers.relevance.legend, "3": "Other" } }],
    ["non-index legend level", { ...answers.relevance, legend: { "00": "Unrelated", "1": "Partly related", "2": "Directly related" } }],
    ["wrong legend description", { ...answers.relevance, legend: { ...answers.relevance.legend, "1": "Other" } }],
    ["missing probabilities", { ...answers.relevance, probabilities: undefined }],
    ["missing probability level", { ...answers.relevance, probabilities: { "0": 0.4, "1": 0.6 } }],
    ["unknown probability level", { ...answers.relevance, probabilities: { "0": 0.1, "1": 0.3, "3": 0.6 } }],
    ["non-index probability level", { ...answers.relevance, probabilities: { "00": 0.1, "1": 0.3, "2": 0.6 } }],
    ["extra probability level", { ...answers.relevance, probabilities: { ...answers.relevance.probabilities, "3": 0 } }],
    ["negative score", { ...answers.relevance, score: -0.1 }],
    ["score above last level", { ...answers.relevance, score: 2.1 }],
    ["negative confidence", { ...answers.relevance, confidence: -0.1 }],
    ["missing confidence", { ...answers.relevance, confidence: undefined }],
    ["confidence above one", { ...answers.relevance, confidence: 1.1 }],
    ["out-of-range score probability", { ...answers.relevance, probabilities: { "0": -0.1, "1": 0.3, "2": 0.8 } }],
    ["unnormalized score probabilities", { ...answers.relevance, probabilities: { "0": 0.2, "1": 0.2, "2": 0.2 } }],
    ["score inconsistent with weighted probabilities", { ...answers.relevance, score: 1.8 }],
  ])("rejects %s before callers receive a score", async (_label, invalidScore) => {
    fetchMock.mockResolvedValue(Response.json({ answers: { ...answers, relevance: invalidScore } }));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, questions))
      .rejects.toThrow("invalid answer");
  });

  it("accepts rounded score probabilities and their fractional weighted mean", async () => {
    const rounded = { ...answers, relevance: {
      ...answers.relevance, score: 1.989, probabilities: { "0": 0.0012, "1": 0.0088, "2": 0.9901 }, confidence: 0.9901,
    } };
    fetchMock.mockResolvedValue(Response.json({ answers: rounded }));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, questions)).resolves.toEqual(rounded);
  });

  it.each([1, 11])("rejects a score of %i levels without sending it", async (count) => {
    const criteria = Array.from({ length: count }, (_, i) => `Level ${i}`);
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, {
      rating: { type: "score", instructions: "Rate", criteria },
    })).rejects.toThrow("2–10");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([2, 10])("accepts a score of %i ordered levels", async (count) => {
    const criteria = Array.from({ length: count }, (_, i) => `Level ${i}`);
    const expected = { rating: {
      type: "score", score: count - 1, confidence: 1,
      legend: Object.fromEntries(criteria.map((description, i) => [String(i), description])),
      probabilities: Object.fromEntries(criteria.map((_, i) => [String(i), i === count - 1 ? 1 : 0])),
    } };
    fetchMock.mockResolvedValue(Response.json({ answers: expected }));
    await expect(createDecisionModel("http://localhost:8002", "local", null).decide({}, {
      rating: { type: "score", instructions: "Rate", criteria },
    })).resolves.toEqual(expected);
  });

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
