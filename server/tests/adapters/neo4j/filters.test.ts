/**
 * The adapter predicate builder: pure fragment assembly over the parsed
 * conditions the service supplies. Values always cross into Cypher as
 * bound parameters — converted to driver-native forms per the condition's
 * data type — and identifiers come only from the stored schema's keys.
 * Validation happens above the port; the builder raises nothing.
 */

import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";

import {
  buildFilterClauses,
  buildSearchClause,
} from "../../../src/adapters/neo4j/filters.js";
import { cond, pathCond } from "../../propertyDefs.js";

describe("clause construction", () => {
  it("eq binds the value — never interpolated", () => {
    const [clauses, params] = buildFilterClauses([cond("name", "string", "eq", "Alice")]);
    expect(clauses).toEqual(["n.name = $flt_0"]);
    expect(params.flt_0).toBe("Alice");
  });

  it("comparison operators map to their Cypher forms", () => {
    const [clauses] = buildFilterClauses([
      cond("age", "integer", "gt", 1),
      cond("age", "integer", "gte", 2),
      cond("age", "integer", "lt", 3),
      cond("age", "integer", "lte", 4),
    ]);
    expect(clauses).toEqual([
      "n.age > $flt_0",
      "n.age >= $flt_1",
      "n.age < $flt_2",
      "n.age <= $flt_3",
    ]);
  });

  it("contains compares as lowered text and binds the string form untouched", () => {
    const [clauses, params] = buildFilterClauses([cond("age", "integer", "contains", "3x")]);
    expect(clauses).toEqual(["toLower(toString(n.age)) CONTAINS toLower($flt_0)"]);
    expect(params.flt_0).toBe("3x");
  });

  it("a custom node alias is honoured", () => {
    const [clauses] = buildFilterClauses([cond("name", "string", "eq", "A")], "r");
    expect(clauses).toEqual(["r.name = $flt_0"]);
  });
});

describe("driver-native parameter conversion per data type", () => {
  it("integer values become driver integers", () => {
    const [, params] = buildFilterClauses([cond("age", "integer", "eq", 30)]);
    expect(neo4j.isInt(params.flt_0)).toBe(true);
    expect((params.flt_0 as { toNumber(): number }).toNumber()).toBe(30);
  });

  it("float values stay numbers", () => {
    const [, params] = buildFilterClauses([cond("score", "float", "gte", 2.5)]);
    expect(params.flt_0).toBe(2.5);
  });

  it("boolean values pass through", () => {
    const [, params] = buildFilterClauses([cond("active", "boolean", "eq", true)]);
    expect(params.flt_0).toBe(true);
  });

  it("date values become driver dates", () => {
    const [, params] = buildFilterClauses([cond("founded", "date", "lt", "2020-01-01")]);
    expect(params.flt_0).toBeInstanceOf(neo4j.types.Date);
    expect(String(params.flt_0)).toBe("2020-01-01");
  });

  it("datetime values become driver datetimes", () => {
    const [, params] = buildFilterClauses([
      cond("seen_at", "datetime", "gte", new Date("2024-01-15T10:30:00Z")),
    ]);
    expect(params.flt_0).toBeInstanceOf(neo4j.types.DateTime);
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

describe("path conditions — an existential pattern predicate", () => {
  it("outgoing: the listed node is the relationship's start, the related node its end", () => {
    const [clauses, params] = buildFilterClauses([
      pathCond("works_for", "outgoing", "name", "string", "eq", "Acme"),
    ]);
    expect(clauses).toEqual(["EXISTS { MATCH (n)-[:WORKS_FOR]->(re) WHERE re.name = $flt_0 }"]);
    expect(params).toEqual({ flt_0: "Acme" });
  });

  it("incoming: the listed node is the relationship's end, the value converted by the final property's type", () => {
    const [clauses, params] = buildFilterClauses([
      pathCond("works_for", "incoming", "age", "integer", "gt", 30),
    ]);
    expect(clauses).toEqual(["EXISTS { MATCH (n)<-[:WORKS_FOR]-(re) WHERE re.age > $flt_0 }"]);
    expect(neo4j.isInt(params.flt_0)).toBe(true);
  });

  it("contains compares the related node's lowered text form", () => {
    const [clauses, params] = buildFilterClauses([
      pathCond("works_for", "outgoing", "name", "string", "contains", "ac"),
    ]);
    expect(clauses).toEqual([
      "EXISTS { MATCH (n)-[:WORKS_FOR]->(re) WHERE toLower(toString(re.name)) CONTAINS toLower($flt_0) }",
    ]);
    expect(params).toEqual({ flt_0: "ac" });
  });

  it("path and property conditions compose with distinct parameters", () => {
    const [clauses, params] = buildFilterClauses([
      cond("age", "integer", "gte", 18),
      pathCond("works_for", "outgoing", "name", "string", "eq", "Acme"),
    ]);
    expect(clauses).toEqual([
      "n.age >= $flt_0",
      "EXISTS { MATCH (n)-[:WORKS_FOR]->(re) WHERE re.name = $flt_1 }",
    ]);
    expect(Object.keys(params)).toEqual(["flt_0", "flt_1"]);
  });
});
