/**
 * Character-based document chunking with overlap. Faithful port of the
 * Python reference (`runtime/chunking.py`).
 *
 * Splits large document property values into fixed-size chunks, preferring
 * paragraph, then sentence, then whitespace boundaries near the target
 * size. Each chunk records its exact character coordinates in the original
 * document so passages can be retrieved via the document read endpoint.
 *
 * All indices are Unicode CODE POINTS (Python `str` semantics), never
 * UTF-16 code units — the algorithm operates on a code-point array.
 */

/** A chunk of a document with exact character coordinates. */
export interface Chunk {
  startChar: number;
  charLength: number;
  text: string;
}

// Boundary patterns in order of preference. Each is searched backwards from
// the target split point; the split happens AFTER the matched separator.
const SENTENCE_ENDINGS: readonly string[] = [". ", "! ", "? ", ".\n", "!\n", "?\n"];

/**
 * Python `str.isspace()` for one code point. `\s` plus the C0/C1 controls
 * Python counts as whitespace, minus the BOM (which Python does not).
 */
function isSpace(ch: string): boolean {
  if (ch === "\uFEFF") {
    return false; // JS \s counts the BOM as whitespace; Python does not.
  }
  return /\s/.test(ch) || (ch >= "\u001C" && ch <= "\u001F") || ch === "\u0085";
}

/**
 * Find the best split point for a chunk starting at `start`.
 *
 * Prefers a paragraph break, then a sentence ending, then any whitespace —
 * searching backwards from `targetEnd` but never below the midpoint of the
 * chunk (to avoid degenerate tiny chunks). Falls back to a hard split at
 * `targetEnd`.
 */
function findSplitPoint(cps: readonly string[], start: number, targetEnd: number): number {
  const minEnd = start + Math.floor((targetEnd - start) / 2);

  // 1. Paragraph boundary ("\n\n") — split after the blank line. The match
  //    must lie entirely within [minEnd, targetEnd), as Python's rfind
  //    bounds it.
  for (let i = targetEnd - 2; i >= minEnd; i--) {
    if (cps[i] === "\n" && cps[i + 1] === "\n") {
      return i + 2;
    }
  }

  // 2. Sentence boundary — split after the punctuation + separator.
  let best = -1;
  for (const sep of SENTENCE_ENDINGS) {
    for (let i = targetEnd - sep.length; i >= minEnd; i--) {
      if (cps[i] === sep[0] && cps[i + 1] === sep[1]) {
        best = Math.max(best, i + sep.length);
        break;
      }
    }
  }
  if (best !== -1) {
    return best;
  }

  // 3. Any whitespace — split after the whitespace character.
  for (let i = targetEnd - 1; i >= minEnd; i--) {
    if (isSpace(cps[i]!)) {
      return i + 1;
    }
  }

  // 4. Hard split.
  return targetEnd;
}

/**
 * Split `text` into chunks of roughly `size` characters with `overlap`.
 *
 * Returns an empty list for empty text. A text shorter than `size` yields a
 * single chunk. Consecutive chunks overlap by roughly `overlap` characters
 * (exact overlap depends on the boundary chosen for the previous chunk).
 */
export function chunkDocument(text: string, size: number, overlap: number): Chunk[] {
  if (!text) {
    return [];
  }
  if (size <= 0) {
    throw new Error("Chunk size must be positive");
  }
  if (overlap < 0 || overlap >= size) {
    throw new Error("Chunk overlap must be >= 0 and smaller than size");
  }

  const cps = Array.from(text);
  const length = cps.length;
  const chunks: Chunk[] = [];
  let pos = 0;

  while (pos < length) {
    const targetEnd = pos + size;
    const end = targetEnd >= length ? length : findSplitPoint(cps, pos, targetEnd);

    chunks.push({ startChar: pos, charLength: end - pos, text: cps.slice(pos, end).join("") });

    if (end >= length) {
      break;
    }
    // Step back by the overlap, but always advance past the previous start.
    pos = Math.max(end - overlap, pos + 1);
  }

  return chunks;
}
