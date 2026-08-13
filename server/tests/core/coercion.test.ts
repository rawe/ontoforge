/**
 * Every accept/reject cell of the seven-type coercion table
 * (`docs/capabilities/schema-modeling.md#data-types`). Coercion is strict —
 * values are converted, never guessed — and a boolean is rejected for
 * integer and float BEFORE any numeric conversion.
 */

import { describe, expect, it } from "vitest";

import { CoercionError, coerceValue } from "../../src/core/dataTypes.js";

function rejects(value: unknown, dataType: string): string {
  try {
    coerceValue(value, dataType, "k");
  } catch (error) {
    expect(error).toBeInstanceOf(CoercionError);
    return (error as Error).message;
  }
  throw new Error(`Expected coercion of ${JSON.stringify(value)} as ${dataType} to fail`);
}

describe("null passes through untouched", () => {
  it("returns null for every data type", () => {
    for (const dt of ["string", "integer", "float", "boolean", "date", "datetime", "document"]) {
      expect(coerceValue(null, dt, "k")).toBeNull();
    }
  });
});

describe("string — accepts any JSON scalar, stringified; rejects nothing", () => {
  it("passes strings through", () => {
    expect(coerceValue("hello", "string", "k")).toBe("hello");
  });
  it("stringifies numbers", () => {
    expect(coerceValue(30, "string", "k")).toBe("30");
    expect(coerceValue(1.5, "string", "k")).toBe("1.5");
  });
  it("stringifies booleans in JSON's spelling", () => {
    expect(coerceValue(true, "string", "k")).toBe("true");
    expect(coerceValue(false, "string", "k")).toBe("false");
  });
});

describe("document — behaves as string at coercion time", () => {
  it("passes strings through", () => {
    expect(coerceValue("# Title", "document", "k")).toBe("# Title");
  });
  it("stringifies numbers", () => {
    expect(coerceValue(42, "document", "k")).toBe("42");
  });
});

describe("integer — a boolean is not a number", () => {
  it("accepts a JSON integer", () => {
    expect(coerceValue(30, "integer", "k")).toBe(30);
    expect(coerceValue(-7, "integer", "k")).toBe(-7);
  });
  it("accepts a string parsing as one", () => {
    expect(coerceValue("30", "integer", "k")).toBe(30);
    expect(coerceValue("-12", "integer", "k")).toBe(-12);
  });
  it("rejects booleans, never coercing them to 1", () => {
    expect(rejects(true, "integer")).toBe("Expected integer for 'k', got boolean");
    expect(rejects(false, "integer")).toBe("Expected integer for 'k', got boolean");
  });
  it("rejects a JSON float, naming the value rather than its type", () => {
    expect(rejects(30.5, "integer")).toBe("Expected integer for 'k', got '30.5'");
  });
  it("rejects an unparsable string", () => {
    expect(rejects("abc", "integer")).toBe("Expected integer for 'k', got 'abc'");
    expect(rejects("30.5", "integer")).toBe("Expected integer for 'k', got '30.5'");
  });
  it("rejects structured values", () => {
    expect(rejects([1], "integer")).toBe("Expected integer for 'k', got array");
    expect(rejects({ a: 1 }, "integer")).toBe("Expected integer for 'k', got object");
  });
});

describe("float — a boolean is not a number", () => {
  it("accepts any JSON number", () => {
    expect(coerceValue(1.5, "float", "k")).toBe(1.5);
    expect(coerceValue(3, "float", "k")).toBe(3);
  });
  it("accepts a string parsing as one", () => {
    expect(coerceValue("2.5", "float", "k")).toBe(2.5);
    expect(coerceValue("3", "float", "k")).toBe(3);
  });
  it("rejects booleans, never coercing them to 1", () => {
    expect(rejects(true, "float")).toBe("Expected float for 'k', got boolean");
  });
  it("rejects an unparsable string", () => {
    expect(rejects("abc", "float")).toBe("Expected float for 'k', got 'abc'");
    expect(rejects("", "float")).toBe("Expected float for 'k', got ''");
  });
  it("rejects structured values", () => {
    expect(rejects({}, "float")).toBe("Expected float for 'k', got object");
  });
});

describe("boolean — JSON boolean or the strings true/false, case-insensitive", () => {
  it("accepts JSON booleans", () => {
    expect(coerceValue(true, "boolean", "k")).toBe(true);
    expect(coerceValue(false, "boolean", "k")).toBe(false);
  });
  it("accepts the true/false strings case-insensitively", () => {
    expect(coerceValue("true", "boolean", "k")).toBe(true);
    expect(coerceValue("TRUE", "boolean", "k")).toBe(true);
    expect(coerceValue("False", "boolean", "k")).toBe(false);
  });
  it("rejects numbers", () => {
    expect(rejects(1, "boolean")).toBe("Expected boolean for 'k', got number");
    expect(rejects(0.5, "boolean")).toBe("Expected boolean for 'k', got number");
  });
  it("rejects any other string", () => {
    expect(rejects("yes", "boolean")).toBe("Expected boolean for 'k', got 'yes'");
  });
});

describe("date — ISO calendar date strings only", () => {
  it("accepts an ISO date and returns the ISO string form", () => {
    expect(coerceValue("2024-01-15", "date", "k")).toBe("2024-01-15");
  });
  it("rejects non-ISO strings", () => {
    expect(rejects("15.01.2024", "date")).toBe("Expected ISO date for 'k', got '15.01.2024'");
    expect(rejects("not-a-date", "date")).toBe("Expected ISO date for 'k', got 'not-a-date'");
  });
  it("rejects impossible calendar dates", () => {
    expect(rejects("2024-13-01", "date")).toContain("Expected ISO date for 'k'");
    expect(rejects("2024-02-30", "date")).toContain("Expected ISO date for 'k'");
  });
  it("rejects non-strings", () => {
    expect(rejects(20240115, "date")).toBe("Expected ISO date string for 'k', got number");
    expect(rejects(true, "date")).toBe("Expected ISO date string for 'k', got boolean");
  });
});

describe("datetime — ISO date-time strings; naive means UTC", () => {
  it("accepts a naive date-time as UTC", () => {
    const result = coerceValue("2024-01-15T10:30:00", "datetime", "k") as Date;
    expect(result.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });
  it("accepts an explicit UTC date-time", () => {
    const result = coerceValue("2024-01-15T10:30:00Z", "datetime", "k") as Date;
    expect(result.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });
  it("normalizes an offset date-time to its UTC instant", () => {
    const result = coerceValue("2024-01-15T10:30:00+02:00", "datetime", "k") as Date;
    expect(result.toISOString()).toBe("2024-01-15T08:30:00.000Z");
  });
  it("accepts a bare date as midnight", () => {
    const result = coerceValue("2024-01-15", "datetime", "k") as Date;
    expect(result.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });
  it("accepts fractional seconds", () => {
    const result = coerceValue("2024-01-15T10:30:00.250Z", "datetime", "k") as Date;
    expect(result.toISOString()).toBe("2024-01-15T10:30:00.250Z");
  });
  it("rejects non-ISO strings", () => {
    expect(rejects("soon", "datetime")).toBe("Expected ISO datetime for 'k', got 'soon'");
  });
  it("rejects out-of-range components", () => {
    expect(rejects("2024-01-15T25:00:00", "datetime")).toContain("Expected ISO datetime");
  });
  it("rejects non-strings", () => {
    expect(rejects(1705315800, "datetime")).toBe(
      "Expected ISO datetime string for 'k', got number",
    );
  });
});

describe("unknown data type", () => {
  it("is rejected with the type named", () => {
    expect(rejects("x", "uuid")).toBe("Unknown data type 'uuid' for 'k'");
  });
});
