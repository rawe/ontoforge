/**
 * The PostgreSQL value-encoding module: only datetime is non-JSON-native
 * at the port, so `toJson` and `fromJson` convert exactly the datetime
 * keys and pass every other value through untouched. Together with
 * `JSON.stringify`/jsonb parsing they give the per-type round trip.
 */

import { describe, expect, it } from "vitest";

import { fromJson, toJson } from "../../../src/adapters/postgres/json.js";
import type { PropertyDef } from "../../../src/core/schemas.js";

function prop(key: string, dataType: string): PropertyDef {
  return { key, displayName: key, description: null, dataType, required: false, defaultValue: null };
}

const DEFS: Record<string, PropertyDef> = {
  name: prop("name", "string"),
  age: prop("age", "integer"),
  score: prop("score", "float"),
  active: prop("active", "boolean"),
  founded: prop("founded", "date"),
  seen_at: prop("seen_at", "datetime"),
  bio: prop("bio", "document"),
};

describe("toJson — the write conversion", () => {
  it("converts datetime Dates to their toISOString text", () => {
    const out = toJson({ seen_at: new Date("2024-01-15T10:30:00Z") }, DEFS);
    expect(out.seen_at).toBe("2024-01-15T10:30:00.000Z");
  });

  it("passes every other declared type through untouched", () => {
    const props = {
      name: "Alice",
      age: 30,
      score: 2.5,
      active: true,
      founded: "2020-01-01",
      bio: "# Title",
    };
    expect(toJson(props, DEFS)).toEqual(props);
  });

  it("passes keys without a definition through untouched — the _doc_*_length counter rides along", () => {
    const out = toJson({ _doc_bio_length: 7 }, DEFS);
    expect(out).toEqual({ _doc_bio_length: 7 });
  });

  it("does not mutate its input", () => {
    const props = { seen_at: new Date("2024-01-15T10:30:00Z") };
    toJson(props, DEFS);
    expect(props.seen_at).toBeInstanceOf(Date);
  });
});

describe("fromJson — the read conversion", () => {
  it("converts only the datetime keys back to JS Dates", () => {
    const out = fromJson(
      { name: "Alice", seen_at: "2024-01-15T10:30:00.000Z", founded: "2020-01-01" },
      DEFS,
    );
    expect(out.seen_at).toEqual(new Date("2024-01-15T10:30:00.000Z"));
    expect(out.name).toBe("Alice");
    expect(out.founded).toBe("2020-01-01"); // date stays the ISO string — the port form
  });

  it("leaves an absent datetime key absent — no present-but-null state", () => {
    const out = fromJson({ name: "Alice" }, DEFS);
    expect("seen_at" in out).toBe(false);
  });
});

describe("round trip", () => {
  it("write conversion, jsonb text, read conversion — identical values per type", () => {
    const props = {
      name: "Alice",
      age: 30,
      score: 2.5,
      active: false,
      founded: "2020-01-01",
      seen_at: new Date("2024-01-15T10:30:00.123Z"),
      bio: "long text",
      _doc_bio_length: 9,
    };
    // The pg driver parses jsonb via JSON.parse; stringify mimics the write.
    const stored = JSON.parse(JSON.stringify(toJson(props, DEFS))) as Record<string, unknown>;
    expect(fromJson(stored, DEFS)).toEqual(props);
  });
});
