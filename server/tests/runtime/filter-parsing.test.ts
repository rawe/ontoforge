/**
 * The shared filter parser — request validation above the port. Every
 * backend receives only parsed, coerced conditions; the three faults
 * (unknown property, uncoercible value, unknown operator — at most one
 * per filter key, checked in that order) are collected across keys and
 * raised here once, identically for every adapter.
 */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/exceptions.js";
import { parseFilterConditions } from "../../src/runtime/service.js";
import { DEFS } from "../propertyDefs.js";

describe("parsed conditions — the tagged property condition", () => {
  it("a bare key parses as equality with the value coerced to the declared type", () => {
    const conditions = parseFilterConditions({ age: "30" }, DEFS, "person");
    expect(conditions).toEqual([
      { kind: "property", propertyKey: "age", dataType: "integer", op: "eq", value: 30 },
    ]);
  });

  it("comparison suffixes map to their operators", () => {
    const conditions = parseFilterConditions(
      { age__gt: "1", age__gte: "2", age__lt: "3", age__lte: "4" },
      DEFS,
      "person",
    );
    expect(conditions.map((c) => c.op)).toEqual(["gt", "gte", "lt", "lte"]);
    expect(conditions.map((c) => c.value)).toEqual([1, 2, 3, 4]);
  });

  it("__contains compares textually and skips type coercion", () => {
    // An integer property under __contains accepts a non-numeric value.
    const conditions = parseFilterConditions({ age__contains: "3x" }, DEFS, "person");
    expect(conditions).toEqual([
      { kind: "property", propertyKey: "age", dataType: "integer", op: "contains", value: "3x" },
    ]);
  });

  it("__contains rejects the NUL character with the coercion wording", () => {
    try {
      parseFilterConditions({ name__contains: "a\u0000b" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Invalid filter value for 'name'");
      expect(
        ((error as ValidationError).details as { fields: Record<string, string> }).fields
          .name__contains,
      ).toBe("String value for 'name' must not contain the NUL character");
    }
  });

  it("values coerce per declared type: float, boolean, date, datetime", () => {
    const conditions = parseFilterConditions(
      {
        score__gte: "2.5",
        active: "true",
        founded__lt: "2020-01-01",
        seen_at__gte: "2024-01-15T10:30:00Z",
      },
      DEFS,
      "person",
    );
    expect(conditions[0]!.value).toBe(2.5);
    expect(conditions[1]!.value).toBe(true);
    expect(conditions[2]!.value).toBe("2020-01-01");
    expect(conditions[3]!.value).toEqual(new Date("2024-01-15T10:30:00.000Z"));
  });
});

describe("the three faults — property, then value, then operator, one per key", () => {
  it("an unknown property", () => {
    try {
      parseFilterConditions({ ghost: "x" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Unknown filter property: 'ghost'");
      expect((error as ValidationError).details).toEqual({
        fields: { ghost: "Not defined in type 'person'" },
      });
    }
  });

  it("an uncoercible value", () => {
    try {
      parseFilterConditions({ age: "abc" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Invalid filter value for 'age'");
      expect(
        ((error as ValidationError).details as { fields: Record<string, string> }).fields.age,
      ).toContain("Expected integer");
    }
  });

  it("an unknown operator suffix", () => {
    try {
      parseFilterConditions({ age__between: "1" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Unknown filter operator: 'between'");
      expect((error as ValidationError).details).toEqual({
        fields: { age__between: "Unsupported operator 'between'" },
      });
    }
  });

  it("the value is checked before the operator — an uncoercible value under an unknown operator reports the value", () => {
    try {
      parseFilterConditions({ age__between: "abc" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Invalid filter value for 'age'");
    }
  });

  it("the operator is the segment after the LAST __ — a key containing __ cannot be filtered", () => {
    // `notes__raw` parses as property `notes` + operator `raw`; the
    // property lookup fails first.
    try {
      parseFilterConditions({ notes__raw: "x" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Unknown filter property: 'notes'");
    }
  });
});

describe("faults are collected across filter keys", () => {
  it("several faulty keys are rejected once, each under its own key with its own message", () => {
    try {
      parseFilterConditions(
        { ghost: "x", age: "abc", score__between: "1", name: "Alice" },
        DEFS,
        "person",
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(
        "Unknown filter property: 'ghost'; " +
          "Invalid filter value for 'age'; " +
          "Unknown filter operator: 'between'",
      );
      expect((error as ValidationError).details).toEqual({
        fields: {
          ghost: "Not defined in type 'person'",
          age: expect.stringContaining("Expected integer"),
          score__between: "Unsupported operator 'between'",
        },
      });
    }
  });
});

describe("each faulty filter key is reported under the key the caller sent", () => {
  it("two bounds on one property that both fail keep both faults", () => {
    try {
      parseFilterConditions({ age__gt: "abc", age__lt: "xyz" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Invalid filter value for 'age'");
      expect(
        Object.keys(((error as ValidationError).details as { fields: Record<string, string> }).fields),
      ).toEqual(["age__gt", "age__lt"]);
    }
  });

  it("a bare key is its own filter key, so a single fault reads as before", () => {
    try {
      parseFilterConditions({ age: "abc" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toBe("Invalid filter value for 'age'");
      expect(
        Object.keys(((error as ValidationError).details as { fields: Record<string, string> }).fields),
      ).toEqual(["age"]);
    }
  });
});
