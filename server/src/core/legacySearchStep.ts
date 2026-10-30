/**
 * The conversion of saved-query pipelines whose `search` steps name one
 * entity type in `entityTypeKey` — the steps that ran the default search
 * strategy and handed later steps the found entities' properties — into
 * steps that are an entity search. It exists for those stored and
 * exported pipelines only: the storage upgrade and the 7.0 transfer import
 * call it, nothing else — remove it with them.
 *
 * A search step's `entityTypeKey` becomes `types: [entityTypeKey]`; no
 * method block is added, so the step runs what the server can, and every
 * other field stays. The entity search's rows carry references only, so a
 * pipeline binding any other field of a search step cannot be converted.
 */

import type { Row } from "./ports.js";

const BINDING = /^\{\{(\w+)\.(\w+)\}\}$/;

/** The fields an entity search's rows carry. */
const REFERENCES = ["_id", "_entityTypeKey", "name"];

/** The steps with every search step converted (module comment); null when
 * a step binds a field of a search step other than a reference. */
export function convertLegacySearchSteps(steps: Row[]): Row[] | null {
  const searchSteps = new Set(steps.filter((step) => step.type === "search").map((step) => step.name));
  for (const step of steps) {
    for (const expr of Object.values((step.bindings ?? {}) as Record<string, string>)) {
      const match = BINDING.exec(expr);
      if (match !== null && searchSteps.has(match[1]) && !REFERENCES.includes(match[2]!)) return null;
    }
  }
  return steps.map(({ entityTypeKey, ...step }) =>
    step.type === "search" && typeof entityTypeKey === "string" ? { ...step, types: [entityTypeKey] } : step,
  );
}
