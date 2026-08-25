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
 * model, the compiler-side property-name enforcement, the whole clause
 * and expression matrix, and the single-SELECT invariant. Live behaviour
 * on both backends stays the conformance suite's job.
 */

import { describe, expect, it } from "vitest";

import { compileOql, bindValues, convertRows } from "../../../src/adapters/postgres/oql/index.js";
import { pendingSurface } from "../../../src/adapters/postgres/oql/rejections.js";
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

  it("opens a stage as a plain FROM — a LEFT JOIN has nothing to hang off", () => {
    expect(sql("OPTIONAL MATCH (a:person) RETURN a.name")).toBe(
      ["SELECT a.props->'name' AS \"a.name\"", "FROM entity a", "WHERE a.type_key = $1"].join("\n"),
    );
    expect(sql("OPTIONAL MATCH (a:person)-[r:works_for]->(b:company) RETURN a.name")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\"",
        "FROM entity a",
        "JOIN relation r ON r.type_key = $2 AND r.from_id = a.id",
        "JOIN entity b ON b.type_key = $3 AND b.id = r.to_id",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
    // With no row to preserve there is nothing an OPTIONAL MATCH can add.
    expect(sql("OPTIONAL MATCH (a:person) WHERE a.age > 5 RETURN a.name")).toBe(
      sql("MATCH (a:person) WHERE a.age > 5 RETURN a.name"),
    );
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

  it("groups by every non-aggregate projection item, in both its forms", () => {
    // The sort form of a grouped property must itself be a grouping key
    // — `ORDER BY a.name` reads the cast, not the projection form.
    expect(sql("MATCH (a:person) WITH a.name AS n, count(*) AS c RETURN n, c")).toContain(
      "GROUP BY a.props->'name', a.props->>'name'",
    );
    expect(
      sql("MATCH (a:person) RETURN a.name AS n, count(*) AS c ORDER BY a.name"),
    ).toContain("GROUP BY a.props->'name', a.props->>'name'\nORDER BY a.props->>'name'");
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

  it("pages on every integer-literal form the language accepts", () => {
    expect(limit("1_000")).toBe("LIMIT 1000");
    expect(limit("0x10")).toBe("LIMIT 16");
    expect(sql("MATCH (a:person) RETURN a.name SKIP 0o17")).toContain("OFFSET 15");
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
  it("binds type keys, string literals and parameters", () => {
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

  it("sorts on an output alias of the same projection by name", () => {
    expect(sql("MATCH (a:person) RETURN a.name AS n ORDER BY n DESC")).toBe(
      [
        "SELECT a.props->'name' AS n",
        "FROM entity a",
        "WHERE a.type_key = $1",
        "ORDER BY n DESC",
      ].join("\n"),
    );
  });

  it("sorts on an aggregate alias alongside a plain one", () => {
    expect(sql("MATCH (a:person) RETURN a.name AS n, count(*) AS c ORDER BY c DESC, n")).toContain(
      "ORDER BY c DESC, n",
    );
  });

  it("prefers the pattern variable when an alias does not shadow it", () => {
    // `a.age` is an expression, not a bare output name — it walks.
    expect(sql("MATCH (a:person) RETURN a.name AS n ORDER BY a.age")).toContain(
      "ORDER BY (a.props->'age')::numeric",
    );
  });

  it("re-emits a WITH's ordering on the outermost SELECT", () => {
    expect(sql("MATCH (a:person) WITH a ORDER BY a.age DESC LIMIT 2 RETURN a.name")).toBe(
      [
        "WITH s0 AS (",
        "SELECT a.id AS a__id, a.type_key AS a__type_key, a.props AS a__props," +
          " a.created_at AS a__created_at, a.updated_at AS a__updated_at," +
          " (a.props->'age')::numeric AS __ord0",
        "FROM entity a",
        "WHERE a.type_key = $1",
        "ORDER BY (a.props->'age')::numeric DESC",
        "LIMIT 2",
        ")",
        "SELECT s0.a__props->'name' AS \"a.name\"",
        "FROM s0",
        "ORDER BY s0.__ord0 DESC",
      ].join("\n"),
    );
  });

  it("reaches a WITH's ordering through the alias when it has one", () => {
    expect(sql("MATCH (a:person) WITH a.name AS n ORDER BY n RETURN n")).toContain(
      "FROM s0\nORDER BY s0.n",
    );
  });

  it("drops the carried ordering when the RETURN aggregates", () => {
    // Aggregation collapses the rows the sort key belonged to: the key is
    // neither grouped nor aggregated, so re-emitting it is invalid SQL —
    // and row identity does not survive aggregation in the reference
    // adapter either.
    expect(sql("MATCH (a:person) WITH a ORDER BY a.age DESC LIMIT 3 RETURN collect(a.name) AS top"))
      .toBe(
        [
          "WITH s0 AS (",
          "SELECT a.id AS a__id, a.type_key AS a__type_key, a.props AS a__props," +
            " a.created_at AS a__created_at, a.updated_at AS a__updated_at," +
            " (a.props->'age')::numeric AS __ord0",
          "FROM entity a",
          "WHERE a.type_key = $1",
          "ORDER BY (a.props->'age')::numeric DESC",
          "LIMIT 3",
          ")",
          "SELECT COALESCE(jsonb_agg(s0.a__props->'name')" +
            " FILTER (WHERE s0.a__props->>'name' IS NOT NULL), '[]'::jsonb) AS top",
          "FROM s0",
        ].join("\n"),
      );
    expect(sql("MATCH (a:person) WITH a ORDER BY a.age RETURN count(*) AS n")).not.toContain(
      "ORDER BY s0.__ord0",
    );
    // The grouped form: `__ord0` is in no GROUP BY either.
    expect(
      sql("MATCH (a:person) WITH a ORDER BY a.age RETURN a.name AS name, count(*) AS n"),
    ).not.toContain("ORDER BY s0.__ord0");
  });

  it("lets the RETURN's own ordering win over the carried one", () => {
    const emitted = sql("MATCH (a:person) WITH a ORDER BY a.age RETURN a.name ORDER BY a.name");
    expect(emitted).toContain("FROM s0\nORDER BY s0.a__props->>'name'");
    expect(emitted).not.toContain("__ord0 DESC");
  });

  it("pages on a $parameter, marking the bind for the value check", () => {
    const compiled = compile("MATCH (a:person) RETURN a.name SKIP $off LIMIT $top");
    expect(compiled.sql).toContain("LIMIT $2\nOFFSET $3");
    expect(compiled.binds).toEqual([
      { kind: "value", value: "person" },
      { kind: "param", name: "top", paging: true },
      { kind: "param", name: "off", paging: true },
    ]);
    expect(bindValues(compiled, { off: 5, top: "10" })).toEqual(["person", "10", 5]);
  });

  it("refuses a paging argument that is not a non-negative integer", () => {
    const compiled = compile("MATCH (a:person) RETURN a.name LIMIT $top");
    for (const top of [-1, 1.5, "x", null]) {
      expect(() => bindValues(compiled, { top })).toThrow(StoreError);
      expect(() => bindValues(compiled, { top })).toThrow(
        "SKIP/LIMIT takes a non-negative integer: $top",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// RETURN * / WITH *
// ---------------------------------------------------------------------------

describe("the star projection", () => {
  it("expands every in-scope variable, alphabetically, under its own name", () => {
    expect(
      compile("MATCH (zebra:person)-[rel:knows]->(apple:person) RETURN *").columns,
    ).toEqual(["apple", "rel", "zebra"]);
  });

  it("projects each expanded variable as its whole object", () => {
    expect(sql("MATCH (a:person) RETURN *")).toBe(
      [`SELECT ${PERSON_OBJECT} AS a`, "FROM entity a", "WHERE a.type_key = $1"].join("\n"),
    );
  });

  it("keeps explicit items after the expansion", () => {
    expect(compile("MATCH (a:person) RETURN *, a.name AS n").columns).toEqual(["a", "n"]);
  });

  it("expands scalar aliases carried across a WITH too", () => {
    const compiled = compile("MATCH (a:person) WITH a, count(*) AS n RETURN *");
    expect(compiled.columns).toEqual(["a", "n"]);
    expect(compiled.conversions[1]).toEqual({ kind: "number" });
    expect(compiled.sql).toContain("|| s0.a__props END AS a, s0.n AS n");
  });

  it("carries every variable through a WITH *", () => {
    expect(sql("MATCH (a:person) WITH * RETURN a.name")).toBe(
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

  it("never expands an anonymous pattern element — it is not in scope", () => {
    expect(compile("MATCH (a:person)-[:works_for]->(:company) RETURN *").columns).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// Lists, maps and IN
// ---------------------------------------------------------------------------

describe("lists, maps and membership", () => {
  it("folds a wholly constant list into one jsonb bind", () => {
    const compiled = compile("MATCH (a:person) RETURN [1, 'x', true, null] AS xs");
    expect(compiled.sql).toContain("SELECT $2::jsonb AS xs");
    expect(compiled.binds[1]).toEqual({ kind: "value", value: '[1,"x",true,null]' });
  });

  it("composes a list with a non-constant element", () => {
    expect(sql("MATCH (a:person) RETURN [1, a.age] AS xs")).toContain(
      "SELECT jsonb_build_array(to_jsonb(1), a.props->'age') AS xs",
    );
  });

  it("folds and composes map literals the same way", () => {
    const compiled = compile("MATCH (a:person) RETURN {k: 'v'} AS m, {k: a.name} AS m2");
    expect(compiled.sql).toContain(
      "SELECT $2::jsonb AS m, jsonb_build_object('k', a.props->'name') AS m2",
    );
    expect(compiled.binds[1]).toEqual({ kind: "value", value: '{"k":"v"}' });
  });

  it("compares lists as whole jsonb values, not element by element", () => {
    expect(sql("MATCH (a:person) WHERE [1, 2.5] = [1, 2.5] RETURN a.name")).toContain(
      "WHERE a.type_key = $1 AND $2::jsonb = $3::jsonb",
    );
  });

  it("compiles IN as containment with Cypher's three-valued outcome", () => {
    expect(sql("MATCH (a:person) WHERE a.name IN ['Ada', 'Bob'] RETURN a.name")).toContain(
      "WHERE a.type_key = $1 AND CASE WHEN ($2::jsonb) @> (a.props->'name') THEN true" +
        " WHEN (a.props->'name') IS NULL OR ($2::jsonb) IS NULL" +
        " OR ($2::jsonb) @> 'null'::jsonb THEN NULL ELSE false END",
    );
  });

  it("takes a list parameter as one JSON-encoded bind, and no other", () => {
    const compiled = compile("MATCH (a:person) WHERE a._id IN $ids RETURN a.name");
    expect(compiled.sql).toContain("($2::jsonb) @> (to_jsonb(a.id::text))");
    expect(compiled.binds).toEqual([
      { kind: "value", value: "person" },
      { kind: "param", name: "ids", json: true },
    ]);
    expect(bindValues(compiled, { ids: ["e1", "e2"] })).toEqual(["person", '["e1","e2"]']);
  });
});

// ---------------------------------------------------------------------------
// The seven aggregates
// ---------------------------------------------------------------------------

describe("aggregates", () => {
  const projected = (expr: string) =>
    sql(`MATCH (a:person) RETURN ${expr}`).split("\n")[0]!.replace("SELECT ", "");
  const converted = (expr: string) =>
    compile(`MATCH (a:person) RETURN ${expr}`).conversions[0];

  it("bends sum's empty group to Cypher's 0", () => {
    expect(projected("sum(a.age) AS s")).toBe("COALESCE(sum((a.props->'age')::numeric), 0) AS s");
    expect(converted("sum(a.age)")).toEqual({ kind: "number" });
  });

  it("leaves avg, min and max on SQL's native NULL", () => {
    expect(projected("avg(a.age) AS a1")).toBe("avg((a.props->'age')::numeric) AS a1");
    expect(projected("min(a.name) AS m1")).toBe("min(a.props->>'name') AS m1");
    expect(projected("max(a.seen_at) AS m2")).toBe("max((a.props->>'seen_at')::timestamptz) AS m2");
    expect(converted("avg(a.age)")).toEqual({ kind: "number" });
    expect(converted("min(a.name)")).toEqual({ kind: "none" });
    expect(converted("max(a.seen_at)")).toEqual({ kind: "datetime" });
  });

  it("bends collect's empty group to [] and drops its nulls", () => {
    expect(projected("collect(a.name) AS c")).toBe(
      "COALESCE(jsonb_agg(a.props->'name') FILTER (WHERE a.props->>'name' IS NOT NULL)," +
        " '[]'::jsonb) AS c",
    );
  });

  it("collects whole nodes and keeps their conversion plan", () => {
    expect(projected("collect(a) AS c")).toBe(
      `COALESCE(jsonb_agg(${PERSON_OBJECT}) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb) AS c`,
    );
    expect(converted("collect(a)")).toEqual({
      kind: "entity",
      typeKey: "person",
      datetimeKeys: ["_createdAt", "_updatedAt", "seen_at"],
    });
  });

  it("carries a collected object's conversion across a WITH", () => {
    expect(compile("MATCH (a:person) WITH collect(a) AS xs RETURN xs").conversions).toEqual([
      { kind: "entity", typeKey: "person", datetimeKeys: ["_createdAt", "_updatedAt", "seen_at"] },
    ]);
  });

  it("converts a collected list element by element", () => {
    const compiled = compile("MATCH (a:person) RETURN collect(a.seen_at) AS c");
    expect(convertRows(compiled, [[["2024-01-02T03:04:05+00:00"]]])).toEqual([
      { c: [new Date("2024-01-02T03:04:05Z")] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Inline property maps
// ---------------------------------------------------------------------------

describe("inline property maps", () => {
  it("emits one cast equality per key, in written order", () => {
    expect(sql("MATCH (a:person {name: 'Ada', age: 30}) RETURN a.name")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\"",
        "FROM entity a",
        "WHERE a.type_key = $1 AND a.props->>'name' = $2 AND (a.props->'age')::numeric = 30",
      ].join("\n"),
    );
  });

  it("puts a relationship's keys on the relationship's own join", () => {
    expect(
      sql("MATCH (a:person)-[r:works_for {role: 'Eng'}]->(b:company {name: 'Acme'}) RETURN a.name"),
    ).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\"",
        "FROM entity a",
        "JOIN relation r ON r.type_key = $2 AND r.props->>'role' = $3 AND r.from_id = a.id",
        "JOIN entity b ON b.type_key = $4 AND b.props->>'name' = $5 AND b.id = r.to_id",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });

  it("resolves a system property key off its own column", () => {
    expect(sql("MATCH (a:person {_id: 'e1'}) RETURN a.name")).toContain(
      "WHERE a.type_key = $1 AND a.id::text = $2",
    );
  });

  it("resolves its keys through the same schema lookup a predicate uses", () => {
    // The lens check happens at validation and again here, so a key that
    // stopped resolving refuses rather than quietly matching nothing.
    expect(sql("MATCH (a:person {seen_at: '2024-01-01'}) RETURN a.name")).toContain(
      "(a.props->>'seen_at')::timestamptz = $2",
    );
  });
});

// ---------------------------------------------------------------------------
// Undirected relationships
// ---------------------------------------------------------------------------

describe("undirected relationships", () => {
  it("matches both readings of the edge in one condition on the later table", () => {
    expect(sql("MATCH (a:person)-[r:knows]-(b:person) RETURN a.name, b.name")).toBe(
      [
        "SELECT a.props->'name' AS \"a.name\", b.props->'name' AS \"b.name\"",
        "FROM entity a",
        "JOIN relation r ON r.type_key = $2",
        "JOIN entity b ON b.type_key = $3 AND (r.from_id = a.id AND r.to_id = b.id" +
          " OR r.from_id = b.id AND r.to_id = a.id)",
        "WHERE a.type_key = $1",
      ].join("\n"),
    );
  });

  it("collapses to one reading when both ends are the same variable", () => {
    expect(sql("MATCH (a:person)-[r:knows]-(a) RETURN a.name")).toContain(
      "JOIN relation r ON r.type_key = $2 AND (r.from_id = a.id AND r.to_id = a.id" +
        " OR r.from_id = a.id AND r.to_id = a.id)",
    );
  });

  it("rides the outer ON of an OPTIONAL MATCH like any link condition", () => {
    expect(
      sql("MATCH (a:person) OPTIONAL MATCH (a)-[r:knows]-(b:person) RETURN a.name, b.name"),
    ).toContain(
      "LEFT JOIN (relation r JOIN entity b ON b.type_key = $3)" +
        " ON r.type_key = $2 AND (r.from_id = a.id AND r.to_id = b.id" +
        " OR r.from_id = b.id AND r.to_id = a.id)",
    );
  });
});

// ---------------------------------------------------------------------------
// The degenerate OPTIONAL MATCH
// ---------------------------------------------------------------------------

describe("an OPTIONAL MATCH that introduces no variable", () => {
  it("emits nothing at all — an OPTIONAL MATCH never removes a row", () => {
    const plain = sql("MATCH (a:person) RETURN a.name");
    expect(sql("MATCH (a:person) OPTIONAL MATCH (a) RETURN a.name")).toBe(plain);
    expect(sql("MATCH (a:person) OPTIONAL MATCH (a:company) RETURN a.name")).toBe(plain);
    expect(sql("MATCH (a:person) OPTIONAL MATCH (a) WHERE a.age > 5 RETURN a.name")).toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// M5.5 — read-only by construction
// ---------------------------------------------------------------------------

describe("the single-SELECT invariant", () => {
  const CORPUS = [
    "MATCH (a:person) RETURN a",
    "MATCH (a:person)-[r:works_for]->(b:company) WHERE a.name = $n RETURN a, r, b",
    "MATCH (a:person) OPTIONAL MATCH (a)-[r:knows]-(b:person) RETURN a.name, b.name",
    "MATCH (a:person {name: 'Ada'}) WITH a, count(*) AS n WHERE n > 0 RETURN *",
    "MATCH (a:person) WHERE a.name IN ['x'] AND a.bio CONTAINS 'y' RETURN collect(a) AS c",
    "MATCH (a:person) RETURN a.name AS n ORDER BY n DESC SKIP $s LIMIT $l",
  ];
  const WRITE_VERBS =
    /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|copy|call)\b/i;

  it("emits exactly one statement, one SELECT per stage, and no write verb", () => {
    for (const query of CORPUS) {
      const emitted = sql(query);
      expect(emitted, query).not.toContain(";");
      expect(emitted, query).toMatch(/^(SELECT|WITH )/);
      expect(WRITE_VERBS.test(emitted), query).toBe(false);
      // One SELECT for the outermost statement, one per stage CTE.
      const selects = emitted.match(/\bSELECT\b/g)!.length;
      const ctes = emitted.match(/ AS \(\n/g)?.length ?? 0;
      expect(selects, query).toBe(ctes + 1);
    }
  });

  it("carries every user-originated value as a bind, never as SQL text", () => {
    const compiled = compile(
      "MATCH (a:person {name: 'Ada'}) WHERE a.bio CONTAINS 'sec\\'ret' RETURN a.name",
    );
    expect(compiled.sql).not.toContain("Ada");
    expect(compiled.sql).not.toContain("sec");
    expect(compiled.binds).toContainEqual({ kind: "value", value: "sec'ret" });
  });
});

// ---------------------------------------------------------------------------
// M5.3 — compiler-side enforcement
// ---------------------------------------------------------------------------

describe("compiler-side property enforcement", () => {
  // Property access through a variable with no declared type — a WITH
  // alias, an untyped relationship — is rejected at validation on every
  // backend, so the compiler's second line only ever sees pattern-typed
  // variables and system properties.

  it("allows system properties on any alias", () => {
    expect(sql("MATCH (a:person) WITH a AS x RETURN x._id")).toContain("s0.x__id::text");
  });

  it("refuses through the message the OQL validation path uses", () => {
    const refuse = () => compile("MATCH (a:person) RETURN b");
    expect(refuse).toThrow(ValidationError);
    expect(refuse).toThrow("Query validation failed");
  });
});

// ---------------------------------------------------------------------------
// The pending-surface guard
// ---------------------------------------------------------------------------

describe("the pending-surface guard", () => {
  it("names the construct in a vendor-free sentence", () => {
    expect(() => pendingSurface("a probe construct")).toThrow(
      "OQL construct not compiled by this storage adapter yet: a probe construct",
    );
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
