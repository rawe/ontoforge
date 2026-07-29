/**
 * Entity embedding text composition. Ports the Python reference
 * (`backend/src/ontoforge_server/runtime/embedding.py`) exactly — the
 * composition rules are normative in
 * `docs/capabilities/search.md#what-gets-embedded`:
 *
 * - only `string` properties contribute (never document/numeric/temporal);
 * - `key=value` pairs in schema declaration order;
 * - properties with no value are skipped;
 * - composed from the FULL schema, never the lens;
 * - capped at 30 000 characters;
 * - deterministic.
 */

import { cpLength, cpSlice } from "./codePoints.js";
import type { PropertyDef } from "./schemaCache.js";

// nomic-embed-text has an 8192-token limit; ~4 chars/token → 30000 chars
// as a safe threshold.
export const MAX_TEXT_CHARS = 30_000;

/**
 * Build the text an entity is embedded from:
 * `"{entityTypeKey}: {key}={value}, ..."` — or the bare type key when no
 * string property has a value.
 */
export function buildTextRepr(
  entityTypeKey: string,
  properties: Record<string, unknown>,
  propertyDefs: Record<string, PropertyDef>,
): string {
  const parts: string[] = [];
  for (const [propKey, propDef] of Object.entries(propertyDefs)) {
    if (propDef.dataType !== "string") {
      continue;
    }
    const value = properties[propKey];
    if (value !== null && value !== undefined) {
      parts.push(`${propKey}=${String(value)}`);
    }
  }

  let text = parts.length > 0 ? `${entityTypeKey}: ${parts.join(", ")}` : entityTypeKey;

  const length = cpLength(text);
  if (length > MAX_TEXT_CHARS) {
    console.warn(
      `Text representation for entity type '${entityTypeKey}' truncated ` +
        `from ${length} to ${MAX_TEXT_CHARS} chars`,
    );
    text = cpSlice(text, 0, MAX_TEXT_CHARS);
  }

  return text;
}
