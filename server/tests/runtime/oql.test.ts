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

/** Minimal scoped schema for testing (the Python `_schema()` fixture). */
function schema(): SchemaCacheValue {
  return {
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
        "ORDER BY, LIMIT, SKIP, OPTIONAL MATCH, WITH, UNWIND).",
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
// Rewriting
// ---------------------------------------------------------------------------

function compileText(query: string): string {
  const { tokenStream, tree } = parse(query);
  const validated: ValidatedQuery = { text: "", tokenStream, analysis: analyze(tree) };
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
      ontologyId: "t",
      ontologyKey: "t",
      ontologyName: "T",
      ontologyDescription: null,
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
    ontology: {
      ontologyId: "ont-1",
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
  getModelingStore: () => ({}),
  getRuntimeStore: () => holder.store,
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
      url: "/api/runtime/full_ontology/query",
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
      url: "/api/runtime/full_ontology/query",
      payload: { cypher: "MATCH (p:person) RETURN p" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("rejects write operations", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/full_ontology/query",
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
      url: "/api/runtime/full_ontology/query",
      payload: { query: "MATCH (n:animal) RETURN n" },
    });

    expect(res.statusCode).toBe(422);
  });

  it("scoped ontology strips out-of-scope properties from results", async () => {
    const { makeScopedSchema } = await import("./helpers.js");
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.executeOql.mockResolvedValue([
      ["p"],
      [{ p: makeEntity({ name: "Alice", age: 30, email: "a@b.com" }) }],
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/query",
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
      url: "/api/runtime/docs_view/query",
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
      url: "/api/runtime/docs_view/query",
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
      url: "/api/runtime/docs_view/query",
      payload: { query: "MATCH (p:person) RETURN p.bio AS biography" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().results[0].biography).toBe("x".repeat(500));
  });
});
