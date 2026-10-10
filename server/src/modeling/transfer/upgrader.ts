/**
 * What the upgraders of the transfer format's chain share
 * (`upgrades.ts`): their signature, the retriever warnings that travel
 * beside a payload, and reading fields the way the request shape reports
 * them.
 */

import type { z } from "zod";

import { ValidationError } from "../../core/exceptions.js";
import type { TransferEnvelope } from "../schemas.js";

/** A payload of some version: an object with an optional version string. */
export type Payload = z.infer<typeof TransferEnvelope>;

/**
 * Warnings for the retriever agents an upgrade converted, by
 * `retrieverWarningKey` — they travel beside the payload, which has no
 * place for them, until import stores them with each agent.
 */
export type RetrieverWarnings = Map<string, string[]>;

/** The key a converted retriever agent's warnings go by. */
export function retrieverWarningKey(lensKey: string, retrieverKey: string): string {
  return `${lensKey}/${retrieverKey}`;
}

/** What an upgrader makes of a payload of its version: one of the next. */
export interface Upgraded {
  payload: Payload;
  retrieverWarnings: RetrieverWarnings;
}

/** An upgrader checks the fields it reads, reporting a malformed one in its
 * own version's terms, and keeps every other field as it comes. */
export type Upgrader = (payload: Payload) => Upgraded;

/**
 * Parse `value` with `schema`, failing like a request of the wrong shape:
 * one validation error naming every offending path (`/lenses/0/name`).
 */
export function readFields<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ValidationError("Request validation failed", {
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? "" : "/" + issue.path.map(String).join("/"),
      message: issue.message,
    })),
  });
}
