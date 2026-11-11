/**
 * The size rule of the agent's tool results: leading rows that fit the
 * bound, and one oversized row or value shrunk with a marker that says
 * how much of it is shown.
 */

import { describe, expect, it } from "vitest";

import { fitRows, fitText, fitValue, RESULT_CHARACTERS } from "../../../../src/runtime/assistants/agents/resultSize.js";

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

  it("keeps the bound when the first row is a wide object", () => {
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`property_${i}`, "v".repeat(64)]));

    const fitted = fitRows([wide, { id: 2 }]);

    expect(fitted.cut).toBe(true);
    expect(size(fitted.rows)).toBeLessThanOrEqual(RESULT_CHARACTERS);
  });

  it("shrinks a row larger than the bound alone to the bound, where it fills a result of its own", () => {
    const rows = [{ id: 1, text: "x".repeat(100_000) }, { id: 2, text: "short" }, { id: 3, text: "y".repeat(30_000) }];

    const first = fitRows(rows);
    expect(first.cut).toBe(true);
    expect(first.rows.map((row) => row.id)).toEqual([1]);
    expect(first.rows[0]!.text).toMatch(/…\[cut: first \d+ of 100000 characters; asking again returns the same part\]$/);
    expect(size(first.rows)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    expect(size(first.rows)).toBeGreaterThan(RESULT_CHARACTERS * 0.95);

    // A small row before a large one keeps its place; the large one starts the next result.
    expect(fitRows(rows.slice(1)).rows).toEqual([{ id: 2, text: "short" }]);
  });

  it("keeps the values named to it whatever an object loses", () => {
    const wide = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`property_${i}`, "v".repeat(64)]));

    const fitted = fitValue({ ...wide, display_title: "Acme", direction: "outgoing" }, RESULT_CHARACTERS, new Set(["display_title"]));

    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    expect(fitted.value.display_title).toBe("Acme");
    expect(fitted.value).not.toHaveProperty("direction");
    expect(fitRows([{ ...wide, display_title: "Acme" }], RESULT_CHARACTERS, new Set(["display_title"])).rows[0]!.display_title).toBe("Acme");
  });

  it("returns one row at least, shrunk to the bound", () => {
    const fitted = fitRows([{ id: 1, text: "x".repeat(100_000) }]);
    expect(fitted.rows).toHaveLength(1);
    expect(fitted.cut).toBe(true);
    expect(size(fitted.rows)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    // The bound is used, not a fraction of it.
    expect(size(fitted.rows)).toBeGreaterThan(RESULT_CHARACTERS * 0.95);
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
    expect(bio).toMatch(/^y+…\[cut: first \d+ of 100000 characters; asking again returns the same part\]$/);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
  });

  it("cuts a long list to its leading items and says how many are shown", () => {
    const names = Array.from({ length: 20_000 }, (_, i) => `name-${i}`);
    const fitted = fitValue({ company: "Acme", people: names });
    const people = fitted.value.people;
    expect(fitted.cut).toBe(true);
    expect(people.slice(0, 3)).toEqual(["name-0", "name-1", "name-2"]);
    expect(people[people.length - 1]).toMatch(/^…\[cut: first \d+ of 20000 items\]$/);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
  });

  it("shrinks several long values until the whole fits", () => {
    const fitted = fitValue({ a: "a".repeat(20_000), b: "b".repeat(20_000), c: "c".repeat(20_000) });
    expect(fitted.cut).toBe(true);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    for (const text of Object.values(fitted.value)) expect(text).toMatch(/…\[cut: first \d+ of 20000 characters; asking again returns the same part\]$/);
  });

  it("drops trailing values of an object that is too large although no value of it is long", () => {
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`property_${i}`, "v".repeat(64)]));

    const fitted = fitValue(wide);

    expect(fitted.cut).toBe(true);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    expect(Object.keys(fitted.value)[0]).toBe("property_0");
    expect((fitted.value as Record<string, string>)["…"]).toMatch(/^\[cut: first \d+ of 400 values\]$/);
  });

  it("keeps an object's system fields whatever else it loses, also when its values are objects", () => {
    const stubs = Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`doc_${i}`, { document: true, length: 5_000 + i }]));
    const entity = { ...stubs, _id: "c1", _entityTypeKey: "company" };

    const fitted = fitValue(entity);

    expect(fitted.cut).toBe(true);
    expect(size(fitted.value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
    expect(fitted.value).toMatchObject({ _id: "c1", _entityTypeKey: "company", doc_0: { document: true, length: 5_000 } });
    expect((fitted.value as Record<string, unknown>)["…"]).toMatch(/^\[cut: first \d+ of 1000 values\]$/);
  });

  it("leaves an object an object and a list a list, whatever they hold", () => {
    const object = fitValue({ [`k${"k".repeat(30_000)}`]: 1, _id: "x" }).value as Record<string, unknown>;
    expect(object).toEqual({ _id: "x", "…": "[cut: first 0 of 1 values]" });

    const list = fitValue([`v${"v".repeat(100_000)}`]).value;
    expect(Array.isArray(list)).toBe(true);
    expect(size(list)).toBeLessThanOrEqual(RESULT_CHARACTERS);
  });

  it("keeps the bound for whatever it is given", () => {
    const awkward = [
      { [`k${"k".repeat(30_000)}`]: 1 },
      Array.from({ length: 5_000 }, (_, i) => ({ id: i, text: "t".repeat(200) })),
      { nested: { deep: Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`p${i}`, i])) } },
    ];
    for (const value of awkward) expect(size(fitValue(value).value)).toBeLessThanOrEqual(RESULT_CHARACTERS);
  });

  it("counts characters, not code units, and never splits one", () => {
    const fitted = fitValue({ text: "😀".repeat(30_000) });
    expect(fitted.value.text).toMatch(/^(😀)+…\[cut: first \d+ of 30000 characters; asking again returns the same part\]$/u);
  });

  it("does not change the value it was given", () => {
    const value = { text: "x".repeat(100_000), list: Array.from({ length: 10_000 }, () => "item") };
    fitValue(value);
    expect(value.text).toHaveLength(100_000);
    expect(value.list).toHaveLength(10_000);
  });
});

describe("fitText", () => {
  it("leaves a text that fits written out as it is", () => {
    expect(fitText("plain text", 100)).toBe("plain text");
  });

  it("ends a text where its JSON reaches the room, never inside a character", () => {
    const text = 'a"\n😀'.repeat(1_000);

    const fitted = fitText(text, 1_000);

    expect(text.startsWith(fitted)).toBe(true);
    expect(size(fitted)).toBeLessThanOrEqual(1_000);
    expect(size(fitted)).toBeGreaterThan(990);
    expect(fitted.endsWith("\ud83d")).toBe(false);
  });

  it("answers an empty text when nothing fits", () => {
    expect(fitText("abc", 1)).toBe("");
  });
});
