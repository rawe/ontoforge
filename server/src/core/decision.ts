/**
 * Decision-model provider contract. A decision model answers typed
 * questions — a choice among named options, or a yes/no probability — about
 * a small JSON state. It never abstains: every threshold lives with the
 * caller.
 *
 * One implementation: plain HTTP against a Jev-compatible API
 * (`POST {DECISION_BASE_URL}/v1/systemone`). The Bearer header is sent only
 * when a key is configured (a local provider may need none). With no
 * `DECISION_BASE_URL`, no model is installed. Tests inject a fake via
 * `setDecisionModel`.
 */

import { z } from "zod";

import { settings } from "../config.js";

/** Pick exactly one option; `criteria` maps option key → description (or null). */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

/** A yes/no question answered with the probability of yes. */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type DecisionAnswer = ChoiceAnswer | NoulAnswer;

export interface DecisionModel {
  /** Answer 1..32 questions about one state in a single call. */
  decide(
    state: unknown,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal,
  ): Promise<Record<string, DecisionAnswer>>;
}

const TIMEOUT_MS = 10_000;

const probability = z.number().min(0).max(1);
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(),
    probabilities: z.record(z.string(), probability), confidence: probability }),
  z.object({ type: z.literal("noul"), noul: probability }),
]);

/** Validate at the provider seam before callers interpret a model judgment. */
function parseAnswers(value: unknown, questions: Record<string, DecisionQuestion>): Record<string, DecisionAnswer> {
  const parsed = z.object({ answers: z.record(z.string(), answerSchema) }).safeParse(value);
  const invalid = () => new Error("Decision model returned an invalid answer");
  if (!parsed.success) throw invalid();
  for (const [key, question] of Object.entries(questions)) {
    const answer = parsed.data.answers[key];
    if (!answer || answer.type !== question.type) throw invalid();
    if (question.type === "choice" && answer.type === "choice") {
      const options = Object.keys(question.criteria);
      if (!options.includes(answer.choice) ||
          Object.keys(answer.probabilities).length !== options.length ||
          options.some((option) => answer.probabilities[option] === undefined) ||
          Math.abs(Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.02) {
        throw invalid();
      }
    }
  }
  return parsed.data.answers;
}

export function createDecisionModel(
  baseUrl: string,
  modelName: string,
  apiKey: string | null,
): DecisionModel {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/systemone`;
  return {
    async decide(state, questions, signal) {
      const entries = Object.values(questions);
      if (entries.length === 0 || entries.length > 32 || entries.some((q) =>
        q.type === "choice" && (Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 255))) {
        throw new Error("Decision requests require 1–32 questions and 2–255 options per choice");
      }
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model: modelName, state, questions }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) {
        const text = await response.text();
        let detail: unknown = text;
        try {
          detail = (JSON.parse(text) as { detail?: unknown }).detail ?? text;
        } catch {
          // Not JSON — keep the raw text.
        }
        throw new Error(
          `Decision model request failed (${response.status}): ` +
            (typeof detail === "string" ? detail : JSON.stringify(detail)),
        );
      }
      return parseAnswers(await response.json(), questions);
    },
  };
}

let model: DecisionModel | null = null;

/** Install the configured decision model, or none. */
export function initDecisionModel(): void {
  if (!settings.DECISION_BASE_URL) {
    console.info("DECISION_BASE_URL not set — decision model disabled");
    return;
  }
  model = createDecisionModel(
    settings.DECISION_BASE_URL,
    settings.DECISION_MODEL,
    settings.DECISION_API_KEY,
  );
  console.info(
    `Decision model initialized: ${settings.DECISION_MODEL} via ${settings.DECISION_BASE_URL}`,
  );
}

/** The active decision model, or `null` when disabled. */
export function getDecisionModel(): DecisionModel | null {
  return model;
}

/** Install (or clear) the active decision model. Startup and tests only. */
export function setDecisionModel(next: DecisionModel | null): void {
  model = next;
}
