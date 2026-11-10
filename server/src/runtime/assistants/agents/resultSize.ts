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

const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

/** `value` with every text longer than `cap` characters cut to them, and
 * every list cut to the leading items that take `cap` characters. */
function shrunk(value: unknown, cap: number): unknown {
  if (typeof value === "string") {
    // The code units bound the code points, so a short text is not counted.
    if (value.length <= cap) return value;
    const length = cpLength(value);
    return length <= cap ? value : `${cpSlice(value, 0, cap)}…[cut: first ${cap} of ${length} characters; asking again returns the same part]`;
  }
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    let used = 0;
    for (const item of value) {
      const next = shrunk(item, cap);
      used += size(next) + 1;
      if (used > cap && kept.length > 0) break;
      kept.push(next);
    }
    if (kept.length < value.length) kept.push(`…[cut: first ${kept.length} of ${value.length} items]`);
    return kept;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrunk(item, cap)]));
  }
  return value;
}

/**
 * `value` in at most about `budget` characters: as it is when it fits,
 * else a copy whose long texts and long lists are cut, each ending with a
 * marker that says how much of it is shown. `cut` tells which.
 */
export function fitValue<T>(value: T, budget = RESULT_CHARACTERS): { value: T; cut: boolean } {
  if (size(value) <= budget) return { value, cut: false };
  let cap = budget;
  let fitted = shrunk(value, cap);
  // The markers and the values around a cut take room too: lower the cap until the whole fits.
  while (size(fitted) > budget && cap > SMALLEST_CUT) {
    cap = Math.max(SMALLEST_CUT, Math.floor(cap * 0.8));
    fitted = shrunk(value, cap);
  }
  return { value: fitted as T, cut: true };
}

/**
 * The leading rows that fit `budget` characters together, never a part of
 * a row. A row larger than the budget alone is shrunk first (`fitValue`),
 * so one long value does not end a page; `cut` says a row was shrunk. At
 * least one row is returned.
 */
export function fitRows<T>(rows: T[], budget = RESULT_CHARACTERS): { rows: T[]; cut: boolean } {
  const fitted: T[] = [];
  let cut = false;
  // Two brackets, and a comma before every further row.
  let used = 2;
  for (const row of rows) {
    const one = fitValue(row, budget);
    used += size(one.value) + (fitted.length === 0 ? 0 : 1);
    if (used > budget && fitted.length > 0) break;
    fitted.push(one.value);
    cut ||= one.cut;
  }
  return { rows: fitted, cut };
}
