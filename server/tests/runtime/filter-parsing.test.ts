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
      { age__ne: "0", age__gt: "1", age__gte: "2", age__lt: "3", age__lte: "4" },
      DEFS,
      "person",
    );
    expect(conditions.map((c) => (c as { op: string }).op)).toEqual(["ne", "gt", "gte", "lt", "lte"]);
    expect(conditions.map((c) => (c as { value: unknown }).value)).toEqual([0, 1, 2, 3, 4]);
  });

  it("__ne is a comparison: the value is coerced by the declared type", () => {
    expect(parseFilterConditions({ active__ne: "true" }, DEFS, "person")).toEqual([
      { kind: "property", propertyKey: "active", dataType: "boolean", op: "ne", value: true },
    ]);
    try {
      parseFilterConditions({ age__ne: "abc" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toBe("Invalid filter value for 'age'");
    }
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

describe("existence conditions — __exists and __missing carry a flag, never a value", () => {
  it("__exists=true and __exists=false parse to the property existence condition", () => {
    expect(
      parseFilterConditions({ age__exists: "true", name__exists: "false" }, DEFS, "person"),
    ).toEqual([
      { kind: "property-existence", propertyKey: "age", exists: true },
      { kind: "property-existence", propertyKey: "name", exists: false },
    ]);
  });

  it("__missing inverts the flag, so __missing=true is __exists=false", () => {
    expect(
      parseFilterConditions({ age__missing: "true", name__missing: "false" }, DEFS, "person"),
    ).toEqual([
      { kind: "property-existence", propertyKey: "age", exists: false },
      { kind: "property-existence", propertyKey: "name", exists: true },
    ]);
  });

  it("the property's data type takes no part — a document property is testable and nothing is coerced by it", () => {
    expect(parseFilterConditions({ bio__exists: "TRUE" }, DEFS, "person")).toEqual([
      { kind: "property-existence", propertyKey: "bio", exists: true },
    ]);
  });

  it("the flag must be a boolean, reported as an invalid value under the key as sent", () => {
    try {
      parseFilterConditions({ age__exists: "yes" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Invalid filter value for 'age'");
      expect((error as ValidationError).details).toEqual({
        fields: { age__exists: "Expected boolean for 'age', got 'yes'" },
      });
    }
  });

  it("an unknown subject is the unknown-property fault; without a path schema a relation type cannot be the subject", () => {
    try {
      parseFilterConditions({ ghost__missing: "true" }, DEFS, "person");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toBe("Unknown filter property: 'ghost'");
      expect((error as ValidationError).details).toEqual({
        fields: { ghost__missing: "Not defined in type 'person'" },
      });
    }
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
