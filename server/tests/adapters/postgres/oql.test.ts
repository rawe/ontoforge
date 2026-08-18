/**
 * The PostgreSQL OQL compiler: golden tests on exact SQL text.
 *
 * DB-free by construction — the compiler and the conversion layer are
 * pure. A hand-built `SchemaCacheValue` plus `parseAndValidate` gives a
 * real `ValidatedQuery`; every assertion pins the emitted statement
 * character-for-character, the bind plan, and the conversion plan. The
 * brittleness is deliberate: a changed emission is a visible, reviewed
 * event, exactly as the validator's exact-wording tests are.
 *
 * Covers the module layout and emitter seam, the pinned compilation
 * model, and the compiler-side property-name enforcement. The clause
 * semantics matrix, the single-SELECT invariant and conformance land with
 * the rest of the milestone.
 */

import { describe, expect, it } from "vitest";

import { compileOql, bindValues, convertRows } from "../../../src/adapters/postgres/oql/index.js";
import { StoreError, ValidationError } from "../../../src/core/exceptions.js";
import { parseAndValidate } from "../../../src/core/oql/index.js";
import type { SchemaCacheValue } from "../../../src/runtime/schemaCache.js";
import { prop } from "../../propertyDefs.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHEMA: SchemaCacheValue = {
  ontologyId: "ont-1",
  ontologyKey: "test",
  ontologyName: "Test",
  ontologyDescription: null,
  entityTypes: {
    person: {
      key: "person",
      displayName: "Person",
      description: null,
      properties: {
        name: prop("name", "string"),
        age: prop("age", "integer"),
        score: prop("score", "float"),
        active: prop("active", "boolean"),
        hired: prop("hired", "date"),
        seen_at: prop("seen_at", "datetime"),
        bio: prop("bio", "document"),
      },
    },
    company: {
      key: "company",
      displayName: "Company",
      description: null,
      properties: { name: prop("name", "string") },
    },
  },
  relationTypes: {
    works_for: {
      key: "works_for",
      displayName: "Works For",
      description: null,
      fromEntityTypeKey: "person",
      toEntityTypeKey: "company",
      properties: { role: prop("role", "string"), since: prop("since", "datetime") },
    },
    knows: {
      key: "knows",
      displayName: "Knows",
      description: null,
      fromEntityTypeKey: "person",
      toEntityTypeKey: "person",
      properties: {},
    },
  },
};

function compile(query: string) {
  return compileOql(parseAndValidate(query, SCHEMA));
}

function sql(query: string): string {
  return compile(query).sql;
}

/** The bind plan as compact tokens: a literal value, or `$name`. */
function binds(query: string): unknown[] {
  return compile(query).binds.map((b) => (b.kind === "param" ? `$${b.name}` : b.value));
}

/** The refusal list a compile raised — the same `details.errors` shape
 * the OQL validation path uses, so a caller cannot tell them apart. */
function refusals(query: string): unknown {
  try {
    compile(query);
  } catch (exc) {
    expect(exc).toBeInstanceOf(ValidationError);
    return (exc as ValidationError).details?.errors;
  }
  return expect.unreachable(`${query} compiled`);
}

const PERSON_OBJECT =
  "CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(" +
  "'_id', a.id::text, '_entityTypeKey', a.type_key, " +
  "'_createdAt', a.created_at, '_updatedAt', a.updated_at) || a.props END";

// ---------------------------------------------------------------------------
// The stage machine: one MATCH, one RETURN
// ---------------------------------------------------------------------------

describe("a single stage", () => {
  it("emits one SELECT over the entity table with the type key bound", () => {
    expect(sql("MATCH (a:person) RETURN a.name")).toBe(
      ["SELECT a.props->'name' AS \"a.name\"", "FROM entity a", "WHERE a.type_key = $1"].join("\n"),
    );
    expect(binds("MATCH (a:person) RETURN a.name")).toEqual(["person"]);
  });

  it("projects a node variable as the NULL-guarded system-property object", () => {
    expect(sql("MATCH (a:person) RETURN a")).toBe(
      [`SELECT ${PERSON_OBJECT} AS a`, "FROM entity a", "WHERE a.type_key = $1"].join("\n"),
    );
  });

  it("never selects the embedding column", () => {
    expect(sql("MATCH (a:person) RETURN a")).not.toContain("embedding");
  });

  it("excludes relation endpoints from the projected relationship", () => {
    const emitted = sql("MATCH (a:person)-[r:works_for]->(b:company) RETURN r");
    expect(emitted).toContain(
      "CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(" +
        "'_id', r.id::text, '_relationTypeKey', r.type_key, " +
        "'_createdAt', r.created_at, '_updatedAt', r.updated_at) || r.props END AS r",
    );
    expect(emitted).not.toContain("from_id', ");
    expect(emitted).not.toContain("to_id', ");
  });

  it("names columns from the verbatim expression text, whitespace included", () => {
    expect(compile("MATCH (a:person) RETURN a . name").columns).toEqual(["a . name"]);
    expect(compile("MATCH (a:person) RETURN a.name AS n").columns).toEqual(["n"]);
  });

  it("counts a variable's non-null ids and groups by the projected node", () => {
    expect(sql("MATCH (a:person)-[r:works_for]->(b:company) RETURN a, count(b)")).toBe(
      [
        `SELECT ${PERSON_OBJECT} AS a, count(b.id) AS "count(b)"`,
        "FROM entity a",
        "JOIN relation r ON r.type_key = $2 AND r.from_id = a.id",
        "JOIN entity b ON b.type_key = $3 AND b.id = r.to_id",
        "WHERE a.type_key = $1",
        "GROUP BY a.id, a.type_key, a.props, a.created_at, a.updated_at",
      ].join("\n"),
    );
  });

  it("keeps duplicate column names — the port's Row map collapses them", () => {
    expect(compile("MATCH (a:person) RETURN a.name, a.name").columns).toEqual([
      "a.name",
      "a.name",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Property access: two forms from one schema lookup
// ---------------------------------------------------------------------------

describe("property access", () => {
  it("carries the encoding table's cast in predicate position", () => {
    const where = (expr: string) =>
      sql(`MATCH (a:person) WHERE ${expr} RETURN a.name`).split("\n")[2];
    expect(where("a.name = 'x'")).toBe("WHERE a.type_key = $1 AND a.props->>'name' = $2");
    expect(where("a.bio = 'x'")).toBe("WHERE a.type_key = $1 AND a.props->>'bio' = $2");
    expect(where("a.age > 1")).toBe("WHERE a.type_key = $1 AND (a.props->'age')::numeric > 1");
    expect(where("a.score > 1")).toBe("WHERE a.type_key = $1 AND (a.props->'score')::float8 > 1");
    expect(where("a.active = true")).toBe(
      "WHERE a.type_key = $1 AND (a.props->'active')::boolean = true",
    );
    expect(where("a.hired > '2020-01-01'")).toBe(
      "WHERE a.type_key = $1 AND (a.props->>'hired')::date > $2",
    );
    expect(where("a.seen_at > '2020-01-01'")).toBe(
      "WHERE a.type_key = $1 AND (a.props->>'seen_at')::timestamptz > $2",
    );
  });

  it("stays raw jsonb in projection position", () => {
    expect(sql("MATCH (a:person) RETURN a.age, a.seen_at")).toContain(
      "SELECT a.props->'age' AS \"a.age\", a.props->'seen_at' AS \"a.seen_at\"",
    );
  });

  it("compares _id as text so garbage input is no-match, never 22P02", () => {
    expect(sql("MATCH (a:person) WHERE a._id = 'garbage' RETURN a.name")).toContain(
      "WHERE a.type_key = $1 AND a.id::text = $2",
    );
  });

  it("reads the system properties off their own columns", () => {
    expect(sql("MATCH (a:person) RETURN a._entityTypeKey, a._createdAt, a._updatedAt")).toContain(
      'SELECT a.type_key AS "a._entityTypeKey", a.created_at AS "a._createdAt",' +
        ' a.updated_at AS "a._updatedAt"',
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed-depth patterns
// ---------------------------------------------------------------------------

describe("fixed-depth patterns", () => {
  it("chains INNER JOINs, each link condition on the later table", () => {
    expect(sql("MATCH (a:person)-[r:works_for]->(b:company) RETURN b.name")).toBe(
      [
        "SELECT b.props->'name' AS \"b.name\"",
        "FROM entity a",
        "JOIN relation r ON r.type_key = $2 AND r.from_id = a.id",
        "JOIN entity b ON b.type_key = $3 AND b.id = r.to_id",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });

  it("reverses the endpoint columns for a right-to-left relationship", () => {
    expect(sql("MATCH (a:person)<-[r:knows]-(b:person) RETURN b.name")).toContain(
      "JOIN relation r ON r.type_key = $2 AND r.to_id = a.id",
    );
  });

  it("gives anonymous pattern elements generated aliases", () => {
    expect(sql("MATCH (a:person)-[:works_for]->(:company) RETURN a.name")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\"",
        "FROM entity a",
        "JOIN relation _r0 ON _r0.type_key = $2 AND _r0.from_id = a.id",
        "JOIN entity _e1 ON _e1.type_key = $3 AND _e1.id = _r0.to_id",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });

  it("omits the type condition for a relationship pattern with no type", () => {
    expect(sql("MATCH (a:person)-[]->(b:company) RETURN b.name")).toContain(
      "JOIN relation _r0 ON _r0.from_id = a.id",
    );
  });

  it("omits the type condition for a fully anonymous node pattern", () => {
    expect(sql("MATCH (a:person)-[:works_for]->() RETURN a.name")).toContain(
      "JOIN entity _e1 ON _e1.id = _r0.to_id",
    );
  });

  it("quotes an alias that collides with a SQL keyword", () => {
    expect(sql("MATCH (user:person) RETURN user.name")).toBe(
      [
        "SELECT \"user\".props->'name' AS \"user.name\"",
        "FROM entity \"user\"",
        'WHERE "user".type_key = $1',
      ].join("\n"),
    );
  });

  it("strips backticks from variables, labels and property names", () => {
    expect(sql("MATCH (`a`:`person`) RETURN `a`.`name`")).toBe(
      ["SELECT a.props->'name' AS \"`a`.`name`\"", "FROM entity a", "WHERE a.type_key = $1"].join(
        "\n",
      ),
    );
  });

  it("degenerates a repeated variable into an extra ON condition", () => {
    expect(sql("MATCH (a:person)-[r:knows]->(a) RETURN a.name")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\"",
        "FROM entity a",
        "JOIN relation r ON r.type_key = $2 AND r.from_id = a.id AND r.to_id = a.id",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });

  it("joins disconnected pattern parts as a filtered cartesian product", () => {
    expect(sql("MATCH (a:person), (b:company) RETURN a.name, b.name")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\", b.props->'name' AS \"b.name\"",
        "FROM entity a",
        "JOIN entity b ON b.type_key = $2",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// OPTIONAL MATCH
// ---------------------------------------------------------------------------

describe("OPTIONAL MATCH", () => {
  it("hangs the whole pattern off ONE LEFT JOIN over its inner join tree", () => {
    expect(
      sql(
        "MATCH (a:person) OPTIONAL MATCH (a)-[r:works_for]->(b:company) RETURN a.name, b.name",
      ),
    ).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\", b.props->'name' AS \"b.name\"",
        "FROM entity a",
        "LEFT JOIN (relation r JOIN entity b ON b.type_key = $3 AND b.id = r.to_id)" +
          " ON r.type_key = $2 AND r.from_id = a.id",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });

  it("compiles its WHERE into the outer ON, never the stage WHERE", () => {
    expect(
      sql(
        "MATCH (a:person) OPTIONAL MATCH (a)-[r:works_for]->(b:company) " +
          "WHERE b.name = 'ACME' RETURN a.name",
      ),
    ).toContain(
      "LEFT JOIN (relation r JOIN entity b ON b.type_key = $3 AND b.id = r.to_id)" +
        " ON r.type_key = $2 AND r.from_id = a.id AND b.props->>'name' = $4",
    );
  });

  it("drops the parentheses when the pattern brings one table", () => {
    expect(
      sql("MATCH (a:person) OPTIONAL MATCH (a)-[r:knows]->(a) RETURN a.name"),
    ).toContain("LEFT JOIN relation r ON r.type_key = $2 AND r.from_id = a.id AND r.to_id = a.id");
  });
});

// ---------------------------------------------------------------------------
// WITH — the stage CTE
// ---------------------------------------------------------------------------

describe("WITH", () => {
  it("closes the stage into a CTE and explodes carried node variables", () => {
    expect(sql("MATCH (a:person) WITH a RETURN a.name")).toBe(
      [
        "WITH s0 AS (",
        "SELECT a.id AS a__id, a.type_key AS a__type_key, a.props AS a__props," +
          " a.created_at AS a__created_at, a.updated_at AS a__updated_at",
        "FROM entity a",
        "WHERE a.type_key = $1",
        ")",
        "SELECT s0.a__props->'name' AS \"a.name\"",
        "FROM s0",
      ].join("\n"),
    );
  });

  it("carries a relationship variable with its endpoint columns", () => {
    expect(sql("MATCH (a:person)-[r:works_for]->(b:company) WITH r RETURN r._id")).toContain(
      "SELECT r.id AS r__id, r.type_key AS r__type_key, r.from_id AS r__from_id," +
        " r.to_id AS r__to_id, r.props AS r__props, r.created_at AS r__created_at," +
        " r.updated_at AS r__updated_at",
    );
  });

  it("turns WITH ... WHERE into the next stage's WHERE — no HAVING branch", () => {
    expect(sql("MATCH (a:person) WITH a, count(*) AS n WHERE n > 1 RETURN a.name, n")).toBe(
      [
        "WITH s0 AS (",
        "SELECT a.id AS a__id, a.type_key AS a__type_key, a.props AS a__props," +
          " a.created_at AS a__created_at, a.updated_at AS a__updated_at, count(*) AS n",
        "FROM entity a",
        "WHERE a.type_key = $1",
        "GROUP BY a.id, a.type_key, a.props, a.created_at, a.updated_at",
        ")",
        "SELECT s0.a__props->'name' AS \"a.name\", s0.n AS n",
        "FROM s0",
        "WHERE s0.n > 1",
      ].join("\n"),
    );
  });

  it("groups by every non-aggregate projection item", () => {
    expect(sql("MATCH (a:person) WITH a.name AS n, count(*) AS c RETURN n, c")).toContain(
      "GROUP BY a.props->'name'",
    );
  });

  it("re-matches a carried variable off the CTE columns", () => {
    expect(
      sql("MATCH (a:person) WITH a MATCH (a)-[r:works_for]->(b:company) RETURN b.name"),
    ).toContain("JOIN relation r ON r.type_key = $2 AND r.from_id = s0.a__id");
  });

  it("rejects a WITH item that is neither a variable nor aliased", () => {
    expect(refusals("MATCH (a:person) WITH a.name RETURN a.name")).toEqual([
      "WITH must alias every item that is not a plain variable: 'a.name'.",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

describe("expressions", () => {
  const where = (expr: string) =>
    sql(`MATCH (a:person) WHERE ${expr} RETURN a.name`).split("\n")[2]!.replace("WHERE ", "");

  it("parenthesizes every boolean chain so it composes into the stage WHERE", () => {
    expect(where("a.age > 1 AND a.name = 'x'")).toBe(
      "a.type_key = $1 AND ((a.props->'age')::numeric > 1 AND a.props->>'name' = $2)",
    );
    expect(where("a.age > 1 OR a.age < 9")).toBe(
      "a.type_key = $1 AND ((a.props->'age')::numeric > 1 OR (a.props->'age')::numeric < 9)",
    );
    expect(where("NOT a.name = 'x'")).toBe("a.type_key = $1 AND NOT (a.props->>'name' = $2)");
  });

  it("keeps OR below AND without losing the precedence the parser gave", () => {
    expect(where("a.age > 1 AND a.name = 'x' OR a.active = true")).toBe(
      "a.type_key = $1 AND (((a.props->'age')::numeric > 1 AND a.props->>'name' = $2)" +
        " OR (a.props->'active')::boolean = true)",
    );
  });

  it("maps every comparison sign", () => {
    expect(where("a.age <> 1")).toContain("<> 1");
    expect(where("a.age <= 1")).toContain("<= 1");
    expect(where("a.age >= 1")).toContain(">= 1");
  });

  it("compiles CONTAINS case-sensitively, unlike the port's substring filter", () => {
    expect(where("a.name CONTAINS 'Al'")).toBe(
      "a.type_key = $1 AND position($2 in a.props->>'name') > 0",
    );
  });

  it("tests a node variable's null-ness on its id column", () => {
    expect(
      sql("MATCH (a:person) OPTIONAL MATCH (a)-[r:knows]->(b:person) WHERE b IS NULL RETURN a.name"),
    ).toContain("b.id IS NULL");
    expect(where("a.name IS NOT NULL")).toBe("a.type_key = $1 AND a.props->>'name' IS NOT NULL");
  });

  it("keeps parenthesized expressions parenthesized", () => {
    expect(where("(a.age > 1)")).toBe("a.type_key = $1 AND ((a.props->'age')::numeric > 1)");
  });
});

// ---------------------------------------------------------------------------
// Symbol-atom disambiguation
// ---------------------------------------------------------------------------

describe("symbol-atom disambiguation", () => {
  const limit = (text: string) => sql(`MATCH (a:person) RETURN a.name LIMIT ${text}`).split("\n")[3];

  it("resolves scope before content", () => {
    expect(sql("MATCH (a:person) WITH a.name AS n RETURN n")).toContain("SELECT s0.n AS n");
  });

  it("reads bare integers that lex as symbols as literals", () => {
    expect(limit("0")).toBe("LIMIT 0");
    expect(limit("10")).toBe("LIMIT 10");
    expect(sql("MATCH (a:person) WHERE a.age > 1_000 RETURN a.name")).toContain("> 1000");
  });

  it("reads hexadecimal and octal integer literals", () => {
    const where = (expr: string) => sql(`MATCH (a:person) WHERE ${expr} RETURN a.name`);
    expect(where("a.age > 0x1f")).toContain("> 31");
    expect(where("a.age > 0o17")).toContain("> 15");
    expect(where("a.age > 007")).toContain("> 7");
  });

  it("reads signed and fractional literals that arrive as DIGIT tokens", () => {
    const where = (expr: string) => sql(`MATCH (a:person) WHERE ${expr} RETURN a.name`);
    expect(where("a.age > -5")).toContain("> -5");
    expect(where("a.score > 1.5")).toContain("> 1.5");
  });

  it("rejects a symbol that resolves to neither scope nor a number", () => {
    expect(refusals("MATCH (a:person) RETURN b")).toEqual(["Unknown variable 'b'. Available: a"]);
  });
});

// ---------------------------------------------------------------------------
// Parameters, literals and the bind plan
// ---------------------------------------------------------------------------

describe("the bind plan", () => {
  it("binds type keys, string literals and parameters, and inlines nothing", () => {
    const query =
      "MATCH (a:person)-[r:works_for]->(b:company) WHERE a.name = 'Ada' AND b.name = $co " +
      "RETURN a.name";
    expect(binds(query)).toEqual(["person", "works_for", "company", "Ada", "$co"]);
    expect(sql(query)).not.toContain("Ada");
  });

  it("binds a repeated parameter once", () => {
    expect(
      binds("MATCH (a:person) WHERE a.name = $n OR a.bio = $n RETURN a.name"),
    ).toEqual(["person", "$n"]);
  });

  it("compiles booleans and NULL as SQL keywords, not binds", () => {
    expect(binds("MATCH (a:person) WHERE a.active = true RETURN a.name")).toEqual(["person"]);
  });

  it("resolves the bind plan against supplied parameter values", () => {
    const compiled = compile("MATCH (a:person) WHERE a.name = $n RETURN a.name");
    expect(bindValues(compiled, { n: "Ada" })).toEqual(["person", "Ada"]);
  });

  it("fails with a StoreError naming a parameter missing at bind time", () => {
    const compiled = compile("MATCH (a:person) WHERE a.name = $n RETURN a.name");
    expect(() => bindValues(compiled, {})).toThrow(StoreError);
    expect(() => bindValues(compiled, {})).toThrow(/n/);
  });
});

// ---------------------------------------------------------------------------
// ORDER BY / SKIP / LIMIT
// ---------------------------------------------------------------------------

describe("ordering and paging", () => {
  it("sorts on the cast form and pages with LIMIT before OFFSET", () => {
    expect(sql("MATCH (a:person) RETURN a.name ORDER BY a.age DESC SKIP 5 LIMIT 10")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\"",
        "FROM entity a",
        "WHERE a.type_key = $1",
        "ORDER BY (a.props->'age')::numeric DESC",
        "LIMIT 10",
        "OFFSET 5",
      ].join("\n"),
    );
  });

  it("emits ascending order without a direction keyword", () => {
    expect(sql("MATCH (a:person) RETURN a.name ORDER BY a.age, a.name DESC")).toContain(
      "ORDER BY (a.props->'age')::numeric, a.props->>'name' DESC",
    );
  });
});

// ---------------------------------------------------------------------------
// M5.3 — compiler-side enforcement
// ---------------------------------------------------------------------------

describe("compiler-side property enforcement", () => {
  it("rejects a property the validator never checked, with the validator's wording", () => {
    expect(refusals("MATCH (a:person) WITH a AS x RETURN x.bogus")).toEqual([
      "Unknown property 'bogus' on entity type 'person'. Available: active, age, bio, hired, " +
        "name, score, seen_at, _createdAt, _entityTypeKey, _id, _relationTypeKey, _updatedAt",
    ]);
  });

  it("names the relation type when the alias carries a relationship", () => {
    expect(
      refusals("MATCH (a:person)-[r:works_for]->(b:company) WITH r AS x RETURN x.bogus"),
    ).toEqual([
      "Unknown property 'bogus' on relation type 'works_for'. Available: role, since, " +
        "_createdAt, _entityTypeKey, _id, _relationTypeKey, _updatedAt",
    ]);
  });

  it("still compiles a resolvable alias access — scope tracks rebinds", () => {
    expect(sql("MATCH (a:person) WITH a AS x RETURN x.name")).toContain("s0.x__props->'name'");
  });

  it("allows system properties on any alias", () => {
    expect(sql("MATCH (a:person) WITH a AS x RETURN x._id")).toContain("s0.x__id::text");
  });

  it("refuses property access on a scalar alias", () => {
    expect(refusals("MATCH (a:person) WITH count(*) AS c RETURN c.bogus")).toEqual([
      "'c' is not a node or relationship, so it has no properties.",
    ]);
  });

  it("refuses through the message the OQL validation path uses", () => {
    const refuse = () => compile("MATCH (a:person) WITH a AS x RETURN x.bogus");
    expect(refuse).toThrow(ValidationError);
    expect(refuse).toThrow("Query validation failed");
  });
});

// ---------------------------------------------------------------------------
// The conversion plan
// ---------------------------------------------------------------------------

describe("the conversion plan", () => {
  it("plans Number() for count and Date for declared datetimes", () => {
    const compiled = compile(
      "MATCH (a:person) RETURN a.name, a.age, a.seen_at, a._createdAt, count(*)",
    );
    expect(compiled.conversions).toEqual([
      { kind: "none" },
      { kind: "none" },
      { kind: "datetime" },
      { kind: "datetime" },
      { kind: "number" },
    ]);
  });

  it("plans the object conversion with the type's datetime keys", () => {
    expect(compile("MATCH (a:person) RETURN a").conversions).toEqual([
      { kind: "entity", typeKey: "person", datetimeKeys: ["_createdAt", "_updatedAt", "seen_at"] },
    ]);
    expect(
      compile("MATCH (a:person)-[r:works_for]->(b:company) RETURN r").conversions,
    ).toEqual([
      { kind: "relation", typeKey: "works_for", datetimeKeys: ["_createdAt", "_updatedAt", "since"] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Result conversion
// ---------------------------------------------------------------------------

describe("result conversion", () => {
  it("folds array-mode rows into the port's Row map", () => {
    const compiled = compile("MATCH (a:person) RETURN a.name, count(*)");
    expect(convertRows(compiled, [["Ada", "3"]])).toEqual([{ "a.name": "Ada", "count(*)": 3 }]);
  });

  it("collapses duplicate column names onto the last value", () => {
    const compiled = compile("MATCH (a:person) RETURN a.name, a.name");
    expect(convertRows(compiled, [["first", "second"]])).toEqual([{ "a.name": "second" }]);
  });

  it("converts declared datetime properties of a projected node", () => {
    const compiled = compile("MATCH (a:person) RETURN a");
    const [row] = convertRows(compiled, [
      [
        {
          _id: "e1",
          _entityTypeKey: "person",
          _createdAt: "2024-01-02T03:04:05+00:00",
          _updatedAt: "2024-01-02T03:04:05+00:00",
          name: "Ada",
          seen_at: "2024-05-06T07:08:09+00:00",
        },
      ],
    ]);
    const value = (row as Record<string, Record<string, unknown>>).a!;
    expect(value._createdAt).toEqual(new Date("2024-01-02T03:04:05Z"));
    expect(value.seen_at).toEqual(new Date("2024-05-06T07:08:09Z"));
    expect(value.name).toBe("Ada");
  });

  it("passes SQL NULL through untouched", () => {
    const compiled = compile("MATCH (a:person) RETURN a");
    expect(convertRows(compiled, [[null]])).toEqual([{ a: null }]);
  });

  it("recurses through lists", () => {
    const compiled = compile("MATCH (a:person) RETURN a.seen_at");
    expect(convertRows(compiled, [[["2024-01-02T03:04:05+00:00"]]])).toEqual([
      { "a.seen_at": [new Date("2024-01-02T03:04:05Z")] },
    ]);
  });
});
