/**
 * The PostgreSQL predicate builder: pure fragment assembly over parsed
 * conditions. Property keys AND values are bound parameters — nothing is
 * interpolated, so injection via key is impossible by construction. The
 * jsonb accessor casts follow the encoding table; the substring idiom is
 * position() over lowered text; sorting is typed, its direction a
 * build-time literal, with the `id` tie-break appended for deterministic
 * pagination.
 */

import { describe, expect, it } from "vitest";

import {
  buildEndpointClauses,
  buildFilterClauses,
  buildOrderBy,
  buildSearchClause,
} from "../../../src/adapters/postgres/filters.js";
import { cond, DEFS } from "../../propertyDefs.js";

describe("operator x type mapping — key and value both bound", () => {
  it("string equality reads the text accessor", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("name", "string", "eq", "Alice")], params);
    expect(clauses).toEqual(["props->>$1 = $2"]);
    expect(params).toEqual(["name", "Alice"]);
  });

  it("document properties use the text accessor too", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("bio", "document", "eq", "text")], params);
    expect(clauses).toEqual(["props->>$1 = $2"]);
  });

  it("integer casts the jsonb value to numeric", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("age", "integer", "gt", 25)], params);
    expect(clauses).toEqual(["(props->$1)::numeric > $2"]);
    expect(params).toEqual(["age", 25]);
  });

  it("float casts to float8", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("score", "float", "lte", 2.5)], params);
    expect(clauses).toEqual(["(props->$1)::float8 <= $2"]);
  });

  it("boolean casts to boolean", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("active", "boolean", "eq", true)], params);
    expect(clauses).toEqual(["(props->$1)::boolean = $2"]);
  });

  it("date casts the text form to date", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("founded", "date", "lt", "2020-01-01")], params);
    expect(clauses).toEqual(["(props->>$1)::date < $2"]);
    expect(params).toEqual(["founded", "2020-01-01"]);
  });

  it("datetime casts the text form to timestamptz and binds the Date untouched", () => {
    const params: unknown[] = [];
    const when = new Date("2024-01-15T10:30:00Z");
    const clauses = buildFilterClauses([cond("seen_at", "datetime", "gte", when)], params);
    expect(clauses).toEqual(["(props->>$1)::timestamptz >= $2"]);
    expect(params[1]).toBe(when);
  });

  it("all five comparison operators map to their SQL forms", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses(
      [
        cond("age", "integer", "eq", 1),
        cond("age", "integer", "gt", 2),
        cond("age", "integer", "gte", 3),
        cond("age", "integer", "lt", 4),
        cond("age", "integer", "lte", 5),
      ],
      params,
    );
    expect(clauses).toEqual([
      "(props->$1)::numeric = $2",
      "(props->$3)::numeric > $4",
      "(props->$5)::numeric >= $6",
      "(props->$7)::numeric < $8",
      "(props->$9)::numeric <= $10",
    ]);
    expect(params).toEqual(["age", 1, "age", 2, "age", 3, "age", 4, "age", 5]);
  });
});

describe("contains — position() over lowered text, no wildcard class", () => {
  it("binds the search value first, the key second", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("name", "string", "contains", "Ali")], params);
    expect(clauses).toEqual(["position(lower($1) in lower(props->>$2)) > 0"]);
    expect(params).toEqual(["Ali", "name"]);
  });

  it("compares the jsonb text form for non-string types", () => {
    const params: unknown[] = [];
    const clauses = buildFilterClauses([cond("age", "integer", "contains", "3x")], params);
    expect(clauses).toEqual(["position(lower($1) in lower(props->>$2)) > 0"]);
    expect(params).toEqual(["3x", "age"]);
  });
});

describe("placeholder numbering composes with earlier params", () => {
  it("continues from the length of the shared params array", () => {
    const params: unknown[] = ["person"];
    const clauses = buildFilterClauses([cond("name", "string", "eq", "Alice")], params);
    expect(clauses).toEqual(["props->>$2 = $3"]);
    expect(params).toEqual(["person", "name", "Alice"]);
  });
});

describe("free-text search — one shared bound value ORed over the string keys", () => {
  it("builds the OR fragment with the value bound once", () => {
    const params: unknown[] = [];
    const clause = buildSearchClause("ali", ["name", "email"], params);
    expect(clause).toBe(
      "(position(lower($1) in lower(props->>$2)) > 0 OR " +
        "position(lower($1) in lower(props->>$3)) > 0)",
    );
    expect(params).toEqual(["ali", "name", "email"]);
  });

  it("a single key still gets the wrapping parentheses", () => {
    const params: unknown[] = [];
    const clause = buildSearchClause("x", ["name"], params);
    expect(clause).toBe("(position(lower($1) in lower(props->>$2)) > 0)");
  });
});

describe("sorting — typed casts, literal direction, id tie-break", () => {
  it("sorts a property with its typed accessor, the key bound", () => {
    const params: unknown[] = [];
    const orderBy = buildOrderBy("age", DEFS, "asc", params);
    expect(orderBy).toBe("ORDER BY (props->$1)::numeric ASC, id");
    expect(params).toEqual(["age"]);
  });

  it("desc becomes the DESC literal", () => {
    const params: unknown[] = [];
    expect(buildOrderBy("name", DEFS, "desc", params)).toBe(
      "ORDER BY props->>$1 DESC, id",
    );
  });

  it("datetime sorts on the timestamptz cast", () => {
    const params: unknown[] = [];
    expect(buildOrderBy("seen_at", DEFS, "asc", params)).toBe(
      "ORDER BY (props->>$1)::timestamptz ASC, id",
    );
  });

  it("_createdAt and _updatedAt map to the real columns, nothing bound", () => {
    const params: unknown[] = [];
    expect(buildOrderBy("_createdAt", DEFS, "asc", params)).toBe(
      "ORDER BY created_at ASC, id",
    );
    expect(buildOrderBy("_updatedAt", DEFS, "desc", params)).toBe(
      "ORDER BY updated_at DESC, id",
    );
    expect(params).toEqual([]);
  });
});

describe("relation endpoint filters — plain indexed columns", () => {
  it("builds from_id and to_id fragments with bound ids", () => {
    const params: unknown[] = [];
    const clauses = buildEndpointClauses(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      params,
    );
    expect(clauses).toEqual(["from_id = $1", "to_id = $2"]);
    expect(params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("either endpoint alone builds only its fragment", () => {
    const params: unknown[] = [];
    expect(buildEndpointClauses("11111111-1111-4111-8111-111111111111", null, params)).toEqual([
      "from_id = $1",
    ]);
    const params2: unknown[] = [];
    expect(buildEndpointClauses(null, "22222222-2222-4222-8222-222222222222", params2)).toEqual([
      "to_id = $1",
    ]);
  });

  it("no endpoints, no fragments", () => {
    const params: unknown[] = [];
    expect(buildEndpointClauses(null, null, params)).toEqual([]);
    expect(params).toEqual([]);
  });
});
