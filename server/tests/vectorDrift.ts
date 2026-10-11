/**
 * Shared fixtures for the width-drift tests: the log capture they need,
 * and the operator-facing vocabulary they assert against.
 *
 * The scope phrasing is spelled out here rather than imported from the
 * module that produces it — an assertion against its own source would
 * pin nothing. It is the contract: the words the drift report must use
 * for the index.
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

/** The saved-query description index. */
export const SAVED_QUERY_SCOPE = "saved-query descriptions";

/** What a PostgreSQL drift report may never contain: a physical index
 * name, the vendor, or a statement. */
export const POSTGRES_LEAKS = ["vec_", "_idx", "PostgreSQL", "pgvector", "hnsw", "CREATE INDEX"];
