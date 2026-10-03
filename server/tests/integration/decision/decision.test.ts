import { describe, expect, it } from "vitest";

import { settings } from "../../../src/config.js";
import { createDecisionModel } from "../../../src/core/decision.js";

describe("Local Decision API", () => {
  it("answers a real mixed batch through the retained provider contract", async () => {
    expect(settings.DECISION_BASE_URL, "Configure a local Decision API for this suite").toBeTruthy();
    const endpoint = new URL(settings.DECISION_BASE_URL!);
    expect(endpoint.protocol).toBe("http:");
    expect(["localhost", "127.0.0.1", "[::1]"]).toContain(endpoint.hostname);
    expect(endpoint.username).toBe("");
    expect(endpoint.password).toBe("");
    expect(endpoint.search).toBe("");
    expect(settings.DECISION_API_KEY, "This suite must not use a provider credential").toBeNull();

    const model = createDecisionModel(settings.DECISION_BASE_URL!, settings.DECISION_MODEL, null);
    const scoreCriteria = ["Unrelated to product functionality", "Partly related to product functionality", "Directly related to product functionality"];
    const answers = await model.decide({ text: "A support request asks which product supports offline mode." }, {
      subject: {
        type: "choice",
        instructions: "Classify the subject of the text.",
        criteria: { product: "Product functionality", billing: "Invoices and payment" },
      },
      question: { type: "noul", instructions: "Does the text describe a question?" },
      relevance: { type: "score", instructions: "Rate how closely the text relates to product functionality.", criteria: scoreCriteria },
    });

    const choice = answers.subject;
    const noul = answers.question;
    const score = answers.relevance;
    expect(choice?.type).toBe("choice");
    expect(noul?.type).toBe("noul");
    expect(score?.type).toBe("score");
    if (choice?.type !== "choice" || noul?.type !== "noul" || score?.type !== "score") throw new Error("Invalid answer types");
    expect(["product", "billing"]).toContain(choice.choice);
    expect(Object.keys(choice.probabilities).sort()).toEqual(["billing", "product"]);
    expect(Object.values(choice.probabilities).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 1);
    expect(score.legend).toEqual(Object.fromEntries(scoreCriteria.map((description, i) => [String(i), description])));
    expect(Object.keys(score.probabilities).sort()).toEqual(["0", "1", "2"]);
    expect(Math.abs(Object.values(score.probabilities).reduce((sum, value) => sum + value, 0) - 1)).toBeLessThanOrEqual(0.02);
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(scoreCriteria.length - 1);
    const weightedScore = Object.entries(score.probabilities).reduce((sum, [level, probability]) => sum + Number(level) * probability, 0);
    expect(Math.abs(score.score - weightedScore)).toBeLessThanOrEqual(0.02);
    for (const probability of [...Object.values(choice.probabilities), choice.confidence, noul.noul,
      ...Object.values(score.probabilities), score.confidence]) {
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    }
  });
});
