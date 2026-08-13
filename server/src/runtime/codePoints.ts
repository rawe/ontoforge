/**
 * Code-point string helpers.
 *
 * Every document offset and length in the API is a CHARACTER count measured
 * in Unicode code points, so the contract holds regardless of how a client
 * or a reimplementation represents strings. JS strings index UTF-16 code
 * units, so astral-plane characters (emoji) would silently shift every
 * offset if native `.length`/`.slice` were used. All document reads, writes
 * and chunking go through these helpers instead.
 *
 * Matching (indexOf / count / replace) needs no conversion: a well-formed
 * needle can only match at code-point boundaries, so unit-based search finds
 * exactly the same matches — only the reported offsets convert.
 */

/** Number of Unicode code points in `s`. */
export function cpLength(s: string): number {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of s) {
    n++;
  }
  return n;
}

/** Substring of `s` from `start` up to `end`, in non-negative code-point
 * indices. */
export function cpSlice(s: string, start: number, end?: number): string {
  return Array.from(s).slice(start, end).join("");
}

/** Code-point offset of the first occurrence of `needle`, or -1. */
export function cpIndexOf(s: string, needle: string): number {
  const unitIndex = s.indexOf(needle);
  if (unitIndex === -1) {
    return -1;
  }
  return cpLength(s.slice(0, unitIndex));
}

/** Non-overlapping occurrence count, scanning left to right.
 * An empty needle is the caller's error. */
export function countOccurrences(s: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = s.indexOf(needle, from);
    if (idx === -1) {
      return count;
    }
    count++;
    from = idx + needle.length;
  }
}
