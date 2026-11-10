/**
 * The size rule of the agent's tool results: leading rows that fit the
 * bound, and one oversized row or value shrunk with a marker that says
 * how much of it is shown.
 */

import { describe, expect, it } from "vitest";

import { fitRows, fitValue, RESULT_CHARACTERS } from "../../../../src/runtime/assistants/agents/resultSize.js";

const size = (value: unknown) => JSON.stringify(value).length;

describe("fitRows", () => {
  it("keeps every row when they fit together", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    expect(fitRows(rows)).toEqual({ rows, cut: false });
  });

  it("keeps the leading rows that fit together, in order, never a part of a row", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, text: "x".repeat(990) }));
    const fitted = fitRows(rows);
    expect(fitted.rows.length).toBeGreaterThan(1);
    expect(fitted.rows.length).toBeLessThan(100);
    expect(fitted.rows).toEqual(rows.slice(0, fitted.rows.length));
    expect(size(fitted.rows)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    // The next row would not have fitted.
    expect(size(rows.slice(0, fitted.rows.length + 1))).toBeGreaterThan(RESULT_CHARACTERS);
    expect(fitted.cut).toBe(false);
  });

  it("returns one row, shrunk, when the first alone is larger than the bound", () => {
    const fitted = fitRows([{ id: 1, text: "x".repeat(100_000) }, { id: 2, text: "short" }]);
    expect(fitted.rows).toHaveLength(1);
    expect(fitted.cut).toBe(true);
    expect(size(fitted.rows)).toBeLessThanOrEqual(RESULT_CHARACTERS + 100);
    expect((fitted.rows[0] as { id: number }).id).toBe(1);
  });

  it("answers no rows with no rows", () => {
    expect(fitRows([])).toEqual({ rows: [], cut: false });
  });

  it("takes the bound it is given", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i, text: "x".repeat(90) }));
    expect(fitRows(rows, 350).rows).toHaveLength(3);
  });
});

describe("fitValue", () => {
  it("leaves a value that fits as it is", () => {
    const value = { name: "Alice", tags: ["a", "b"], nested: { n: 1 } };
    const fitted = fitValue(value);
    expect(fitted.value).toBe(value);
    expect(fitted.cut).toBe(false);
  });

  it("cuts a long text and says how much of it is shown", () => {
    const fitted = fitValue({ name: "Alice", bio: "y".repeat(100_000) });
    const { name, bio } = fitted.value;
    expect(fitted.cut).toBe(true);
    expect(name).toBe("Alice");
    expect(bio).toMatch(/^y+…\[cut: first \d+ of 100000 characters\]$/);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS + 100);
  });

  it("cuts a long list to its leading items and says how many are shown", () => {
    const names = Array.from({ length: 20_000 }, (_, i) => `name-${i}`);
    const fitted = fitValue({ company: "Acme", people: names });
    const people = fitted.value.people;
    expect(fitted.cut).toBe(true);
    expect(people.slice(0, 3)).toEqual(["name-0", "name-1", "name-2"]);
    expect(people[people.length - 1]).toMatch(/^…\[cut: first \d+ of 20000 items\]$/);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS + 100);
  });

  it("shrinks several long values until the whole fits", () => {
    const fitted = fitValue({ a: "a".repeat(20_000), b: "b".repeat(20_000), c: "c".repeat(20_000) });
    expect(fitted.cut).toBe(true);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS + 300);
    for (const text of Object.values(fitted.value)) expect(text).toMatch(/…\[cut: first \d+ of 20000 characters\]$/);
  });

  it("counts characters, not code units, and never splits one", () => {
    const fitted = fitValue({ text: "😀".repeat(30_000) });
    expect(fitted.value.text).toMatch(/^(😀)+…\[cut: first \d+ of 30000 characters\]$/u);
  });

  it("does not change the value it was given", () => {
    const value = { text: "x".repeat(100_000), list: Array.from({ length: 10_000 }, () => "item") };
    fitValue(value);
    expect(value.text).toHaveLength(100_000);
    expect(value.list).toHaveLength(10_000);
  });
});
