/**
 * Session-07 integration suite — OQL end to end against the
 * docker-compose Neo4j: parse → validate → compile → execute → per-column
 * post-processing, through unscoped and scoped lenses, plus the runtime
 * MCP `execute_query` round trip.
 *
 * Covers the spec's scenarios: multi-hop traversal, aggregation,
 * ORDER BY/SKIP/LIMIT, OPTIONAL MATCH; per-column stripping through a
 * scoped lens; document stub vs aliased-projection full text; a scoped
 * lens rejecting a globally valid type identically to a nonexistent one;
 * out-of-surface constructs (variable-length patterns) and inline-map
 * lens violations rejected end-to-end; and a validation failure carrying
 * hints over MCP.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { closeStores, initStores } from "../../src/core/ports.js";
import { wipeDatabase } from "./reset.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { buildFixture } from "./fixture.js";

type Row = Record<string, unknown>;

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  await initStores();
  await wipeDatabase();
  app = await createApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await wipeDatabase();
  await app.close();
  await closeStores();
});

beforeEach(async () => {
  await wipeDatabase();
  invalidateLoadedSchemaCache();
  await buildFixture(app);
});

async function createEntity(ontology: string, typeKey: string, payload: Row): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/runtime/${ontology}/entities/${typeKey}`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Row;
}

async function createRelation(ontology: string, typeKey: string, payload: Row): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/runtime/${ontology}/relations/${typeKey}`,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as Row;
}

async function query(ontology: string, oql: string, expectedStatus = 200): Promise<Row> {
  const res = await app.inject({
    method: "POST",
    url: `/api/runtime/${ontology}/query`,
    payload: { query: oql },
  });
  expect(res.statusCode, res.body).toBe(expectedStatus);
  return res.json() as Row;
}

/** Alice + Bob at Acme, Carol at Globex. */
async function seedGraph(): Promise<{ alice: Row; bob: Row; carol: Row; acme: Row; globex: Row }> {
  const alice = await createEntity("test_ontology", "person", { name: "Alice", age: 30 });
  const bob = await createEntity("test_ontology", "person", { name: "Bob", age: 40 });
  const carol = await createEntity("test_ontology", "person", { name: "Carol", age: 25 });
  const acme = await createEntity("test_ontology", "company", { name: "Acme" });
  const globex = await createEntity("test_ontology", "company", { name: "Globex" });
  await createRelation("test_ontology", "works_for", {
    fromEntityId: alice._id,
    toEntityId: acme._id,
    role: "Engineer",
  });
  await createRelation("test_ontology", "works_for", {
    fromEntityId: bob._id,
    toEntityId: acme._id,
    role: "Manager",
  });
  await createRelation("test_ontology", "works_for", {
    fromEntityId: carol._id,
    toEntityId: globex._id,
    role: "Analyst",
  });
  return { alice, bob, carol, acme, globex };
}

describe("query execution (unscoped lens)", () => {
  it("multi-hop traversal returns rows in ontology vocabulary", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person)-[r:works_for]->(c:company) WHERE c.name = 'Acme' " +
        "RETURN p.name AS name, r.role AS role ORDER BY p.name",
    );
    expect(body.columns).toEqual(["name", "role"]);
    expect(body.results).toEqual([
      { name: "Alice", role: "Engineer" },
      { name: "Bob", role: "Manager" },
    ]);
  });

  it("colleague-of-colleague traversal (two hops)", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person)-[:works_for]->(c:company)<-[:works_for]-(colleague:person) " +
        "WHERE p.name = 'Alice' AND colleague.name <> 'Alice' " +
        "RETURN colleague.name AS name",
    );
    expect(body.results).toEqual([{ name: "Bob" }]);
  });

  it("aggregation with count and avg", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person)-[:works_for]->(c:company) " +
        "RETURN c.name AS company, count(p) AS headcount, avg(p.age) AS avgAge " +
        "ORDER BY c.name",
    );
    expect(body.results).toEqual([
      { company: "Acme", headcount: 2, avgAge: 35 },
      { company: "Globex", headcount: 1, avgAge: 25 },
    ]);
  });

  it("ORDER BY / SKIP / LIMIT page through rows", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person) RETURN p.name AS name ORDER BY p.age DESC SKIP 1 LIMIT 1",
    );
    expect(body.results).toEqual([{ name: "Alice" }]);
  });

  it("OPTIONAL MATCH yields null columns for unmatched patterns", async () => {
    const { globex } = await seedGraph();
    // Dana works nowhere.
    await createEntity("test_ontology", "person", { name: "Dana", age: 50 });
    const body = await query(
      "test_ontology",
      "MATCH (p:person) OPTIONAL MATCH (p)-[r:works_for]->(c:company) " +
        "RETURN p.name AS name, c.name AS company ORDER BY p.name",
    );
    expect(body.results).toEqual([
      { name: "Alice", company: "Acme" },
      { name: "Bob", company: "Acme" },
      { name: "Carol", company: "Globex" },
      { name: "Dana", company: null },
    ]);
    expect(globex._id).toBeDefined();
  });

  it("answers a query whose first clause is OPTIONAL MATCH", async () => {
    await seedGraph();
    const plain = await query(
      "test_ontology",
      "OPTIONAL MATCH (p:person) RETURN p.name AS name ORDER BY p.name",
    );
    expect(plain.results).toEqual([{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }]);

    const traversal = await query(
      "test_ontology",
      "OPTIONAL MATCH (p:person)-[:works_for]->(c:company) WHERE c.name = 'Acme' " +
        "RETURN p.name AS name ORDER BY p.name",
    );
    expect(traversal.results).toEqual([{ name: "Alice" }, { name: "Bob" }]);
  });

  it("rejects a variable-length pattern at validation", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person)-[:works_for*1..2]->(c:company) RETURN p",
      422,
    );
    const errors = ((body.error as Row).details as Row).errors as string[];
    expect(errors).toContain(
      "Variable-length relationship patterns are not supported. " +
        "Write each hop as an explicit relationship pattern.",
    );
  });

  it("rejects property access through a variable with no declared type", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person)-[r]->(c:company) RETURN r.role",
      422,
    );
    const errors = ((body.error as Row).details as Row).errors as string[];
    expect(errors).toContain(
      "Properties cannot be read through a variable with no declared type. " +
        "Name the type in the pattern that binds it.",
    );
  });

  it("rejects an inline map on an untyped owner", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH ({name: 'Alice'})-[r:works_for]->(c:company) RETURN c",
      422,
    );
    const errors = ((body.error as Row).details as Row).errors as string[];
    expect(errors).toContain(
      "An inline property map needs a typed owner — add a label to the node " +
        "(or a type to the relationship) so its keys can be validated.",
    );
  });

  it("whole nodes come back as flat property maps with system properties", async () => {
    const { alice } = await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (p:person) WHERE p.name = 'Alice' RETURN p",
    );
    const p = (body.results as Row[])[0]!.p as Row;
    expect(p.name).toBe("Alice");
    expect(p.age).toBe(30);
    expect(p._id).toBe(alice._id);
    expect(p._entityTypeKey).toBe("person");
    expect(p._createdAt).toBeDefined();
    expect(p).not.toHaveProperty("_embedding");
  });

  it("whole relationships carry properties but no endpoint ids", async () => {
    await seedGraph();
    const body = await query(
      "test_ontology",
      "MATCH (:person {name: 'Alice'})-[r:works_for]->(:company) RETURN r",
    );
    const r = (body.results as Row[])[0]!.r as Row;
    expect(r.role).toBe("Engineer");
    expect(r._relationTypeKey).toBe("works_for");
    expect(r).not.toHaveProperty("fromEntityId");
    expect(r).not.toHaveProperty("toEntityId");
  });

  it("unbounded queries return every row (no server-imposed limit)", async () => {
    await seedGraph();
    const body = await query("test_ontology", "MATCH (p:person) RETURN p.name AS name");
    expect(body.results).toHaveLength(3);
  });
});

describe("the clause and expression matrix", () => {
  /** Alice 30, Bob 40, Dana with no age at all. */
  async function seedAges(): Promise<void> {
    await createEntity("test_ontology", "person", { name: "Alice", age: 30 });
    await createEntity("test_ontology", "person", { name: "Bob", age: 40 });
    await createEntity("test_ontology", "person", { name: "Dana" });
  }

  describe("the seven aggregates", () => {
    it("computes every cell over a non-empty group", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.name <> 'Dana' " +
          "RETURN count(*) AS rows, count(p.age) AS ages, sum(p.age) AS total, " +
          "avg(p.age) AS mean, min(p.age) AS lowest, max(p.age) AS highest, " +
          "collect(p.name) AS names",
      );
      const row = (body.results as Row[])[0]!;
      expect(row.rows).toBe(2);
      expect(row.ages).toBe(2);
      expect(row.total).toBe(70);
      expect(row.mean).toBe(35);
      expect(row.lowest).toBe(30);
      expect(row.highest).toBe(40);
      expect([...(row.names as string[])].sort()).toEqual(["Alice", "Bob"]);
    });

    it("answers an empty group with Cypher's values, not SQL's", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.name = 'Nobody' " +
          "RETURN count(*) AS rows, sum(p.age) AS total, avg(p.age) AS mean, " +
          "min(p.age) AS lowest, max(p.age) AS highest, collect(p.name) AS names",
      );
      expect(body.results).toEqual([
        { rows: 0, total: 0, mean: null, lowest: null, highest: null, names: [] },
      ]);
    });

    it("drops nulls from collect, and counts only non-null values", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) RETURN count(*) AS rows, count(p.age) AS ages, " +
          "collect(p.age) AS all_ages",
      );
      const row = (body.results as Row[])[0]!;
      expect(row.rows).toBe(3);
      expect(row.ages).toBe(2);
      expect([...(row.all_ages as number[])].sort()).toEqual([30, 40]);
    });

    it("groups implicitly by every non-aggregate item", async () => {
      await seedGraph();
      const body = await query(
        "test_ontology",
        "MATCH (p:person)-[:works_for]->(c:company) " +
          "RETURN c.name AS company, collect(p.name) AS staff ORDER BY c.name",
      );
      const rows = body.results as Row[];
      expect(rows.map((row) => row.company)).toEqual(["Acme", "Globex"]);
      expect([...(rows[0]!.staff as string[])].sort()).toEqual(["Alice", "Bob"]);
    });
  });

  describe("null semantics", () => {
    it("treats a comparison with a missing property as not-true", async () => {
      await seedAges();
      const above = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.age > 10 RETURN p.name AS name ORDER BY p.name",
      );
      expect(above.results).toEqual([{ name: "Alice" }, { name: "Bob" }]);

      const negated = await query(
        "test_ontology",
        "MATCH (p:person) WHERE NOT p.age > 100 RETURN p.name AS name ORDER BY p.name",
      );
      expect(negated.results).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    });

    it("tests presence with IS NULL and IS NOT NULL", async () => {
      await seedAges();
      const missing = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.age IS NULL RETURN p.name AS name",
      );
      expect(missing.results).toEqual([{ name: "Dana" }]);
    });

    it("answers IN over a list carrying a null exactly as Cypher does", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.age IN [30, null] RETURN p.name AS name",
      );
      expect(body.results).toEqual([{ name: "Alice" }]);
    });

    it("answers CONTAINS with a missing operand as not-true", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.email CONTAINS 'a' RETURN p.name AS name",
      );
      expect(body.results).toEqual([]);
    });

    it("sorts nulls last ascending and first descending", async () => {
      await seedAges();
      const ascending = await query(
        "test_ontology",
        "MATCH (p:person) RETURN p.name AS name ORDER BY p.age",
      );
      expect((ascending.results as Row[]).map((row) => row.name)).toEqual([
        "Alice",
        "Bob",
        "Dana",
      ]);
      const descending = await query(
        "test_ontology",
        "MATCH (p:person) RETURN p.name AS name ORDER BY p.age DESC",
      );
      expect((descending.results as Row[]).map((row) => row.name)).toEqual([
        "Dana",
        "Bob",
        "Alice",
      ]);
    });
  });

  describe("lists and strings", () => {
    it("compares lists structurally", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WHERE [p.name, p.age] = ['Alice', 30] RETURN p.name AS name",
      );
      expect(body.results).toEqual([{ name: "Alice" }]);
    });

    it("returns list and map literals as values", async () => {
      await seedAges();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.name = 'Alice' RETURN [p.name, 'x'] AS xs, {who: p.name} AS m",
      );
      expect(body.results).toEqual([{ xs: ["Alice", "x"], m: { who: "Alice" } }]);
    });

    it("matches CONTAINS case-sensitively — unlike the list filter", async () => {
      await seedAges();
      // The two substring surfaces deliberately differ; both are pinned
      // so neither is ever "fixed" to match the other.
      const oql = await query(
        "test_ontology",
        "MATCH (p:person) WHERE p.name CONTAINS 'ali' RETURN p.name AS name",
      );
      expect(oql.results).toEqual([]);

      const filtered = await app.inject({
        method: "GET",
        url: "/api/runtime/test_ontology/entities/person?filter.name__contains=ali",
      });
      expect(filtered.json().total).toBe(1);
    });
  });

  describe("patterns", () => {
    async function addKnows(): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/api/model/relation-types",
        payload: {
          key: "knows",
          displayName: "Knows",
          sourceEntityTypeKey: "person",
          targetEntityTypeKey: "person",
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      invalidateLoadedSchemaCache();
    }

    it("binds an undirected edge twice, and a self-loop once", async () => {
      await addKnows();
      const alice = await createEntity("test_ontology", "person", { name: "Alice" });
      const bob = await createEntity("test_ontology", "person", { name: "Bob" });
      await createRelation("test_ontology", "knows", {
        fromEntityId: alice._id,
        toEntityId: bob._id,
      });
      await createRelation("test_ontology", "knows", {
        fromEntityId: alice._id,
        toEntityId: alice._id,
      });

      const body = await query(
        "test_ontology",
        "MATCH (a:person)-[r:knows]-(b:person) RETURN a.name AS an, b.name AS bn " +
          "ORDER BY a.name, b.name",
      );
      expect(body.results).toEqual([
        { an: "Alice", bn: "Alice" },
        { an: "Alice", bn: "Bob" },
        { an: "Bob", bn: "Alice" },
      ]);
    });

    it("matches inline property maps on both nodes and relationships", async () => {
      await seedGraph();
      const body = await query(
        "test_ontology",
        "MATCH (p:person)-[:works_for {role: 'Manager'}]->(c:company {name: 'Acme'}) " +
          "RETURN p.name AS name",
      );
      expect(body.results).toEqual([{ name: "Bob" }]);
    });
  });

  describe("the pipeline", () => {
    it("keeps a WITH's ordering all the way out", async () => {
      await seedGraph();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) WITH p ORDER BY p.age DESC LIMIT 2 RETURN p.name AS name",
      );
      expect(body.results).toEqual([{ name: "Bob" }, { name: "Alice" }]);
    });

    it("aggregates the rows a WITH ordered", async () => {
      await seedGraph();
      // The order *inside* a collected list is deliberately not asserted:
      // aggregation collapses the rows the sort key belonged to, and SQL
      // promises a subquery's ORDER BY only for the LIMIT it feeds.
      const collected = await query(
        "test_ontology",
        "MATCH (p:person) WITH p ORDER BY p.age DESC LIMIT 2 RETURN collect(p.name) AS top",
      );
      const top = (collected.results as Row[])[0]!.top as string[];
      expect([...top].sort()).toEqual(["Alice", "Bob"]);

      const counted = await query(
        "test_ontology",
        "MATCH (p:person) WITH p ORDER BY p.age RETURN count(*) AS n",
      );
      expect(counted.results).toEqual([{ n: 3 }]);

      const grouped = await query(
        "test_ontology",
        "MATCH (p:person)-[:works_for]->(c:company) WITH p, c ORDER BY p.age " +
          "RETURN c.name AS company, count(*) AS n",
      );
      const rows = [...(grouped.results as Row[])].sort((l, r) =>
        String(l.company).localeCompare(String(r.company)),
      );
      expect(rows).toEqual([
        { company: "Acme", n: 2 },
        { company: "Globex", n: 1 },
      ]);
    });

    it("expands RETURN * to every variable in scope, in one fixed order", async () => {
      await seedGraph();
      const body = await query(
        "test_ontology",
        "MATCH (zebra:person)-[rel:works_for]->(apple:company) WHERE zebra.name = 'Alice' " +
          "RETURN *",
      );
      expect(body.columns).toEqual(["apple", "rel", "zebra"]);
      const row = (body.results as Row[])[0]!;
      expect((row.apple as Row).name).toBe("Acme");
      expect((row.rel as Row).role).toBe("Engineer");
      expect((row.zebra as Row).name).toBe("Alice");
    });

    it("carries every variable through WITH *", async () => {
      await seedGraph();
      const body = await query(
        "test_ontology",
        "MATCH (p:person)-[r:works_for]->(c:company) WITH * " +
          "RETURN p.name AS name, c.name AS company ORDER BY p.name",
      );
      expect(body.results).toEqual([
        { name: "Alice", company: "Acme" },
        { name: "Bob", company: "Acme" },
        { name: "Carol", company: "Globex" },
      ]);
    });

    it("sorts on an output alias of the same projection", async () => {
      await seedGraph();
      const body = await query(
        "test_ontology",
        "MATCH (p:person) RETURN p.name AS name ORDER BY name DESC",
      );
      expect(body.results).toEqual([{ name: "Carol" }, { name: "Bob" }, { name: "Alice" }]);
    });

    it("rejects a SKIP/LIMIT operand that is not a count", async () => {
      const body = await query(
        "test_ontology",
        "MATCH (p:person) RETURN p.name LIMIT -1",
        422,
      );
      const errors = ((body.error as Row).details as Row).errors as string[];
      expect(errors).toContain("SKIP/LIMIT take a non-negative integer or a $parameter.");
    });
  });
});

describe("scoped lens", () => {
  it("strips out-of-scope properties per column", async () => {
    await seedGraph();
    const body = await query(
      "hr_view",
      "MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, r, c",
    );
    const row = (body.results as Row[])[0]!;
    const p = row.p as Row;
    expect(p.name).toBe("Alice");
    expect(p).not.toHaveProperty("age"); // hidden by the lens
    expect(p).not.toHaveProperty("active"); // default applied at create, hidden here
    expect(p._entityTypeKey).toBe("person"); // system properties survive
    const c = row.c as Row;
    expect(c.name).toBe("Acme");
    const r = row.r as Row;
    expect(r.role).toBe("Engineer");
  });

  it("rejects an out-of-scope property in the query text", async () => {
    const body = await query(
      "hr_view",
      "MATCH (p:person) WHERE p.age > 20 RETURN p",
      422,
    );
    const errors = (body.error as Row).details as Row;
    expect((errors.errors as string[]).some((e) => e.includes("Unknown property 'age'"))).toBe(
      true,
    );
  });

  it("rejects an out-of-lens inline-map key", async () => {
    const body = await query(
      "hr_view",
      "MATCH (p:person {age: 30}) RETURN p",
      422,
    );
    const errors = ((body.error as Row).details as Row).errors as string[];
    expect(
      errors.some((e) => e.includes("Unknown property 'age' on entity type 'person'")),
    ).toBe(true);
  });

  it("rejects a globally valid type identically to a nonexistent one", async () => {
    // `project` exists in the global schema but not in hr_view.
    const res = await app.inject({
      method: "POST",
      url: "/api/model/entity-types",
      payload: { key: "project", displayName: "Project" },
    });
    expect(res.statusCode, res.body).toBe(201);
    invalidateLoadedSchemaCache();

    const hidden = await query("hr_view", "MATCH (x:project) RETURN x", 422);
    const ghost = await query("hr_view", "MATCH (x:ghost) RETURN x", 422);

    const hiddenErrors = ((hidden.error as Row).details as Row).errors as string[];
    const ghostErrors = ((ghost.error as Row).details as Row).errors as string[];
    expect(hiddenErrors).toEqual(["Unknown entity type: 'project'. Available: company, person"]);
    expect(ghostErrors).toEqual(["Unknown entity type: 'ghost'. Available: company, person"]);
    // Same check, same wording — only the offending name differs.
    expect(hiddenErrors[0]!.replace("'project'", "'ghost'")).toBe(ghostErrors[0]);
  });
});

describe("document properties in results", () => {
  const BIO = "# Biography\n\nAda Lovelace wrote the first program. ".repeat(12);

  async function addBioProperty(): Promise<void> {
    const list = await app.inject({ method: "GET", url: "/api/model/entity-types" });
    const person = (list.json() as Row[]).find((et) => et.key === "person")!;
    const res = await app.inject({
      method: "POST",
      url: `/api/model/entity-types/${person.entityTypeId}/properties`,
      payload: { key: "bio", displayName: "Bio", dataType: "document", required: false },
    });
    expect(res.statusCode, res.body).toBe(201);
    invalidateLoadedSchemaCache();
  }

  it("stubs documents in whole nodes and scalar projections; alias returns full text", async () => {
    await addBioProperty();
    await createEntity("test_ontology", "person", { name: "Ada", bio: BIO });

    // Whole node — stubbed.
    const whole = await query("test_ontology", "MATCH (p:person) RETURN p");
    const p = (whole.results as Row[])[0]!.p as Row;
    expect(p.bio).toEqual({ document: true, length: BIO.length });
    expect(p).not.toHaveProperty("_doc_bio_length");

    // Scalar `variable.property` projection — stubbed by column-name form.
    const scalar = await query("test_ontology", "MATCH (p:person) RETURN p.bio, p.name");
    const scalarRow = (scalar.results as Row[])[0]!;
    expect(scalarRow["p.bio"]).toEqual({ document: true, length: BIO.length });
    expect(scalarRow["p.name"]).toBe("Ada");

    // Aliased projection — the documented exception: full text.
    const aliased = await query(
      "test_ontology",
      "MATCH (p:person) RETURN p.bio AS biography",
    );
    expect((aliased.results as Row[])[0]!.biography).toBe(BIO);
  });

  it("a predicate may test a document property even though its value is stubbed", async () => {
    await addBioProperty();
    await createEntity("test_ontology", "person", { name: "Ada", bio: BIO });
    await createEntity("test_ontology", "person", { name: "Bob" });

    const body = await query(
      "test_ontology",
      "MATCH (p:person) WHERE p.bio IS NOT NULL RETURN p.name AS name",
    );
    expect(body.results).toEqual([{ name: "Ada" }]);
  });

  it("rejects the internal chunk vocabulary with dedicated messages", async () => {
    const chunk = await query("test_ontology", "MATCH (c:_Chunk) RETURN c", 422);
    const errors = ((chunk.error as Row).details as Row).errors as string[];
    expect(errors.some((e) => e.includes("Internal label '_Chunk'"))).toBe(true);
  });
});

describe("MCP execute_query", () => {
  async function connectClient(url: string): Promise<Client> {
    const client = new Client({ name: "oql-tests", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
  }

  interface ToolCallResult {
    content: { type: string; text: string }[];
    isError?: boolean;
  }

  it("round-trips a query through the runtime MCP server", async () => {
    await seedGraph();
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const result = (await client.callTool({
        name: "execute_query",
        arguments: {
          query:
            "MATCH (p:person)-[r:works_for]->(c:company) WHERE c.name = 'Acme' " +
            "RETURN p.name AS name ORDER BY p.name",
        },
      })) as unknown as ToolCallResult;
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0]!.text) as Row;
      expect(body.columns).toEqual(["name"]);
      expect(body.results).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    } finally {
      await client.close();
    }
  });

  it("reports a validation failure carrying the self-correction hints", async () => {
    const client = await connectClient(`${baseUrl}/mcp/runtime/test_ontology`);
    try {
      const result = (await client.callTool({
        name: "execute_query",
        arguments: { query: "MATCH (n:animal) RETURN n" },
      })) as unknown as ToolCallResult;
      expect(result.isError).toBe(true);
      const message = result.content[0]!.text;
      expect(message).toContain("Query validation failed");
      expect(message).toContain("Unknown entity type: 'animal'");
      expect(message).toContain("company");
      expect(message).toContain("person");
    } finally {
      await client.close();
    }
  });
});
