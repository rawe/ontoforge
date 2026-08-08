/**
 * Runtime saved-query execution, listing, and search at the service level
 * over a mocked store, including: exact-match and coercion failures collected,
 * binding resolution rules (flat row-order list, skipped rows, empty list
 * flows on), binding-wins-collision, textual substitution with unmatched
 * `$name` left verbatim, `_score` as a binding field, and the
 * no-provider failure of a pipeline containing a search step.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import { NotFoundError, ValidationError } from "../../src/core/exceptions.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  executeSavedQuery,
  listSavedQueries,
  resolveBindings,
  searchSavedQueries,
  substituteParams,
} from "../../src/runtime/service.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, unknown>;

let store: MockRuntimeStore;

/** Store a saved query as the adapter would return it: steps and
 * parameters as serialized text the store does not interpret. */
function stubSavedQueries(rows: Row[]): void {
  store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
  store.getSavedQueries.mockResolvedValue(
    rows.map((row) => ({
      ...row,
      steps: JSON.stringify(row.steps),
      parameters: JSON.stringify(row.parameters),
    })),
  );
}

const FIND_PEOPLE_QUERY: Row = {
  key: "find-people",
  name: "Find People",
  description: "Find people by name",
  steps: [
    { name: "main", type: "oql", oql: "MATCH (p:person) WHERE p.name CONTAINS $name RETURN p" },
  ],
  parameters: [{ name: "name", description: "Name to search", dataType: "string" }],
};

beforeEach(() => {
  store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  setEmbeddingProvider(null);
});

// ---------------------------------------------------------------------------
// Binding resolution
// ---------------------------------------------------------------------------

describe("resolveBindings", () => {
  it("collects the field from every row, in row order, into a flat list", () => {
    const stepResults = {
      skills: [
        { _id: "id-1", name: "Python" },
        { _id: "id-2", name: "Go" },
      ],
    };
    expect(resolveBindings({ skill_ids: "{{skills._id}}" }, stepResults)).toEqual({
      skill_ids: ["id-1", "id-2"],
    });
  });

  it("an empty producing step resolves to an empty list — not an error", () => {
    expect(resolveBindings({ skill_ids: "{{skills._id}}" }, { skills: [] })).toEqual({
      skill_ids: [],
    });
  });

  it("rows lacking the bound field are skipped", () => {
    const stepResults = {
      skills: [{ _id: "id-1", name: "Python" }, { name: "Go" }],
    };
    expect(resolveBindings({ skill_ids: "{{skills._id}}" }, stepResults)).toEqual({
      skill_ids: ["id-1"],
    });
  });

  it("an invalid expression raises", () => {
    expect(() => resolveBindings({ ids: "invalid_expr" }, { skills: [{ _id: "id-1" }] })).toThrow(
      /Invalid binding expression/,
    );
  });
});

// ---------------------------------------------------------------------------
// Textual substitution
// ---------------------------------------------------------------------------

describe("substituteParams", () => {
  it("replaces $name with the string form of the value", () => {
    expect(substituteParams("find $topic experts", { topic: "graph databases" })).toBe(
      "find graph databases experts",
    );
  });

  it("leaves an unmatched $name in the text verbatim", () => {
    expect(substituteParams("find $topic and $other", { topic: "x" })).toBe("find x and $other");
  });

  it("stringifies booleans in the same spelling the write path stores", () => {
    expect(substituteParams("active: $flag", { flag: true })).toBe("active: true");
  });
});

// ---------------------------------------------------------------------------
// Execution: parameter validation
// ---------------------------------------------------------------------------

describe("executeSavedQuery parameter validation", () => {
  it("an unknown query key is not found", async () => {
    stubSavedQueries([]);
    await expect(
      executeSavedQuery("full_ontology", "nonexistent", {}, asRuntimeStore(store)),
    ).rejects.toThrow(/Saved query 'nonexistent' not found/);
  });

  it("a missing parameter is rejected", async () => {
    stubSavedQueries([FIND_PEOPLE_QUERY]);
    await expect(
      executeSavedQuery("full_ontology", "find-people", {}, asRuntimeStore(store)),
    ).rejects.toThrow(/Missing required parameters/);
  });

  it("an unrecognized parameter is rejected — no optionals, no defaults", async () => {
    stubSavedQueries([FIND_PEOPLE_QUERY]);
    await expect(
      executeSavedQuery(
        "full_ontology",
        "find-people",
        { name: "Alice", extra: "bad" },
        asRuntimeStore(store),
      ),
    ).rejects.toThrow(/Unknown parameters/);
  });

  it("missing and unrecognized parameters are collected together", async () => {
    stubSavedQueries([FIND_PEOPLE_QUERY]);
    let caught: ValidationError | null = null;
    try {
      await executeSavedQuery(
        "full_ontology",
        "find-people",
        { wrong: "x" },
        asRuntimeStore(store),
      );
    } catch (exc) {
      caught = exc as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught!.details).toEqual({
      errors: ["Missing required parameters: ['name']", "Unknown parameters: ['wrong']"],
    });
  });

  it("coercion failures are collected per parameter", async () => {
    stubSavedQueries([
      {
        key: "typed",
        name: "Typed",
        description: "typed params",
        steps: [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.age > $min_age AND p.active = $active RETURN p",
          },
        ],
        parameters: [
          { name: "min_age", description: "min age", dataType: "integer" },
          { name: "active", description: "active flag", dataType: "boolean" },
        ],
      },
    ]);
    let caught: ValidationError | null = null;
    try {
      await executeSavedQuery(
        "full_ontology",
        "typed",
        { min_age: "not-a-number", active: "not-a-bool" },
        asRuntimeStore(store),
      );
    } catch (exc) {
      caught = exc as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught!.message).toBe("Parameter type coercion failed");
    const fields = (caught!.details as { fields: Record<string, string> }).fields;
    expect(Object.keys(fields).sort()).toEqual(["active", "min_age"]);
  });
});

// ---------------------------------------------------------------------------
// Execution: steps and bindings
// ---------------------------------------------------------------------------

describe("executeSavedQuery pipelines", () => {
  it("an oql step receives every coerced parameter as bound query parameters", async () => {
    stubSavedQueries([FIND_PEOPLE_QUERY]);
    store.executeOql.mockResolvedValue([["p"], [{ p: { _id: "e1", name: "Alice" } }]]);

    const result = await executeSavedQuery(
      "full_ontology",
      "find-people",
      { name: "Alice" },
      asRuntimeStore(store),
    );

    expect(store.executeOql).toHaveBeenCalledTimes(1);
    expect(store.executeOql.mock.calls[0]![1]).toEqual({ name: "Alice" });
    expect(result.columns).toEqual(["p"]);
    expect(result.results).toHaveLength(1);
  });

  it("oql -> oql: the binding resolves to the earlier step's rows in row order", async () => {
    stubSavedQueries([
      {
        key: "two-step",
        name: "Two Step",
        description: "oql feeding oql",
        steps: [
          { name: "first", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" },
          {
            name: "second",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.name IN $names RETURN p",
            bindings: { names: "{{first.name}}" },
          },
        ],
        parameters: [],
      },
    ]);
    store.executeOql
      .mockResolvedValueOnce([["name"], [{ name: "Alice" }, { name: "Bob" }]])
      .mockResolvedValueOnce([["p"], [{ p: { _id: "e1", name: "Alice" } }]]);

    const result = await executeSavedQuery(
      "full_ontology",
      "two-step",
      {},
      asRuntimeStore(store),
    );

    expect(store.executeOql).toHaveBeenCalledTimes(2);
    expect(store.executeOql.mock.calls[1]![1]).toEqual({ names: ["Alice", "Bob"] });
    // Only the LAST step's output is returned.
    expect(result.columns).toEqual(["p"]);
  });

  it("the binding wins where its name collides with a parameter", async () => {
    stubSavedQueries([
      {
        key: "collision",
        name: "Collision",
        description: "binding shadows the parameter for that step",
        steps: [
          {
            name: "first",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.name CONTAINS $names RETURN p.name AS name",
          },
          {
            name: "second",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.name IN $names RETURN p",
            bindings: { names: "{{first.name}}" },
          },
        ],
        // `$names` in step one is caller-supplied; the same name in step
        // two is binding-supplied and the binding wins there.
        parameters: [{ name: "names", description: "seed", dataType: "string" }],
      },
    ]);
    store.executeOql
      .mockResolvedValueOnce([["name"], [{ name: "Alice" }]])
      .mockResolvedValueOnce([["p"], []]);

    await executeSavedQuery(
      "full_ontology",
      "collision",
      { names: "Ali" },
      asRuntimeStore(store),
    );

    expect(store.executeOql.mock.calls[0]![1]).toEqual({ names: "Ali" });
    expect(store.executeOql.mock.calls[1]![1]).toEqual({ names: ["Alice"] });
  });

  it("an empty binding list flows into the next step — no error", async () => {
    stubSavedQueries([
      {
        key: "empty-flow",
        name: "Empty Flow",
        description: "empty intermediate output",
        steps: [
          { name: "first", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" },
          {
            name: "second",
            type: "oql",
            oql: "MATCH (p:person) WHERE p.name IN $names RETURN p",
            bindings: { names: "{{first.name}}" },
          },
        ],
        parameters: [],
      },
    ]);
    store.executeOql
      .mockResolvedValueOnce([["name"], []])
      .mockResolvedValueOnce([["p"], []]);

    const result = await executeSavedQuery(
      "full_ontology",
      "empty-flow",
      {},
      asRuntimeStore(store),
    );

    expect(store.executeOql.mock.calls[1]![1]).toEqual({ names: [] });
    expect(result.results).toEqual([]);
  });

  it("search -> oql: textual substitution reaches the search, _score is a binding field", async () => {
    setEmbeddingProvider({ dimensions: 3, embed: vi.fn(async () => [0.1, 0.2, 0.3]) });
    stubSavedQueries([
      {
        key: "skilled-persons",
        name: "Skilled Persons",
        description: "Find persons by skill",
        steps: [
          {
            name: "skills",
            type: "semantic_search",
            entityTypeKey: "person",
            query: "$skill_query",
            limit: 5,
          },
          {
            name: "persons",
            type: "oql",
            oql: "MATCH (p:person) WHERE p._id IN $skill_ids OR p.name IN $scores RETURN p",
            bindings: { skill_ids: "{{skills._id}}", scores: "{{skills._score}}" },
          },
        ],
        parameters: [
          { name: "skill_query", description: "Skill to search for", dataType: "string" },
        ],
      },
    ]);
    store.semanticSearch.mockResolvedValue([
      { entity: { _id: "skill-1", name: "Python" }, score: 0.95 },
      { entity: { _id: "skill-2", name: "ML" }, score: 0.85 },
    ]);
    store.executeOql.mockResolvedValue([["p"], [{ p: { _id: "person-1", name: "Alice" } }]]);

    const result = await executeSavedQuery(
      "full_ontology",
      "skilled-persons",
      { skill_query: "machine learning" },
      asRuntimeStore(store),
    );

    // The store-level search ran against the named type with the
    // substituted text's embedding.
    expect(store.semanticSearch).toHaveBeenCalledTimes(1);
    expect(store.semanticSearch.mock.calls[0]![0]).toBe("person");

    // The oql step got the flat _id list plus the _score binding field.
    const params = store.executeOql.mock.calls[0]![1] as Row;
    expect(params.skill_ids).toEqual(["skill-1", "skill-2"]);
    expect((params.scores as number[]).length).toBe(2);
    expect(params.skill_query).toBe("machine learning");

    // The last step's output is the response.
    expect(result.columns).toEqual(["p"]);
  });

  it("bindings on a semantic_search step are ignored — only parameters reach the text", async () => {
    const embed = vi.fn(async () => [0.1, 0.2, 0.3]);
    setEmbeddingProvider({ dimensions: 3, embed });
    stubSavedQueries([
      {
        key: "ignored-binding",
        name: "Ignored Binding",
        description: "search step ignores its bindings",
        steps: [
          { name: "first", type: "oql", oql: "MATCH (p:person) RETURN p.name AS name" },
          {
            name: "second",
            type: "semantic_search",
            entityTypeKey: "person",
            query: "people like $q and $name",
            bindings: { name: "{{first.name}}" },
          },
        ],
        parameters: [{ name: "q", description: "who", dataType: "string" }],
      },
    ]);
    store.executeOql.mockResolvedValue([["name"], [{ name: "Alice" }]]);
    store.semanticSearch.mockResolvedValue([]);

    await executeSavedQuery(
      "full_ontology",
      "ignored-binding",
      { q: "engineers" },
      asRuntimeStore(store),
    );

    // `$q` was substituted; `$name` (binding-supplied) stayed verbatim.
    expect(embed).toHaveBeenCalledWith("people like engineers and $name");
  });

  it("a pipeline containing a semantic_search step fails without a provider", async () => {
    stubSavedQueries([
      {
        key: "needs-provider",
        name: "Needs Provider",
        description: "search then oql",
        steps: [
          { name: "skills", type: "semantic_search", entityTypeKey: "person", query: "x" },
          {
            name: "persons",
            type: "oql",
            oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
            bindings: { ids: "{{skills._id}}" },
          },
        ],
        parameters: [],
      },
    ]);
    let caught: ValidationError | null = null;
    try {
      await executeSavedQuery("full_ontology", "needs-provider", {}, asRuntimeStore(store));
    } catch (exc) {
      caught = exc as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught!.details).toEqual({ code: "FEATURE_DISABLED" });
  });

  it("a schema change surfaces at the next run — nothing invalidates stored pipelines", async () => {
    // The stored pipeline names a type the lens no longer exposes; the
    // run-time OQL validation rejects it.
    stubSavedQueries([
      {
        key: "stale",
        name: "Stale",
        description: "names a vanished type",
        steps: [{ name: "main", type: "oql", oql: "MATCH (x:vanished_type) RETURN x" }],
        parameters: [],
      },
    ]);
    await expect(
      executeSavedQuery("full_ontology", "stale", {}, asRuntimeStore(store)),
    ).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Listing (served from the schema cache)
// ---------------------------------------------------------------------------

describe("listSavedQueries", () => {
  it("returns key, name, description, steps and parameters — absent step fields omitted", async () => {
    stubSavedQueries([
      {
        key: "find-people",
        name: "Find People",
        description: "Find people by name",
        steps: [
          {
            name: "main",
            type: "oql",
            oql: "MATCH (p:person) RETURN p",
          },
        ],
        parameters: [{ name: "name", description: "Name to search", dataType: "string" }],
      },
    ]);

    const queries = await listSavedQueries("full_ontology", asRuntimeStore(store));
    expect(queries).toHaveLength(1);
    const q = queries[0]! as Row;
    expect(q.key).toBe("find-people");
    expect(q.name).toBe("Find People");
    expect(q.description).toBe("Find people by name");
    const steps = q.steps as Row[];
    expect(steps[0]).toEqual({ name: "main", type: "oql", oql: "MATCH (p:person) RETURN p" });
    const params = q.parameters as Row[];
    expect(params[0]).toEqual({
      name: "name",
      description: "Name to search",
      dataType: "string",
    });
  });

  it("is served from the cache until a modeling mutation invalidates it", async () => {
    stubSavedQueries([FIND_PEOPLE_QUERY]);
    const first = await listSavedQueries("full_ontology", asRuntimeStore(store));
    expect(first).toHaveLength(1);

    // The store changes; the cached lens does not.
    store.getSavedQueries.mockResolvedValue([]);
    const cached = await listSavedQueries("full_ontology", asRuntimeStore(store));
    expect(cached).toHaveLength(1);

    // Invalidation (every modeling mutation) makes the change visible.
    invalidateLoadedSchemaCache();
    const fresh = await listSavedQueries("full_ontology", asRuntimeStore(store));
    expect(fresh).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Search (descriptions only)
// ---------------------------------------------------------------------------

describe("searchSavedQueries", () => {
  it("is rejected as FEATURE_DISABLED without a provider", async () => {
    let caught: ValidationError | null = null;
    try {
      await searchSavedQueries("full_ontology", "find people", 3, 0.7, asRuntimeStore(store));
    } catch (exc) {
      caught = exc as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught!.details).toEqual({ code: "FEATURE_DISABLED" });
  });

  it("returns key/name/description/parameters/score — never steps", async () => {
    setEmbeddingProvider({ dimensions: 3, embed: vi.fn(async () => [0.1, 0.2, 0.3]) });
    store.searchSavedQueries = vi.fn(async () => [
      {
        key: "find-people",
        name: "Find People",
        description: "Find people by name",
        parameters: '[{"name": "name", "description": "Name", "dataType": "string"}]',
        score: 0.91,
      },
    ]);

    const results = await searchSavedQueries(
      "full_ontology",
      "who works here",
      3,
      0.7,
      asRuntimeStore(store),
    );

    expect(results).toHaveLength(1);
    const hit = results[0]! as Row;
    expect(hit.key).toBe("find-people");
    expect(hit.score).toBe(0.91);
    expect(hit.parameters).toEqual([{ name: "name", description: "Name", dataType: "string" }]);
    expect(hit).not.toHaveProperty("steps");
  });
});
