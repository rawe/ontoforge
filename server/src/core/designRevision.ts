/**
 * Comparing design revisions (`DesignRevision`, `core/ports.ts`).
 */

import type { DesignRevision } from "./ports.js";

/** Whether two design revisions name the same design. */
export function sameDesign(a: DesignRevision, b: DesignRevision): boolean {
  return a.ontologyId === b.ontologyId && a.revision === b.revision;
}
