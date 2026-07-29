/**
 * The adapter predicate builder (port of the Python `filters.py`): values
 * always cross into Cypher as bound parameters, identifiers come only from
 * the stored schema, the operator is the segment after the LAST `__`, and
 * coercion follows the property's declared type (`__contains` is textual).
 */

import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/exceptions.js";
import {
  buildFilterClauses,
  buildSearchClause,
} from "../../src/adapters/neo4j/filters.js";
import type { PropertyDef } from "../../src/runtime/schemaCache.js";

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
};

describe("clause construction", () => {
  it("no suffix means equality, with the value bound — never interpolated", () => {
    const [clauses, params] = buildFilterClauses({ name: "Alice" }, DEFS, "person");
    expect(clauses).toEqual(["n.name = $flt_0"]);
    expect(params.flt_0).toBe("Alice");
  });

  it("comparison suffixes map to their operators", () => {
    const [clauses] = buildFilterClauses(
      { age__gt: "1", age__gte: "2", age__lt: "3", age__lte: "4" },
      DEFS,
      "person",
    );
    expect(clauses).toEqual([
      "n.age > $flt_0",
      "n.age >= $flt_1",
      "n.age < $flt_2",
      "n.age <= $flt_3",
    ]);
  });

  it("__contains compares as lowered text and skips type coercion", () => {
    // An integer property under __contains accepts a non-numeric value.
    const [clauses, params] = buildFilterClauses({ age__contains: "3x" }, DEFS, "person");
    expect(clauses).toEqual(["toLower(toString(n.age)) CONTAINS toLower($flt_0)"]);
    expect(params.flt_0).toBe("3x");
  });

  it("a custom node alias is honoured", () => {
    const [clauses] = buildFilterClauses({ name: "A" }, DEFS, "person", "r");
    expect(clauses).toEqual(["r.name = $flt_0"]);
  });
});

describe("coercion per declared type", () => {
  it("integer values become driver integers", () => {
    const [, params] = buildFilterClauses({ age: "30" }, DEFS, "person");
    expect(neo4j.isInt(params.flt_0)).toBe(true);
    expect((params.flt_0 as { toNumber(): number }).toNumber()).toBe(30);
  });

  it("float values stay numbers", () => {
    const [, params] = buildFilterClauses({ score__gte: "2.5" }, DEFS, "person");
    expect(params.flt_0).toBe(2.5);
  });

  it("boolean values coerce from their string form", () => {
    const [, params] = buildFilterClauses({ active: "true" }, DEFS, "person");
    expect(params.flt_0).toBe(true);
  });

  it("date values become driver dates", () => {
    const [, params] = buildFilterClauses({ founded__lt: "2020-01-01" }, DEFS, "person");
    expect(params.flt_0).toBeInstanceOf(neo4j.types.Date);
    expect(String(params.flt_0)).toBe("2020-01-01");
  });

  it("datetime values become driver datetimes", () => {
    const [, params] = buildFilterClauses(
      { seen_at__gte: "2024-01-15T10:30:00Z" },
      DEFS,
      "person",
    );
    expect(params.flt_0).toBeInstanceOf(neo4j.types.DateTime);
  });
});

describe("rejections — each names the filter in details.fields", () => {
  it("an unknown property", () => {
    expect(() => buildFilterClauses({ ghost: "x" }, DEFS, "person")).toThrowError(
      ValidationError,
    );
    try {
      buildFilterClauses({ ghost: "x" }, DEFS, "person");
    } catch (error) {
      expect((error as ValidationError).details).toEqual({
        fields: { ghost: "Not defined in type 'person'" },
      });
    }
  });

  it("an unknown operator suffix", () => {
    try {
      buildFilterClauses({ age__between: "1" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual({
        fields: { age__between: "Unsupported operator 'between'" },
      });
    }
  });

  it("an uncoercible value", () => {
    try {
      buildFilterClauses({ age: "abc" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(((error as ValidationError).details as { fields: Record<string, string> }).fields.age)
        .toContain("Expected integer");
    }
  });

  it("the operator is the segment after the LAST __ — a key containing __ cannot be filtered", () => {
    // `notes__raw` parses as property `notes` + operator `raw`; the
    // property lookup fails first, exactly as in the Python reference.
    try {
      buildFilterClauses({ notes__raw: "x" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Unknown filter property: 'notes'");
    }
  });
});

describe("free-text search clause", () => {
  it("ORs a lowered CONTAINS over every given string property", () => {
    const [clause, params] = buildSearchClause("ali", ["name", "email"]);
    expect(clause).toBe(
      "(toLower(toString(n.name)) CONTAINS toLower($q_search) OR " +
        "toLower(toString(n.email)) CONTAINS toLower($q_search))",
    );
    expect(params).toEqual({ q_search: "ali" });
  });
});
