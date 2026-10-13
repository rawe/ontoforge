/**
 * Parse issues of an assistant configuration, as every kind reports them.
 *
 * Pure — no storage, no I/O.
 */

import type { z } from "zod";

/** Parse issues as readable strings: `path: message`. */
export function configIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}
