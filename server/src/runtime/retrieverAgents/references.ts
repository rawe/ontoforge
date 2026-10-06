/**
 * Verified turn references: what a follow-up question ("these", "their")
 * may refer to. The server remembers each answered turn's plan and result
 * ids under a random token, bound to the ontology, lens and agent and to
 * the agent's configuration; browser history alone never authorizes
 * entity ids. Bounded: at most 100 turns, each for 10 minutes, in this
 * process only.
 */

import { createHash, randomUUID } from "node:crypto";

import { ValidationError } from "../../core/exceptions.js";
import type { Plan, Previous } from "./plan.js";

const MAX_TURNS = 100;
const TTL_MS = 10 * 60_000;

interface Turn {
  scope: string;
  configHash: string;
  expires: number;
  previous: Previous;
}

const turns = new Map<string, Turn>();

const hash = (config: unknown) => createHash("sha256").update(JSON.stringify(config)).digest("hex");

/** Remember a turn; the token a follow-up passes back. */
export function remember(
  scope: string,
  config: unknown,
  plan: Plan,
  results: Previous["results"],
  complete: boolean,
  reference?: Previous,
): string {
  for (const [key, value] of turns) if (value.expires < Date.now()) turns.delete(key);
  if (turns.size >= MAX_TURNS) turns.delete(turns.keys().next().value!);
  const token = randomUUID();
  turns.set(token, {
    scope,
    configHash: hash(config),
    expires: Date.now() + TTL_MS,
    previous: { plan, complete, results, ...(reference ? { referencedResults: reference.results } : {}) },
  });
  return token;
}

/** The remembered turn of a token; none without a token. */
export function recall(scope: string, config: unknown, token?: string): Previous | undefined {
  if (!token) return undefined;
  const entry = turns.get(token);
  if (!entry || entry.expires < Date.now() || entry.scope !== scope || entry.configHash !== hash(config)) {
    throw new ValidationError(
      "Conversation reference expired or configuration changed; please state the complete question.",
    );
  }
  return structuredClone(entry.previous);
}
