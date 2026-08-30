/**
 * OQL parsing/validation (`core/oql`), the Neo4j compiler, and the query
 * endpoint. Ported from `tests/runtime/test_cypher.py` (all scenarios),
 * plus the extra spec-mandated cases: exact hint lists, collect-all with
 * mixed categories, labelless-variable edge cases, backtick-quoted names,
 * and rewrite-leaves-the-rest-intact assertions.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../src/core/exceptions.js";
import {
  SYSTEM_PROPERTIES,
  analyze,
  getReturnVariables,
  hasLabellessNodes,
  parse,
  parseAndValidate,
  validate,
  type ValidatedQuery,
} from "../../src/core/oql/index.js";
import { compileQuery, validateAndCompile } from "../../src/adapters/neo4j/oqlCompiler.js";
import { invalidateLoadedSchemaCache, type SchemaCacheValue } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeEntity, type MockRuntimeStore } from "./helpers.js";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prop(key: string, dataType: string, required = false): Row {
  return { key, displayName: key, description: null, dataType, required, defaultValue: null };
}

/** Minimal scoped schema for testing. */
function schema(): SchemaCacheValue {
  return {
    lensId: "lens-1",
    lensKey: "test",
    lensName: "Test",
    lensDescription: null,
    entityTypes: {
      person: {
        key: "person",
        displayName: "Person",
        description: null,
        properties: {
          name: prop("name", "string", true),
          age: prop("age", "integer"),
        } as never,
      },
      company: {
        key: "company",
        displayName: "Company",
        description: null,
        properties: { name: prop("name", "string", true) } as never,
      },
    },
    relationTypes: {
      works_for: {
        key: "works_for",
        displayName: "Works For",
        description: null,
        fromEntityTypeKey: "person",
        toEntityTypeKey: "company",
        properties: { role: prop("role", "string") } as never,
      },
    },
  };
}

/** Scoped schema whose person type has a document property. */
function docSchemaCache(): SchemaCacheValue {
  const s = schema();
  (s.entityTypes.person!.properties as Row).bio = prop("bio", "document");
  return s;
}

function analyzeQuery(query: string) {
  const { tree } = parse(query);
  return analyze(tree);
}

function validateQuery(query: string, s: SchemaCacheValue = schema()): string[] {
  return validate(analyzeQuery(query), s);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parsing", () => {
  it("valid query parses", () => {
    const { tree } = parse("MATCH (n:person) RETURN n");
    expect(tree).not.toBeNull();
  });

  it("syntax error raises", () => {
    expect(() => parse("MATCH (n:person RETURN")).toThrowError(/Invalid query syntax/);
  });
});

// ---------------------------------------------------------------------------
// Analysis — label extraction
// ---------------------------------------------------------------------------

describe("analysis", () => {
  it("extracts node labels", () => {
    const analysis = analyzeQuery("MATCH (p:person)-[r:works_for]->(c:company) RETURN p");
    expect(analysis.allLabels).toEqual(new Set(["person", "company"]));
  });

  it("extracts rel types", () => {
    const analysis = analyzeQuery("MATCH (p:person)-[r:works_for]->(c:company) RETURN p");
    expect(analysis.allRelTypes).toEqual(new Set(["works_for"]));
  });

  it("node variable mapping", () => {
    const analysis = analyzeQuery("MATCH (p:person) RETURN p");
    expect(analysis.nodeVariables).toEqual(new Map([["p", new Set(["person"])]]));
  });

  it("rel variable mapping", () => {
    const analysis = analyzeQuery("MATCH ()-[r:works_for]->() RETURN r");
    expect(analysis.relVariables).toEqual(new Map([["r", "works_for"]]));
  });

  it("detects write CREATE", () => {
    const analysis = analyzeQuery("CREATE (n:person {name: 'Bob'})");
    expect(analysis.writeClauses).toContain("CREATE");
  });

  it("detects write DELETE", () => {
    const analysis = analyzeQuery("MATCH (n:person) DELETE n");
    expect(analysis.writeClauses).toContain("DELETE");
  });

  it("detects write SET", () => {
    const analysis = analyzeQuery("MATCH (n:person) SET n.name = 'Bob'");
    expect(analysis.writeClauses).toContain("SET");
  });

  it("detects write MERGE", () => {
    const analysis = analyzeQuery("MERGE (n:person {name: 'Bob'})");
    expect(analysis.writeClauses).toContain("MERGE");
  });

  it("detects write REMOVE", () => {
    const analysis = analyzeQuery("MATCH (n:person) REMOVE n.age");
    expect(analysis.writeClauses).toContain("REMOVE");
  });

  it("detects CALL", () => {
    const analysis = analyzeQuery("CALL db.labels()");
    expect(analysis.hasCall).toBe(true);
  });

  it("property access", () => {
    const analysis = analyzeQuery("MATCH (p:person) WHERE p.name = 'Alice' RETURN p.age");
    const props = analysis.propertyAccesses.map((pa) => [pa.variable, pa.propertyName]);
    expect(props).toContainEqual(["p", "name"]);
    expect(props).toContainEqual(["p", "age"]);
  });

  it("labelless node detected", () => {
    const analysis = analyzeQuery("MATCH (n) RETURN n");
    expect(hasLabellessNodes(analysis)).toBe(true);
  });

  it("labeled node not flagged", () => {
    const analysis = analyzeQuery("MATCH (n:person) RETURN n");
    expect(hasLabellessNodes(analysis)).toBe(false);
  });

  // -- spec-mandated edge cases --

  it("re-referencing a labeled variable is not flagged", () => {
    const analysis = analyzeQuery(
      "MATCH (p:person) WITH p MATCH (p)-[r:works_for]->(c:company) RETURN p, c",
    );
    expect(hasLabellessNodes(analysis)).toBe(false);
  });

  it("fully anonymous node patterns are not flagged", () => {
    const analysis = analyzeQuery("MATCH ()-[r:works_for]->() RETURN r");
    expect(hasLabellessNodes(analysis)).toBe(false);
  });

  it("backtick-quoted labels and properties are stripped", () => {
    const analysis = analyzeQuery("MATCH (`p`:`person`) WHERE `p`.`name` = 'A' RETURN p");
    expect(analysis.allLabels).toEqual(new Set(["person"]));
    expect(analysis.nodeVariables).toEqual(new Map([["p", new Set(["person"])]]));
    expect(analysis.propertyAccesses).toContainEqual({ variable: "p", propertyName: "name" });
  });

  it("records the names of $parameters used as SKIP/LIMIT operands", () => {
    const analysis = analyzeQuery(
      "MATCH (p:person) RETURN p.name AS name SKIP $offset LIMIT $page_size",
    );
    expect(analysis.skipLimitParams).toEqual(new Set(["offset", "page_size"]));
  });

  it("records no SKIP/LIMIT operand for literals or parameters used elsewhere", () => {
    const analysis = analyzeQuery(
      "MATCH (p:person) WHERE p.age > $min_age RETURN p.name AS name SKIP 1 LIMIT 2",
    );
    expect(analysis.skipLimitParams).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validation", () => {
  it("valid query no errors", () => {
    expect(validateQuery("MATCH (p:person) RETURN p")).toEqual([]);
  });

  it("rejects write CREATE", () => {
    const errors = validateQuery("CREATE (n:person {name: 'Bob'})");
    expect(errors.some((e) => e.includes("Write operations"))).toBe(true);
  });

  it("rejects CALL", () => {
    const errors = validateQuery("CALL db.labels()");
    expect(errors.some((e) => e.includes("CALL procedures"))).toBe(true);
  });

  it("rejects labelless node", () => {
    const errors = validateQuery("MATCH (n) RETURN n");
    expect(errors.some((e) => e.includes("must specify a label"))).toBe(true);
  });

  it("rejects unknown entity type", () => {
    const errors = validateQuery("MATCH (n:animal) RETURN n");
    expect(errors.some((e) => e.includes("Unknown entity type: 'animal'"))).toBe(true);
  });

  it("rejects unknown relation type", () => {
    const errors = validateQuery("MATCH ()-[r:likes]->() RETURN r");
    expect(errors.some((e) => e.includes("Unknown relation type: 'likes'"))).toBe(true);
  });

  it("rejects internal label", () => {
    const errors = validateQuery("MATCH (n:_Entity) RETURN n");
    expect(errors.some((e) => e.includes("Internal label"))).toBe(true);
  });

  it("rejects unknown entity property", () => {
    const errors = validateQuery("MATCH (p:person) WHERE p.salary = 100 RETURN p");
    expect(errors.some((e) => e.includes("Unknown property 'salary'"))).toBe(true);
  });

  it("rejects unknown relation property", () => {
    const errors = validateQuery("MATCH ()-[r:works_for]->() WHERE r.rating = 5 RETURN r");
    expect(errors.some((e) => e.includes("Unknown property 'rating'"))).toBe(true);
  });

  it("allows system properties", () => {
    expect(validateQuery("MATCH (p:person) WHERE p._id = 'abc' RETURN p._createdAt")).toEqual([]);
  });

  it("allows known properties", () => {
    expect(validateQuery("MATCH (p:person) WHERE p.name = 'Alice' RETURN p.age")).toEqual([]);
  });

  it("error hints include available types", () => {
    const errors = validateQuery("MATCH (n:animal) RETURN n");
    expect(errors.some((e) => e.includes("company") && e.includes("person"))).toBe(true);
  });

  it("error hints include available properties", () => {
    const errors = validateQuery("MATCH (p:person) WHERE p.salary = 100 RETURN p");
    expect(errors.some((e) => e.includes("name") && e.includes("age"))).toBe(true);
  });

  it("multiple errors collected", () => {
    const errors = validateQuery(
      "MATCH (n:animal)-[r:likes]->(m:person) WHERE m.salary = 1 RETURN n",
    );
    expect(errors.length).toBeGreaterThanOrEqual(3); // unknown entity, unknown rel, unknown prop
  });

  // -- spec-mandated exact hint wording per rejection category --

  it("write rejection carries the exact message", () => {
    const errors = validateQuery("MATCH (n:person) SET n.name = 'Bob' DELETE n");
    expect(errors).toContain(
      "Write operations are not allowed: DELETE, SET. " +
        "Only read queries are supported (MATCH, WHERE, RETURN, " +
        "ORDER BY, LIMIT, SKIP, OPTIONAL MATCH, WITH).",
    );
  });

  it("CALL rejection carries the exact message", () => {
    expect(validateQuery("CALL db.labels()")).toContain(
      "CALL procedures are not allowed. Use MATCH patterns to query data.",
    );
  });

  it("labelless rejection lists the entity types", () => {
    expect(validateQuery("MATCH (n) RETURN n")).toContain(
      "All node patterns must specify a label. Available entity types: company, person",
    );
  });

  it("unknown entity type lists the candidates", () => {
    expect(validateQuery("MATCH (n:animal) RETURN n")).toContain(
      "Unknown entity type: 'animal'. Available: company, person",
    );
  });

  it("unknown relation type lists the candidates", () => {
    expect(validateQuery("MATCH ()-[r:likes]->() RETURN r")).toContain(
      "Unknown relation type: 'likes'. Available: works_for",
    );
  });

  it("internal label carries its own message", () => {
    expect(validateQuery("MATCH (n:_Entity) RETURN n")).toContain(
      "Internal label '_Entity' cannot be queried directly. " +
        "Use entity type keys: company, person",
    );
  });

  it("unknown entity property lists type properties plus system properties", () => {
    expect(validateQuery("MATCH (p:person) WHERE p.salary = 100 RETURN p")).toContain(
      "Unknown property 'salary' on entity type 'person'. " +
        "Available: age, name, _createdAt, _entityTypeKey, _id, _relationTypeKey, _updatedAt",
    );
  });

  it("unknown relation property lists type properties plus system properties", () => {
    expect(validateQuery("MATCH ()-[r:works_for]->() WHERE r.rating = 5 RETURN r")).toContain(
      "Unknown property 'rating' on relation type 'works_for'. " +
        "Available: role, _createdAt, _entityTypeKey, _id, _relationTypeKey, _updatedAt",
    );
  });

  it("collects a bad label AND a bad property together", () => {
    const errors = validateQuery("MATCH (n:animal), (p:person) WHERE p.salary = 1 RETURN n, p");
    expect(errors.some((e) => e.includes("Unknown entity type: 'animal'"))).toBe(true);
    expect(errors.some((e) => e.includes("Unknown property 'salary'"))).toBe(true);
  });

  it("rejects property access through a variable with no declared type", () => {
    const message =
      "Properties cannot be read through a variable with no declared type. " +
      "Name the type in the pattern that binds it.";
    // A relationship bound with no type.
    expect(validateQuery("MATCH (p:person)-[r]->(c:company) RETURN r.role")).toContain(message);
    // A WITH alias — the intermediate projection declares no type.
    expect(validateQuery("MATCH (p:person) WITH p AS x RETURN x.name")).toContain(message);
    // An unbound variable.
    expect(validateQuery("MATCH (p:person) RETURN q.name")).toContain(message);
  });

  it("system properties stay readable through any variable", () => {
    expect(validateQuery("MATCH (p:person)-[r]->(c:company) RETURN r._id")).toEqual([]);
    expect(validateQuery("MATCH (p:person) WITH p AS x RETURN x._id")).toEqual([]);
  });

  it("system property set matches the contract", () => {
    expect([...SYSTEM_PROPERTIES].sort()).toEqual([
      "_createdAt",
      "_entityTypeKey",
      "_id",
      "_relationTypeKey",
      "_updatedAt",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The closed day-one surface (M0.2) — analysis-level detection
// ---------------------------------------------------------------------------

describe("surface analysis", () => {
  it("detects a variable-length pattern (rangeLit)", () => {
    const analysis = analyzeQuery("MATCH (p:person)-[:works_for*1..3]->(c:company) RETURN p");
    expect(analysis.unsupported.has("variable-length")).toBe(true);
  });

  it("UNION parses after the grammar fix", () => {
    expect(() =>
      parse("MATCH (p:person) RETURN p UNION MATCH (c:company) RETURN c"),
    ).not.toThrow();
  });

  it("detects UNION", () => {
    const analysis = analyzeQuery("MATCH (p:person) RETURN p UNION MATCH (c:company) RETURN c");
    expect(analysis.unsupported.has("union")).toBe(true);
  });

  it("collects function names verbatim", () => {
    const analysis = analyzeQuery(
      "MATCH (p:person) RETURN count(p), apoc.text.join(p.name, ',')",
    );
    expect(analysis.functionCalls.has("count")).toBe(true);
    expect(analysis.functionCalls.has("apoc.text.join")).toBe(true);
  });

  it("extracts inline-map keys against the owning node label", () => {
    const analysis = analyzeQuery("MATCH (:person {name: 'Alice', salary: 100}) RETURN 1");
    expect(analysis.inlineMaps).toEqual([
      { ownerTypeKey: "person", isRelationship: false, keys: ["name", "salary"] },
    ]);
  });

  it("extracts inline-map keys against the owning relationship type", () => {
    const analysis = analyzeQuery(
      "MATCH (:person)-[r:works_for {role: 'x'}]->(:company) RETURN r",
    );
    expect(analysis.inlineMaps).toEqual([
      { ownerTypeKey: "works_for", isRelationship: true, keys: ["role"] },
    ]);
  });

  it("records an untyped owner for a map on an unlabeled node", () => {
    const analysis = analyzeQuery("MATCH ({salary: 100}) RETURN 1");
    expect(analysis.inlineMaps).toEqual([
      { ownerTypeKey: null, isRelationship: false, keys: ["salary"] },
    ]);
  });

  it("detects a pattern comprehension", () => {
    const analysis = analyzeQuery(
      "MATCH (p:person) RETURN [(a:person)-[:works_for]->(b:company) | a.name]",
    );
    expect(analysis.unsupported.has("comprehension")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The closed day-one surface (M0.2) — exact rejection wording per row
// ---------------------------------------------------------------------------

describe("surface rejections", () => {
  it("variable-length pattern", () => {
    expect(validateQuery("MATCH (p:person)-[:works_for*]->(c:company) RETURN p")).toContain(
      "Variable-length relationship patterns are not supported. " +
        "Write each hop as an explicit relationship pattern.",
    );
  });

  it("UNION", () => {
    expect(
      validateQuery("MATCH (p:person) RETURN p UNION MATCH (c:company) RETURN c"),
    ).toContain("UNION is not supported. Run separate queries and combine the results in the caller.");
  });

  it("CASE", () => {
    expect(
      validateQuery("MATCH (p:person) RETURN CASE WHEN p.age > 1 THEN 'a' ELSE 'b' END"),
    ).toContain(
      "CASE expressions are not supported. Filter with WHERE, or compute the distinction in the caller.",
    );
  });

  it("list comprehension", () => {
    expect(validateQuery("MATCH (p:person) RETURN [x IN p.name | x]")).toContain(
      "List and pattern comprehensions are not supported. " +
        "Use MATCH with WHERE, and collect(...) to build lists.",
    );
  });

  it("quantified predicates", () => {
    expect(
      validateQuery("MATCH (p:person) WHERE any(x IN p.name WHERE x = 'a') RETURN p"),
    ).toContain(
      "Quantified predicates (ALL, ANY, NONE, SINGLE) are not supported. " +
        "Express the condition with MATCH patterns and WHERE.",
    );
  });

  it("REDUCE", () => {
    expect(validateQuery("MATCH (p:person) RETURN reduce(p.age)")).toContain(
      "REDUCE is not supported. Aggregate with the supported functions: " +
        "avg, collect, count, max, min, sum.",
    );
  });

  it("EXISTS subquery", () => {
    expect(
      validateQuery("MATCH (p:person) WHERE EXISTS { (p)-[:works_for]->(:company) } RETURN p"),
    ).toContain(
      "EXISTS subqueries are not supported. " +
        "Match the pattern directly, or use OPTIONAL MATCH with IS NOT NULL.",
    );
  });

  it("named path", () => {
    expect(
      validateQuery("MATCH path = (p:person)-[:works_for]->(c:company) RETURN p"),
    ).toContain("Named paths are not supported. Bind the nodes and relationships you need with variables.");
  });

  it("multi-label node pattern", () => {
    expect(validateQuery("MATCH (n:person:company) RETURN n")).toContain(
      "Multi-label node patterns are not supported. A node pattern names exactly one entity type.",
    );
  });

  it("relationship-type union", () => {
    expect(validateQuery("MATCH ()-[r:works_for|works_for]->() RETURN r")).toContain(
      "Relationship-type unions ([:a|b]) are not supported. Match each relationship type separately.",
    );
  });

  it("map projection", () => {
    // No production of the vendored grammar yields a map projection, so the
    // Collector can never record one from a parse; the message row is pinned
    // against a regenerated grammar ever admitting the construct.
    const analysis = analyzeQuery("MATCH (p:person) RETURN p");
    analysis.unsupported.add("map-projection");
    expect(validate(analysis, schema())).toContain(
      "Map projections are not supported. Return each property explicitly.",
    );
  });

  it("arithmetic", () => {
    expect(validateQuery("MATCH (p:person) RETURN p.age + 1")).toContain(
      "Arithmetic expressions are not supported. Compute derived values in the caller.",
    );
    expect(validateQuery("MATCH (p:person) WHERE p.age % 2 = 0 RETURN p")).toContain(
      "Arithmetic expressions are not supported. Compute derived values in the caller.",
    );
  });

  it("STARTS WITH / ENDS WITH", () => {
    const message = "STARTS WITH and ENDS WITH are not supported. Use CONTAINS to match substrings.";
    expect(validateQuery("MATCH (p:person) WHERE p.name STARTS WITH 'A' RETURN p")).toContain(message);
    expect(validateQuery("MATCH (p:person) WHERE p.name ENDS WITH 'e' RETURN p")).toContain(message);
  });

  it("DISTINCT in both positions", () => {
    const message = "DISTINCT is not supported. Deduplicate in the caller, or aggregate with collect(...).";
    expect(validateQuery("MATCH (p:person) RETURN DISTINCT p")).toContain(message);
    expect(validateQuery("MATCH (p:person) RETURN count(DISTINCT p)")).toContain(message);
  });

  it("unknown function", () => {
    expect(validateQuery("MATCH (p:person) RETURN randomUUID()")).toContain(
      "Unknown function: 'randomUUID'. Available functions: avg, collect, count, max, min, sum.",
    );
  });

  it("vendor namespaces are rejected as unknown functions", () => {
    expect(validateQuery("MATCH (p:person) RETURN apoc.text.join(p.name, ',')")).toContain(
      "Unknown function: 'apoc.text.join'. Available functions: avg, collect, count, max, min, sum.",
    );
  });

  it("XOR", () => {
    expect(validateQuery("MATCH (p:person) WHERE p.age = 1 XOR p.age = 2 RETURN p")).toContain(
      "XOR is not supported. Express the condition with AND, OR and NOT.",
    );
  });

  it("nested aggregates", () => {
    expect(validateQuery("MATCH (p:person) RETURN avg(count(p))")).toContain(
      "Aggregate functions cannot be nested. Compute the inner aggregate in a WITH clause first.",
    );
    expect(validateQuery("MATCH (p:person) RETURN avg(count(*))")).toContain(
      "Aggregate functions cannot be nested. Compute the inner aggregate in a WITH clause first.",
    );
  });

  it("ORDER BY on a node or relationship variable", () => {
    const message = "Cannot order by a node or relationship — order by one of its properties instead.";
    expect(validateQuery("MATCH (p:person) RETURN p ORDER BY p")).toContain(message);
    expect(validateQuery("MATCH ()-[r:works_for]->() RETURN r ORDER BY r")).toContain(message);
  });

  it("ORDER BY on a constant or parameter", () => {
    const message =
      "Cannot order by a constant or a parameter — order by a property, an alias, or an aggregate instead.";
    expect(validateQuery("MATCH (p:person) RETURN p ORDER BY 1")).toContain(message);
    expect(validateQuery("MATCH (p:person) RETURN p ORDER BY $rank")).toContain(message);
  });

  it("SKIP/LIMIT operands", () => {
    const message = "SKIP/LIMIT take a non-negative integer or a $parameter.";
    expect(validateQuery("MATCH (p:person) RETURN p LIMIT p.age")).toContain(message);
    expect(validateQuery("MATCH (p:person) RETURN p SKIP -1")).toContain(message);
  });

  it("chained property access", () => {
    expect(validateQuery("MATCH (p:person) WHERE p.name.foo = 1 RETURN p")).toContain(
      "Nested property access is not supported — properties hold scalar values.",
    );
  });

  it("inline-map key unknown on the owner's type reuses the property message", () => {
    expect(validateQuery("MATCH (p:person {salary: 100}) RETURN p")).toContain(
      "Unknown property 'salary' on entity type 'person'. " +
        "Available: age, name, _createdAt, _entityTypeKey, _id, _relationTypeKey, _updatedAt",
    );
    expect(validateQuery("MATCH (:person)-[r:works_for {rating: 5}]->(:company) RETURN r")).toContain(
      "Unknown property 'rating' on relation type 'works_for'. " +
        "Available: role, _createdAt, _entityTypeKey, _id, _relationTypeKey, _updatedAt",
    );
  });

  it("inline map on an untyped owner", () => {
    const message =
      "An inline property map needs a typed owner — add a label to the node " +
        "(or a type to the relationship) so its keys can be validated.";
    expect(validateQuery("MATCH ({salary: 100}) RETURN 1")).toContain(message);
    expect(validateQuery("MATCH (:person)-[r {role: 'x'}]->(:company) RETURN r")).toContain(message);
  });

  it("RETURN * with no variables in scope", () => {
    expect(validateQuery("RETURN *")).toContain(
      "RETURN * is not allowed when there are no variables in scope.",
    );
  });

  it("UNWIND", () => {
    expect(validateQuery("MATCH (p:person) UNWIND p.name AS x RETURN x")).toContain(
      "UNWIND is not supported. Match the rows you need directly with MATCH and WHERE.",
    );
  });

  it("a parameter as a pattern property map", () => {
    const message =
      "A parameter cannot supply a pattern's property map. " +
      "Write the properties as an explicit inline map.";
    expect(validateQuery("MATCH (p:person $props) RETURN p")).toContain(message);
    expect(validateQuery("MATCH (:person)-[r:works_for $props]->(:company) RETURN r")).toContain(
      message,
    );
  });

  it("a bare pattern as an expression", () => {
    expect(
      validateQuery("MATCH (p:person) WHERE (p)-[:works_for]->(:company) RETURN p"),
    ).toContain(
      "Bare patterns cannot be used as expressions. " +
        "Match the pattern directly, or use OPTIONAL MATCH with IS NOT NULL.",
    );
  });

  it("a pattern as a count() argument", () => {
    expect(
      validateQuery("MATCH (p:person) RETURN count((p)-[:works_for]->(:company))"),
    ).toContain(
      "count() cannot take a pattern as its argument. " +
        "Match the pattern first and count a variable it binds.",
    );
  });

  it("a label test in an expression", () => {
    expect(validateQuery("MATCH (p:person) WHERE p:person RETURN p")).toContain(
      "Label tests (WHERE p:person) are not supported. " +
        "Name the label in the pattern that binds the variable.",
    );
  });

  it("list indexing and slicing", () => {
    const message =
      "List indexing and slicing are not supported. " +
      "Return the whole list and pick elements in the caller.";
    expect(validateQuery("MATCH (p:person) RETURN [1, 2][0]")).toContain(message);
    expect(validateQuery("MATCH (p:person) RETURN [1, 2][0..1]")).toContain(message);
  });

  it("a double-headed relationship pattern", () => {
    expect(validateQuery("MATCH (a:person)<-[r:works_for]->(b:company) RETURN a")).toContain(
      "Double-headed relationship patterns (<-[r]->) are not supported. " +
        "Use an undirected pattern (-[r]-) or a single direction.",
    );
  });

  it("a chained comparison", () => {
    expect(validateQuery("MATCH (p:person) WHERE 1 < p.age < 100 RETURN p")).toContain(
      "Chained comparisons are not supported. " +
        "Write each comparison separately and combine them with AND.",
    );
  });

  it("a postfix on a predicate", () => {
    expect(
      validateQuery("MATCH (p:person) WHERE p.name CONTAINS 'x' IS NULL RETURN p"),
    ).toContain(
      "IS NULL and IS NOT NULL apply to a property or variable, " +
        "not to the result of another predicate.",
    );
  });

  it("property access on a non-variable", () => {
    expect(validateQuery("MATCH (p:person) WHERE $p.name = 'x' RETURN p")).toContain(
      "Properties can be read only from a variable bound in a pattern.",
    );
  });

  it("an aggregate with more than one argument", () => {
    expect(validateQuery("MATCH (p:person) RETURN collect(p.name, p.age)")).toContain(
      "An aggregate function takes exactly one argument. Aggregate each expression separately.",
    );
  });

  it("a function call inside a MATCH pattern", () => {
    expect(validateQuery("MATCH count(p) RETURN 1")).toContain(
      "Function calls cannot appear inside a MATCH pattern. Call functions in WITH or RETURN.",
    );
  });

  it("unary minus on a non-literal routes to the arithmetic row", () => {
    expect(validateQuery("MATCH (p:person) WHERE -p.age > 5 RETURN p")).toContain(
      "Arithmetic expressions are not supported. Compute derived values in the caller.",
    );
    // A negated numeric literal stays in-surface.
    expect(validateQuery("MATCH (p:person) WHERE p.age > -5 RETURN p")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The closed day-one surface (M0.2) — acceptance
// ---------------------------------------------------------------------------

describe("surface acceptance", () => {
  it("the seven aggregates and count(*) pass", () => {
    expect(validateQuery("MATCH (p:person) RETURN count(*)")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN count(p)")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN sum(p.age)")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN avg(p.age)")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN min(p.age)")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN max(p.age)")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN collect(p.name)")).toEqual([]);
  });

  it("function-name comparison is case-insensitive", () => {
    expect(validateQuery("MATCH (p:person) RETURN COUNT(p)")).toEqual([]);
  });

  it("an in-lens inline map passes", () => {
    expect(validateQuery("MATCH (p:person {name: 'Alice'}) RETURN p")).toEqual([]);
    expect(validateQuery("MATCH (:person)-[r:works_for {role: 'x'}]->(:company) RETURN r")).toEqual([]);
  });

  it("system properties are permitted as inline-map keys", () => {
    expect(validateQuery("MATCH (p:person {_id: 'abc'}) RETURN p")).toEqual([]);
  });

  it("anonymous patterns without maps stay permitted", () => {
    expect(validateQuery("MATCH (:person)-[]->() RETURN 1")).toEqual([]);
  });

  it("integer literals and parameters pass SKIP/LIMIT", () => {
    expect(validateQuery("MATCH (p:person) RETURN p SKIP 5 LIMIT 10")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN p LIMIT $n")).toEqual([]);
  });

  it("every integer-literal form passes SKIP/LIMIT", () => {
    expect(validateQuery("MATCH (p:person) RETURN p LIMIT 1_000")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN p LIMIT 0x10")).toEqual([]);
    expect(validateQuery("MATCH (p:person) RETURN p SKIP 0o17 LIMIT 007")).toEqual([]);
  });

  it("ORDER BY on properties, aliases and aggregates passes", () => {
    expect(validateQuery("MATCH (p:person) RETURN p ORDER BY p.name DESC")).toEqual([]);
    expect(
      validateQuery("MATCH (p:person) RETURN p.name AS n ORDER BY n"),
    ).toEqual([]);
    expect(
      validateQuery("MATCH (p:person) RETURN p.name AS n, count(*) AS c ORDER BY count(*)"),
    ).toEqual([]);
  });

  it("RETURN * with variables in scope passes", () => {
    expect(validateQuery("MATCH (p:person) RETURN *")).toEqual([]);
  });

  it("bare map literals are in-surface literals, not property references", () => {
    expect(validateQuery("MATCH (p:person) WHERE p.name IN ['a', 'b'] RETURN {a: 1}")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The ValidatedQuery contract (M0.3)
// ---------------------------------------------------------------------------

describe("ValidatedQuery contract", () => {
  it("carries the parse tree and the scoped schema it was validated against", () => {
    const s = schema();
    const validated = parseAndValidate("MATCH (p:person) RETURN p", s);
    expect(validated.tree).toBeDefined();
    expect(validated.schema).toBe(s);
    expect(validated.text).toBe("MATCH (p:person) RETURN p");
    expect(validated.tokenStream).toBeDefined();
    expect(validated.analysis.allLabels).toEqual(new Set(["person"]));
  });

  it("the carried tree is the tree the analysis was collected from", () => {
    const validated = parseAndValidate("MATCH (p:person) RETURN p", schema());
    expect(analyze(validated.tree).allLabels).toEqual(validated.analysis.allLabels);
  });
});

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

function compileText(query: string): string {
  const { tokenStream, tree } = parse(query);
  const validated: ValidatedQuery = {
    text: "",
    tokenStream,
    tree,
    analysis: analyze(tree),
    schema: schema(),
  };
  return compileQuery(validated);
}

describe("rewriting", () => {
  it("rewrites entity labels", () => {
    const result = compileText("MATCH (p:person) RETURN p");
    expect(result).toContain(":Person)");
    expect(result).not.toContain(":person)");
  });

  it("rewrites relation types", () => {
    const result = compileText("MATCH (p:person)-[r:works_for]->(c:company) RETURN p, c");
    expect(result).toContain(":WORKS_FOR]");
    expect(result).toContain(":Person)");
    expect(result).toContain(":Company)");
  });

  it("preserves query structure", () => {
    const result = compileText("MATCH (p:person) WHERE p.name = 'Alice' RETURN p LIMIT 10");
    expect(result).toContain("WHERE p.name = 'Alice'");
    expect(result).toContain("LIMIT 10");
  });

  it("multi-word entity pascal case", () => {
    const s: SchemaCacheValue = {
      lensId: "t",
      lensKey: "t",
      lensName: "T",
      lensDescription: null,
      entityTypes: {
        research_paper: {
          key: "research_paper",
          displayName: "Research Paper",
          description: null,
          properties: {},
        },
      },
      relationTypes: {},
    };
    const result = validateAndCompile("MATCH (r:research_paper) RETURN r", s);
    expect(result).toContain(":ResearchPaper)");
  });

  // -- spec-mandated: everything but the type-key tokens is untouched --

  it("rewrites exactly the type-key tokens and nothing else", () => {
    const query =
      "MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' " +
      "RETURN p.name AS person, r, c ORDER BY p.name SKIP 5 LIMIT 10";
    const result = compileText(query);
    // Only the label/type tokens change — the alias `person`, the property
    // accesses, whitespace, and clause text all pass through intact.
    expect(result).toBe(
      "MATCH (p:Person)-[r:WORKS_FOR]->(c:Company) WHERE p.name = 'Alice' " +
        "RETURN p.name AS person, r, c ORDER BY p.name SKIP 5 LIMIT 10",
    );
  });

  it("rewrites backtick-quoted type keys", () => {
    const result = compileText("MATCH (p:`person`) RETURN p");
    expect(result).toContain(":Person)");
    expect(result).not.toContain("`person`");
  });
});

// ---------------------------------------------------------------------------
// validateAndCompile (end-to-end)
// ---------------------------------------------------------------------------

describe("validateAndCompile", () => {
  it("full pipeline", () => {
    const result = validateAndCompile(
      "MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, r, c LIMIT 10",
      schema(),
    );
    expect(result).toContain(":Person)");
    expect(result).toContain(":WORKS_FOR]");
    expect(result).toContain(":Company)");
  });

  it("raises on write", () => {
    expect(() => validateAndCompile("CREATE (n:person {name: 'Bob'})", schema())).toThrowError(
      ValidationError,
    );
  });

  it("raises on unknown label", () => {
    expect(() => validateAndCompile("MATCH (n:animal) RETURN n", schema())).toThrowError(
      ValidationError,
    );
  });

  it("OPTIONAL MATCH supported", () => {
    const result = validateAndCompile(
      "MATCH (p:person) OPTIONAL MATCH (p)-[r:works_for]->(c:company) RETURN p, r, c",
      schema(),
    );
    expect(result).toContain("OPTIONAL MATCH");
    expect(result).toContain(":Person)");
  });

  it("WITH clause supported", () => {
    const result = validateAndCompile(
      "MATCH (p:person) WITH p MATCH (p)-[r:works_for]->(c:company) RETURN p, c",
      schema(),
    );
    expect(result).toContain("WITH p");
  });

  it("ORDER BY / LIMIT / SKIP", () => {
    const result = validateAndCompile(
      "MATCH (p:person) RETURN p ORDER BY p.name SKIP 5 LIMIT 10",
      schema(),
    );
    expect(result).toContain("ORDER BY");
    expect(result).toContain("SKIP 5");
    expect(result).toContain("LIMIT 10");
  });
});

// ---------------------------------------------------------------------------
// getReturnVariables
// ---------------------------------------------------------------------------

describe("getReturnVariables", () => {
  it("maps node and relation variables", () => {
    const result = getReturnVariables(
      "MATCH (p:person)-[r:works_for]->(c:company) RETURN p, r, c",
      schema(),
    );
    expect(result.get("p")).toBe("person");
    expect(result.get("r")).toBe("works_for");
    expect(result.get("c")).toBe("company");
  });
});

// ---------------------------------------------------------------------------
// Document properties: internal chunk blocklist
// ---------------------------------------------------------------------------

describe("chunk blocklist", () => {
  it("_Chunk label rejected", () => {
    const errors = validateQuery("MATCH (c:_Chunk) RETURN c");
    expect(errors.some((e) => e.includes("Internal label '_Chunk'"))).toBe(true);
  });

  it("_HAS_CHUNK relationship rejected", () => {
    const errors = validateQuery("MATCH (p:person)-[r:_HAS_CHUNK]->(c:person) RETURN c");
    expect(errors.some((e) => e.includes("Internal relationship type '_HAS_CHUNK'"))).toBe(true);
  });

  it("virtual chunk label rejected as unknown", () => {
    const errors = validateQuery("MATCH (c:PersonDocumentBio) RETURN c");
    expect(errors.some((e) => e.includes("Unknown entity type: 'PersonDocumentBio'"))).toBe(true);
  });

  it("document property reference is valid", () => {
    expect(validateQuery("MATCH (p:person) WHERE p.bio IS NOT NULL RETURN p", docSchemaCache())).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// REST endpoint (via app.inject, mocked store)
// ---------------------------------------------------------------------------

/** Full-schema payload whose person type carries a document property. */
function docSchemaPayload(): Row {
  return {
    lens: {
      lensId: "lens-1",
      key: "docs_view",
      name: "Docs View",
      description: null,
    },
    entityTypes: [
      {
        entityTypeId: "et-1",
        key: "person",
        displayName: "Person",
        description: null,
        properties: [
          { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
          { key: "bio", displayName: "Bio", dataType: "document", required: false, defaultValue: null },
          { key: "notes", displayName: "Notes", dataType: "document", required: false, defaultValue: null },
        ],
      },
    ],
    relationTypes: [],
    entityInclusions: [],
    relationInclusions: [],
  };
}

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getLegacyModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
  getLegacyRuntimeStore: async () => holder.store,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  const { makeUnscopedSchema } = await import("./helpers.js");
  holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
});

describe("query endpoint", () => {
  it("returns query results", async () => {
    holder.store.executeOql.mockResolvedValue([["p"], [{ p: makeEntity({ name: "Alice", age: 30 }) }]]);

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/query",
      payload: { query: "MATCH (p:person) RETURN p" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns).toEqual(["p"]);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].p.name).toBe("Alice");
  });

  it("rejects the legacy 'cypher' body field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/query",
      payload: { cypher: "MATCH (p:person) RETURN p" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("rejects write operations", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/query",
      payload: { query: "CREATE (n:person {name: 'Bob'})" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    const errors = res.json().error.details.errors as string[];
    expect(errors.some((e) => e.includes("Write operations"))).toBe(true);
  });

  it("rejects unknown entity types", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/query",
      payload: { query: "MATCH (n:animal) RETURN n" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("scoped lens strips out-of-scope properties from results", async () => {
    const { makeScopedSchema } = await import("./helpers.js");
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.executeOql.mockResolvedValue([
      ["p"],
      [{ p: makeEntity({ name: "Alice", age: 30, email: "a@b.com" }) }],
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/query",
      payload: { query: "MATCH (p:person) RETURN p" },
    });

    expect(res.statusCode).toBe(200);
    const resultP = res.json().results[0].p;
    expect(resultP.name).toBe("Alice");
    expect(resultP.email).toBe("a@b.com");
    expect(resultP).not.toHaveProperty("age"); // out of scope
  });

  it("stubs document values inside full nodes", async () => {
    holder.store.getFullSchema.mockResolvedValue(docSchemaPayload());
    holder.store.executeOql.mockResolvedValue([
      ["p"],
      [{ p: makeEntity({ name: "Ada", bio: "x".repeat(500), _doc_bio_length: 500 }) }],
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/query",
      payload: { query: "MATCH (p:person) RETURN p" },
    });

    expect(res.statusCode).toBe(200);
    const resultP = res.json().results[0].p;
    expect(resultP.name).toBe("Ada");
    expect(resultP.bio).toEqual({ document: true, length: 500 });
    expect(resultP).not.toHaveProperty("_doc_bio_length");
  });

  it("stubs scalar document projections (`RETURN p.bio`)", async () => {
    holder.store.getFullSchema.mockResolvedValue(docSchemaPayload());
    holder.store.executeOql.mockResolvedValue([
      ["p.bio", "p.name"],
      [{ "p.bio": "x".repeat(500), "p.name": "Ada" }],
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/query",
      payload: { query: "MATCH (p:person) RETURN p.bio, p.name" },
    });

    expect(res.statusCode).toBe(200);
    const row = res.json().results[0];
    expect(row["p.bio"]).toEqual({ document: true, length: 500 });
    expect(row["p.name"]).toBe("Ada");
  });

  it("an ALIASED document projection returns the full text", async () => {
    holder.store.getFullSchema.mockResolvedValue(docSchemaPayload());
    holder.store.executeOql.mockResolvedValue([
      ["biography"],
      [{ biography: "x".repeat(500) }],
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/docs_view/query",
      payload: { query: "MATCH (p:person) RETURN p.bio AS biography" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].biography).toBe("x".repeat(500));
  });
});
