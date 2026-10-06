/**
 * Search entries: the per-entry text cap and the text hash that lets the
 * pipeline skip unchanged entries.
 *
 * Pure — no storage, no I/O. Composition (what an entry says) is not here;
 * this module only bounds and identifies the text once it is composed.
 */

import { createHash } from "node:crypto";

import type { SearchRepresentation } from "./searchIndex.js";

/** Most characters (code points) one entry's text holds. */
export const ENTRY_TEXT_CAP = 8000;

/**
 * The text cut to `ENTRY_TEXT_CAP` code points. Cuts between code points,
 * never inside a surrogate pair, so the result is always valid text.
 */
export function capEntryText(text: string): string {
  // UTF-16 length is an upper bound on the code-point count.
  if (text.length <= ENTRY_TEXT_CAP) return text;
  let units = 0;
  let codePoints = 0;
  for (const codePoint of text) {
    if (codePoints === ENTRY_TEXT_CAP) return text.slice(0, units);
    units += codePoint.length;
    codePoints += 1;
  }
  return text;
}

/**
 * The hash of what an entry would store: SHA-256 over the text, the
 * representation and the model id (null for keyword entries), separated
 * by NUL so no two inputs run together. Lowercase hex — the port carries
 * it as a string.
 */
export function entryTextHash(
  text: string,
  representation: SearchRepresentation,
  modelId: string | null,
): string {
  return createHash("sha256")
    .update(text)
    .update("\0")
    .update(representation)
    .update("\0")
    .update(modelId ?? "")
    .digest("hex");
}
