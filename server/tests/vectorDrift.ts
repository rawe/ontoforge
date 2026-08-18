/**
 * Shared fixtures for the width-drift tests of both adapters: the log
 * capture each of them needs, and the operator-facing vocabulary they
 * all assert against.
 *
 * The scope phrasings are spelled out here rather than imported from the
 * module that produces them — an assertion against its own source would
 * pin nothing. They are the contract: the words every backend's drift
 * report must use for the same index, for the fixture keys 'person' and
 * 'bio'.
 */

import { vi } from "vitest";

export interface CapturedLogs {
  /** What `console.warn` was given. */
  warnings: string[];
  /** What `console.info` was given. */
  infos: string[];
  /** Both, in the order they were written. */
  lines: string[];
  restore: () => void;
}

/** Capture everything a drift report writes, until `restore`. */
export function captureLogs(): CapturedLogs {
  const warnings: string[] = [];
  const infos: string[] = [];
  const lines: string[] = [];
  const record = (target: string[]) => (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    target.push(line);
    lines.push(line);
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(record(warnings));
  const info = vi.spyOn(console, "info").mockImplementation(record(infos));
  return {
    warnings,
    infos,
    lines,
    restore: () => {
      warn.mockRestore();
      info.mockRestore();
    },
  };
}

/** Run `work` with the logs captured, and return everything it wrote. */
export async function logsOf(work: () => Promise<void>): Promise<string> {
  const captured = captureLogs();
  try {
    await work();
  } finally {
    captured.restore();
  }
  return captured.lines.join("\n");
}

/** The semantic index of the fixture entity type. */
export const ENTITY_TYPE_SCOPE = "entity type 'person'";

/** The chunk index of the fixture document property. */
export const DOCUMENT_PROPERTY_SCOPE = "document property 'bio' on entity type 'person'";

/** The cross-type entity index. */
export const ALL_TYPES_SCOPE = "search across all entity types";

/** The saved-query description index. */
export const SAVED_QUERY_SCOPE = "saved-query descriptions";

/** Every scope a full-inventory drift report must name. */
export const DRIFT_SCOPES = [
  ENTITY_TYPE_SCOPE,
  DOCUMENT_PROPERTY_SCOPE,
  ALL_TYPES_SCOPE,
  SAVED_QUERY_SCOPE,
];

/** What a PostgreSQL drift report may never contain: a physical index
 * name, the vendor, or a statement. */
export const POSTGRES_LEAKS = ["vec_", "_idx", "PostgreSQL", "pgvector", "hnsw", "CREATE INDEX"];
