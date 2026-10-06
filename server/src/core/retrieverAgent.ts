/**
 * Retriever agents: lens-local configurations that answer questions over
 * search indices with a planner and an answer model. This module holds the
 * configuration (version 2) — its shape, defaults and limits — and the
 * stored record. Checking a configuration against its lens needs the
 * lens's index catalog and lives with the runtime
 * (`runtime/retrieverAgents/config.ts`).
 *
 * Pure — no storage, no I/O.
 */

import { z } from "zod";

/** The configuration version this release writes and runs. */
export const RETRIEVER_AGENT_CONFIG_VERSION = 2;

/** Cosine similarity floor of semantic matches (A5: searched as `(1 + t) / 2`). */
export const DEFAULT_THRESHOLD = 0.35;

/** Characters of one answer field passed to the answer model. */
export const DEFAULT_ANSWER_FIELD_CHARACTERS = 800;

/** Most answer fields per entity type. */
export const MAX_ANSWER_FIELDS = 12;

/** Most relation hops of a filter path. */
export const MAX_FILTER_HOPS = 2;

/** Most indices and filters one agent references. */
export const MAX_AGENT_INDICES = 12;
export const MAX_AGENT_FILTERS = 12;

const Hop = z.object({
  relationTypeKey: z.string(),
  direction: z.enum(["outgoing", "incoming"]),
});
export type FilterHop = z.infer<typeof Hop>;

/** One index the agent searches; `relations` absent = every relation group
 * the lens shows, present = only these relation types' groups. */
const IndexReference = z.object({
  index: z.string().min(1),
  relations: z.array(z.string()).min(1).optional(),
});

/** A hard condition: an exact value compare on a field of the entity
 * reached from a result type by 0..2 relation hops. */
const Filter = z.object({
  id: z.string().min(1).max(200),
  entityType: z.string(),
  path: z.array(Hop).max(MAX_FILTER_HOPS),
  field: z.string(),
});
export type RetrieverAgentFilter = z.infer<typeof Filter>;

export const RetrieverAgentConfig = z.object({
  indices: z.array(IndexReference).min(1).max(MAX_AGENT_INDICES),
  filters: z.array(Filter).max(MAX_AGENT_FILTERS).default([]),
  /** Per result entity type, the fields passed to the answer model. */
  answerFields: z.record(z.string(), z.array(z.string()).min(1).max(MAX_ANSWER_FIELDS)),
  threshold: z.number().min(-1).max(1).default(DEFAULT_THRESHOLD),
  answerFieldCharacters: z.number().int().min(100).max(2000).default(DEFAULT_ANSWER_FIELD_CHARACTERS),
});
export type RetrieverAgentConfig = z.infer<typeof RetrieverAgentConfig>;

/** One stored retriever agent. The configuration is kept as stored: a
 * version or shape this release cannot run stays readable and exportable.
 * `warnings` are notes from converting a version-1 configuration; a save
 * clears them. */
export interface RetrieverAgentRecord {
  retrieverAgentId: string;
  key: string;
  name: string;
  description: string | null;
  configVersion: number;
  config: unknown;
  warnings: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** What a write stores. */
export interface RetrieverAgentWrite {
  retrieverAgentId: string;
  key: string;
  name: string;
  description: string | null;
  configVersion: number;
  config: unknown;
  warnings: string[];
}

/** The `(1 + cosine) / 2` floor the search applies for a cosine threshold. */
export function similarityFloor(threshold: number): number {
  return (1 + threshold) / 2;
}

/** Parse issues as readable strings: `path: message`. */
export function configIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}
