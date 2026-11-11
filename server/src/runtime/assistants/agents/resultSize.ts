/**
 * The size rule of an agent's tool results
 * (`docs/capabilities/agents.md#result-size`): a result holds at most
 * about `RESULT_CHARACTERS` characters of data, as the JSON the model
 * reads. A tool cuts its own result here, once, where it is made — at
 * whole rows, and inside one oversized row at a text or a list, each
 * ending with a marker — so the result keeps its shape, and the thread
 * keeps it as it was sent (ADR 0034). A cut text says that asking again
 * returns the same part: a model that is not told repeats the call.
 */

import { cpLength, cpSlice } from "../../codePoints.js";

/** The most characters of data one tool result holds, as JSON. About
 * 6,000 tokens: every result is read again with each later model call of
 * its conversation. */
export const RESULT_CHARACTERS = 24_000;

/** Below this many characters a text or list is no longer shrunk. */
const SMALLEST_CUT = 64;

/** Characters a cut marker may grow by when its numbers change with the cap. */
const MARKER_ROOM = 16;

/** The characters `value` takes as JSON. */
export const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

/** The leading `items` that take `cap` characters together, at least `least` of them. */
function leading<T>(items: T[], cap: number, least: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    used += size(item) + 1;
    if (used > cap && kept.length >= least) break;
    kept.push(item);
  }
  return kept;
}

/** No further keys to keep. */
const NO_KEYS: ReadonlySet<string> = new Set();

/** `value` with every text longer than `cap` characters cut to them and
 * every list cut to the leading items that take `cap` characters; with
 * `wide`, an object larger than `cap` too is cut, to the values it always
 * keeps — its system fields (its id, its type) and those under `keep` —
 * and the leading other values that take the rest. */
function shrunk(value: unknown, cap: number, wide: boolean, keep: ReadonlySet<string>): unknown {
  const kept = ([key]: readonly [string, unknown]) => key.startsWith("_") || keep.has(key);
  if (typeof value === "string") {
    // The code units bound the code points, so a short text is not counted.
    if (value.length <= cap) return value;
    const length = cpLength(value);
    return length <= cap
      ? value
      : `${cpSlice(value, 0, cap)}…[cut: first ${cap} of ${length} characters; asking again returns the same part]`;
  }
  if (Array.isArray(value)) {
    const first = leading(value.map((item) => shrunk(item, cap, wide, keep)), cap, 1);
    if (first.length < value.length) first.push(`…[cut: first ${first.length} of ${value.length} items]`);
    return first;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, shrunk(item, cap, wide, keep)] as const);
    if (!wide || size(Object.fromEntries(entries)) <= cap) return Object.fromEntries(entries);
    const others = entries.filter((entry) => !kept(entry));
    const first = new Set(leading(others, cap - size(Object.fromEntries(entries.filter(kept))), 0));
    return Object.fromEntries([
      ...entries.filter((entry) => kept(entry) || first.has(entry)),
      ["…", `[cut: first ${first.size} of ${others.length} values]`],
    ]);
  }
  return value;
}

/**
 * `value` in at most `budget` characters: as it is when it fits, else a
 * copy whose long texts and long lists are cut, each ending with a marker
 * that says how much of it is shown — and, when that is not enough, whose
 * objects keep only their system fields, the values under `keep` (an
 * entity's name) and their leading other values. An object stays an
 * object and a list a list. `cut` tells which.
 */
export function fitValue<T>(
  value: T,
  budget = RESULT_CHARACTERS,
  keep: ReadonlySet<string> = NO_KEYS,
): { value: T; cut: boolean } {
  if (size(value) <= budget) return { value, cut: false };
  // Texts and lists first; an object loses values only when it is still too large.
  for (const wide of [false, true]) {
    let cap = Math.max(SMALLEST_CUT, budget);
    for (;;) {
      const fitted = shrunk(value, cap, wide, keep);
      const over = size(fitted) - budget;
      if (over <= 0) return { value: fitted as T, cut: true };
      if (cap === SMALLEST_CUT) break;
      // The markers and the values around a cut take room too. A small
      // excess is taken off the cap as it is, so the result uses its
      // bound; a large one lowers the cap by a fifth.
      cap = Math.max(SMALLEST_CUT, Math.min(cap - 1, Math.max(cap - over - MARKER_ROOM, Math.floor(cap * 0.8))));
    }
  }
  return { value: `…[cut: a value of ${size(value)} characters that does not fit a result]` as T, cut: true };
}

/**
 * The leading rows that fit `budget` characters together, never a part of
 * a row. A row larger than the budget alone is shrunk first (`fitValue`),
 * so one long value does not end a page; `cut` says a row was shrunk. At
 * least one row is returned.
 */
export function fitRows<T>(
  rows: T[],
  budget = RESULT_CHARACTERS,
  keep: ReadonlySet<string> = NO_KEYS,
): { rows: T[]; cut: boolean } {
  const fitted: T[] = [];
  let cut = false;
  // Two brackets, and a comma before every further row.
  let used = 2;
  for (const row of rows) {
    const one = fitValue(row, budget - 2, keep);
    used += size(one.value) + (fitted.length === 0 ? 0 : 1);
    if (used > budget && fitted.length > 0) break;
    fitted.push(one.value);
    cut ||= one.cut;
  }
  return { rows: fitted, cut };
}

/** The leading characters of `text` that take at most `room` characters
 * as JSON, never a part of one: quotes, line breaks and control
 * characters take more room written out than read. */
export function fitText(text: string, room: number): string {
  if (size(text) <= room) return text;
  const points = Array.from(text);
  let fits = 0;
  let over = points.length;
  while (over - fits > 1) {
    const middle = Math.floor((fits + over) / 2);
    if (size(points.slice(0, middle).join("")) <= room) fits = middle;
    else over = middle;
  }
  return points.slice(0, fits).join("");
}
