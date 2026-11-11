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

/** The least budget a value is fitted to: room for an object's system
 * fields and a marker. Every caller leaves far more; a smaller budget is
 * read as this one. */
export const LEAST_BUDGET = 256;

/** The characters `value` takes as JSON. */
export const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

/** The keys an object keeps beside its system fields, whatever it loses:
 * an entity its name, by its own type. Asked of every object met. */
export type Kept = (object: Record<string, unknown>) => readonly string[];

const NOTHING_MORE: Kept = () => [];

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

/**
 * The shortening of one value, pass after pass with a falling `cap`:
 * every text longer than `cap` characters is cut to them and every list
 * to the leading items that take `cap` characters; with `wide`, an object
 * larger than `cap` too is cut, to the values it always keeps — its
 * system fields (its id, its type) and those `keep` names for it — and
 * the leading other values that take the rest. A long text is measured
 * once for all passes, and only its start is ever copied.
 */
function shortening(keep: Kept): (value: unknown, cap: number, wide: boolean) => unknown {
  const lengths = new Map<string, number>();
  const lengthOf = (text: string): number => {
    let length = lengths.get(text);
    if (length === undefined) lengths.set(text, (length = cpLength(text)));
    return length;
  };
  const shrunk = (value: unknown, cap: number, wide: boolean): unknown => {
    if (typeof value === "string") {
      // The code units bound the code points, so a short text is not counted.
      if (value.length <= cap) return value;
      const length = lengthOf(value);
      if (length <= cap) return value;
      // `cap` characters lie within the first `2 * cap` code units.
      return `${cpSlice(value.slice(0, 2 * cap), 0, cap)}…[cut: first ${cap} of ${length} characters; asking again returns the same part]`;
    }
    if (Array.isArray(value)) {
      const first = leading(value.map((item) => shrunk(item, cap, wide)), cap, 1);
      if (first.length < value.length) first.push(`…[cut: first ${first.length} of ${value.length} items]`);
      return first;
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value).map(([key, item]) => [key, shrunk(item, cap, wide)] as const);
      if (!wide || size(Object.fromEntries(entries)) <= cap) return Object.fromEntries(entries);
      const own = keep(value);
      const always = ([key]: readonly [string, unknown]) => key.startsWith("_") || own.includes(key);
      const others = entries.filter((entry) => !always(entry));
      const first = new Set(leading(others, cap - size(Object.fromEntries(entries.filter(always))), 0));
      return Object.fromEntries([
        ...entries.filter((entry) => always(entry) || first.has(entry)),
        ["…", `[cut: first ${first.size} of ${others.length} values]`],
      ]);
    }
    return value;
  };
  return shrunk;
}

/** What is left of a value nothing shortens enough: its shape and a marker
 * — an object its system fields, a list nothing. */
function remnant(value: unknown): unknown {
  const marker = `[cut: a value of ${size(value)} characters that does not fit a result]`;
  if (Array.isArray(value)) return [`…${marker}`];
  if (!isPlainObject(value)) return `…${marker}`;
  return Object.fromEntries([...Object.entries(value).filter(([key]) => key.startsWith("_")), ["…", marker]]);
}

/**
 * `value` in at most `budget` characters: as it is when it fits, else a
 * copy whose long texts and long lists are cut, each ending with a marker
 * that says how much of it is shown — and, when that is not enough, whose
 * objects keep only their system fields, the values `keep` names for them
 * (an entity's name) and their leading other values. An object stays an
 * object and a list a list. `cut` tells which. A budget below
 * `LEAST_BUDGET` is read as that.
 */
export function fitValue<T>(value: T, budget = RESULT_CHARACTERS, keep: Kept = NOTHING_MORE): { value: T; cut: boolean } {
  const room = Math.max(budget, LEAST_BUDGET);
  if (size(value) <= room) return { value, cut: false };
  const shrunk = shortening(keep);
  // Texts and lists first; an object loses values only when it is still too large.
  for (const wide of [false, true]) {
    let cap = Math.max(SMALLEST_CUT, room);
    let before = Infinity;
    // The first excess is taken off the cap as it is — the markers and the
    // values around a cut take room too — so the result uses its bound;
    // after that the cap falls by a fifth, so the passes stay few.
    let exact = true;
    for (;;) {
      const fitted = shrunk(value, cap, wide);
      const now = size(fitted);
      if (now <= room) return { value: fitted as T, cut: true };
      // Cutting texts and lists further changes nothing: it is the object that is too large.
      if (cap === SMALLEST_CUT || (!wide && now >= before)) break;
      const fifth = Math.floor(cap * 0.8);
      cap = Math.max(SMALLEST_CUT, exact ? Math.min(cap - 1, Math.max(cap - (now - room) - MARKER_ROOM, fifth)) : fifth);
      exact = false;
      before = now;
    }
  }
  return { value: remnant(value) as T, cut: true };
}

/**
 * The leading rows that fit `budget` characters together, never a part of
 * a row. A row larger than the budget alone is shrunk first (`fitValue`),
 * so one long value does not end a page; `cut` says a row was shrunk. At
 * least one row is returned.
 */
export function fitRows<T>(rows: T[], budget = RESULT_CHARACTERS, keep: Kept = NOTHING_MORE): { rows: T[]; cut: boolean } {
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
