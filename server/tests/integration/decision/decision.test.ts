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
    const answers = await model.decide({ text: "A support request asks which product supports offline mode." }, {
      subject: {
        type: "choice",
        instructions: "Classify the subject of the text.",
        criteria: { product: "Product functionality", billing: "Invoices and payment" },
      },
      question: { type: "noul", instructions: "Does the text describe a question?" },
    });

    const choice = answers.subject;
    const noul = answers.question;
    expect(choice?.type).toBe("choice");
    expect(noul?.type).toBe("noul");
    if (choice?.type !== "choice" || noul?.type !== "noul") throw new Error("Invalid answer types");
    expect(["product", "billing"]).toContain(choice.choice);
    expect(Object.keys(choice.probabilities).sort()).toEqual(["billing", "product"]);
    expect(Object.values(choice.probabilities).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 1);
    for (const probability of [...Object.values(choice.probabilities), choice.confidence, noul.noul]) {
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    }
  });
});
