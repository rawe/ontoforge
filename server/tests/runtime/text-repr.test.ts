/**
 * Entity embedding text composition — ported from
 * `backend/tests/test_text_repr.py`, one test per composition rule of
 * `docs/capabilities/search.md#what-gets-embedded`.
 */

import { describe, expect, it, vi } from "vitest";

import { MAX_TEXT_CHARS, buildTextRepr } from "../../src/runtime/search/property.js";
import { buildKeywordSegments, keywordText } from "../../src/runtime/search/propertyText.js";
import type { PropertyDef } from "../../src/core/schemas.js";

function prop(key: string, dataType = "string", required = false): PropertyDef {
  return {
    key,
    displayName: key,
    description: null,
    dataType,
    required,
    defaultValue: null,
  };
}

describe("buildTextRepr", () => {
  it("includes string properties only", () => {
    const result = buildTextRepr(
      "person",
      { name: "Alice", age: 30, bio: "Engineer" },
      { name: prop("name"), age: prop("age", "integer"), bio: prop("bio") },
    );
    expect(result).toBe("person: name=Alice, bio=Engineer");
  });

  it("skips null values", () => {
    const result = buildTextRepr(
      "person",
      { name: "Alice", bio: null },
      { name: prop("name"), bio: prop("bio") },
    );
    expect(result).toBe("person: name=Alice");
  });

  it("follows schema declaration order, not payload order", () => {
    const result = buildTextRepr(
      "person",
      { bio: "Engineer", name: "Alice", role: "Lead" },
      { name: prop("name"), role: prop("role"), bio: prop("bio") },
    );
    expect(result).toBe("person: name=Alice, role=Lead, bio=Engineer");
  });

  it("falls back to the bare type key when no string property has a value", () => {
    expect(buildTextRepr("counter", { count: 5 }, { count: prop("count", "integer") })).toBe(
      "counter",
    );
  });

  it("handles an empty property map", () => {
    expect(buildTextRepr("empty_type", {}, {})).toBe("empty_type");
  });

  it("excludes integer, float, and boolean values", () => {
    const result = buildTextRepr(
      "person",
      { name: "Bob", age: 25, score: 9.5, active: true, email: "bob@test.com" },
      {
        name: prop("name"),
        age: prop("age", "integer"),
        score: prop("score", "float"),
        active: prop("active", "boolean"),
        email: prop("email"),
      },
    );
    expect(result).toBe("person: name=Bob, email=bob@test.com");
  });

  it("truncates at the 30000-char cap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const longValue = "x".repeat(MAX_TEXT_CHARS + 1000);
    const result = buildTextRepr("doc", { content: longValue }, { content: prop("content") });
    expect(result.length).toBe(MAX_TEXT_CHARS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("excludes document values from the entity embedding text", () => {
    const result = buildTextRepr(
      "person",
      { name: "Alice", bio: "# A very long markdown biography..." },
      { name: prop("name"), bio: prop("bio", "document") },
    );
    expect(result).toBe("person: name=Alice");
  });

  it("is deterministic", () => {
    const defs = { name: prop("name"), role: prop("role") };
    const props = { role: "Lead", name: "Alice" };
    expect(buildTextRepr("person", props, defs)).toBe(buildTextRepr("person", props, defs));
  });
});

describe("property keyword source segments", () => {
  it("retains values and full schema order, excluding keys, documents, dates and undeclared values", () => {
    const defs = { role: prop("role"), name: prop("name"), doc: prop("doc", "document"), date: prop("date", "date") };
    const segments = buildKeywordSegments({ name: "Alice", role: "Engineer", doc: "secret", date: "2025-01-01", extra: "no" }, defs);
    expect(segments).toEqual([{ propertyKey: "role", text: "Engineer" }, { propertyKey: "name", text: "Alice" }]);
    expect(keywordText(segments)).toBe("Engineer\nAlice");
  });
  it("indexes nothing for missing, empty or invalid non-string values", () => {
    expect(buildKeywordSegments({ name: null, role: "", age: 1 }, { name: prop("name"), role: prop("role"), age: prop("age") })).toEqual([]);
    expect(keywordText([])).toBe("");
  });
  it("preserves punctuation and delimiters without trying to parse labeled semantic text", () => {
    const value = "name=Alice, role=Engineer\nstate-of-the-art: alpha-beta; user's@example.com";
    const segments = buildKeywordSegments({ name: value }, { name: prop("name") });
    expect(segments).toEqual([{ propertyKey: "name", text: value }]);
    expect(keywordText(segments)).toBe(value);
  });
  it("truncates by codepoint and includes separators in the exact 30,000-character budget", () => {
    const segments = buildKeywordSegments({ name: "😀".repeat(MAX_TEXT_CHARS - 3), role: "ABCD", extra: "ignored" },
      { name: prop("name"), role: prop("role"), extra: prop("extra") });
    expect(segments[1]).toEqual({ propertyKey: "role", text: "AB" });
    expect(segments).toHaveLength(2);
    expect([...keywordText(segments)]).toHaveLength(MAX_TEXT_CHARS);
  });
  it("does not retain a phantom field when the remaining budget is only its separator", () => {
    const segments = buildKeywordSegments({ name: "x".repeat(MAX_TEXT_CHARS - 1), role: "engineer" }, { name: prop("name"), role: prop("role") });
    expect(segments).toHaveLength(1);
  });
});
