/**
 * Named-search modeling endpoints over mocked stores: list, upsert and
 * delete by key; the stored tree's shape, a field a node does not define
 * refused at its path; the rules that need no lens (a cut above every
 * search node, `$query` in a text); and the lens check — R1–R8 and the
 * stored filters' conditions, each at its path — run, or skipped when the
 * lens's schema cannot be loaded. Every violation is reported together.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setEmbeddingProvider } from "../../src/core/embedding.js";
import type { SearchIndexRecord } from "../../src/core/ports.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeUnscopedSchema, type MockRuntimeStore } from "../runtime/helpers.js";
import { createMockModelingStore, NOW, type MockModelingStore } from "./helpers.js";

type Row = Record<string, unknown>;

const holder: { store: MockModelingStore; runtimeStore: MockRuntimeStore } = {
  store: createMockModelingStore(),
  runtimeStore: createMockRuntimeStore(),
};

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => holder.store,
  getSearchIndexStore: async () => holder.store.searchIndices(),
  getRuntimeStore: async () => holder.runtimeStore,
}));

const MOCK_LENS = { lensId: "lens-1", key: "full_lens", name: "Full", description: null, createdAt: NOW, updatedAt: NOW };

/** A keyword search of one index, grouped by entity. */
const grouped = (index: string, text: string) => ({
  kind: "group",
  key: "entity",
  input: { kind: "keywordSearch", index, text },
});

/** The simplest valid tree: a cut over one grouped keyword search. */
const TREE = { kind: "cut", limit: 10, input: grouped("person~default", "$query") };

const STORED = {
  namedSearchId: "ns-1",
  key: "people",
  name: "People",
  description: "Find people",
  tree: TREE,
  createdAt: NOW,
  updatedAt: NOW,
};

/** An index record the lens can search: its key and root type are what
 * the check reads. */
const index = (key: string, entityType: string) =>
  ({ key, kind: "default", definition: { key, entityType } }) as unknown as SearchIndexRecord;

let app: FastifyInstance;

beforeAll(async () => {
  const { createApp } = await import("../../src/app.js");
  app = await createApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  holder.store = createMockModelingStore();
  holder.store.getLensByKey.mockResolvedValue(MOCK_LENS);
  // The default runtime store has no schema: the lens check is SKIPPED.
  holder.runtimeStore = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
  setEmbeddingProvider(null);
});

/** Let the lens check run against the unscoped fixture, its indices
 * `person~default` and `company~default`. */
function withLens(): void {
  holder.runtimeStore.getFullSchemaWithLensInclusions.mockResolvedValue(makeUnscopedSchema());
  holder.runtimeStore.indices.listIndices.mockResolvedValue([
    index("person~default", "person"),
    index("company~default", "company"),
  ]);
}

async function put(key: string, tree: unknown, extra: Row = {}) {
  return app.inject({
    method: "PUT",
    url: `/api/ontologies/onto/model/lenses/full_lens/named-searches/${key}`,
    payload: { name: "People", description: "Find people", tree, ...extra },
  });
}

const errorsOf = (res: { json: () => Row }) =>
  ((res.json().error as Row).details as { errors: unknown[] }).errors;

describe("list", () => {
  it("answers the lens's named searches with their stored trees", async () => {
    holder.store.listNamedSearches.mockResolvedValue([STORED]);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses/full_lens/named-searches" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        key: "people",
        name: "People",
        description: "Find people",
        tree: TREE,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ]);
    expect(holder.store.listNamedSearches).toHaveBeenCalledWith("lens-1");
  });

  it("an unknown lens key answers 404", async () => {
    holder.store.getLensByKey.mockResolvedValue(null);
    const res = await app.inject({ method: "GET", url: "/api/ontologies/onto/model/lenses/nope/named-searches" });
    expect(res.statusCode).toBe(404);
  });
});

describe("upsert", () => {
  it("create answers 201 and stores the tree as JSON", async () => {
    holder.store.upsertNamedSearch.mockResolvedValue([STORED, true]);
    const res = await put("people", TREE);
    expect(res.statusCode, res.body).toBe(201);
    const [lensId, , key, name, description, treeJson] = holder.store.upsertNamedSearch.mock.calls[0]!;
    expect([lensId, key, name, description]).toEqual(["lens-1", "people", "People", "Find people"]);
    expect(JSON.parse(treeJson as string)).toEqual(TREE);
  });

  it("replace answers 200", async () => {
    holder.store.upsertNamedSearch.mockResolvedValue([STORED, false]);
    expect((await put("people", TREE)).statusCode).toBe(200);
  });

  it("a key violating the lens-resource key rule is rejected 422", async () => {
    const res = await put("People!", TREE);
    expect(res.statusCode).toBe(422);
    expect(holder.store.upsertNamedSearch).not.toHaveBeenCalled();
  });

  it("a key longer than 64 characters is rejected 422 naming the cap", async () => {
    const res = await put("a".repeat(65), TREE);
    expect(res.statusCode).toBe(422);
    expect((res.json().error as Row).message).toContain("64");
  });

  it("a node of a kind the stored tree does not have, and a field a node does not define, are refused at their paths", async () => {
    const res = await put("bad", {
      kind: "cut",
      limit: 10,
      input: {
        kind: "fuse",
        inputs: [
          { kind: "append", input: null, filters: [], until: 3 },
          { kind: "group", key: "entity", input: { kind: "keywordSearch", index: "x", text: "$query", subQuery: 1 } },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/tree/input/inputs/0/kind" }),
        { path: "/tree/input/inputs/1/input/subQuery", message: "Unknown field of a keywordSearch node: 'subQuery'" },
      ]),
    );
  });

  it("a filter carries no fixed ids", async () => {
    const res = await put("ids", {
      kind: "cut",
      limit: 10,
      input: {
        kind: "restrict",
        input: grouped("person~default", "$query"),
        filters: [{ kind: "filter", entityType: "person", conditions: {}, ids: ["p-1"] }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([
      { path: "/tree/input/filters/0/ids", message: "Unknown field of a filter node: 'ids'" },
    ]);
  });

  it("a cut's limit is an integer from 1 to 100", async () => {
    const res = await put("limit", { ...TREE, limit: 101 });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([expect.objectContaining({ path: "/tree/limit" })]);
  });

  it("needs a cut above every search node and $query in a text, without the lens", async () => {
    const res = await put("no-cut", {
      kind: "fuse",
      inputs: [grouped("person~default", "people"), { kind: "cut", limit: 5, input: grouped("person~default", "staff") }],
    });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([
      "tree.inputs.0.input: A search node needs a cut above it: its limit sets how deep it reads",
      "tree: At least one search node's text holds $query, where the runtime query goes",
    ]);
    expect(holder.store.upsertNamedSearch).not.toHaveBeenCalled();
  });

  it("the lens check is skipped when the lens's schema cannot be loaded", async () => {
    holder.store.upsertNamedSearch.mockResolvedValue([STORED, true]);
    const res = await put("unchecked", { kind: "cut", limit: 10, input: grouped("spaceship~default", "$query") });
    expect(res.statusCode).toBe(201);
  });
});

describe("the lens check", () => {
  it("accepts a tree the lens can run", async () => {
    withLens();
    holder.store.upsertNamedSearch.mockResolvedValue([STORED, true]);
    const res = await put("people", {
      kind: "cut",
      limit: 10,
      input: {
        kind: "restrict",
        input: {
          kind: "fuse",
          inputs: [grouped("person~default", "$query"), grouped("company~default", "$query employer")],
        },
        filters: [{ kind: "filter", entityType: "person", conditions: { age__gte: "30" } }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it("names an index the lens cannot search and a type it does not show at their fields", async () => {
    withLens();
    const res = await put("hidden", {
      kind: "cut",
      limit: 10,
      input: {
        kind: "restrict",
        input: { kind: "fuse", inputs: [grouped("person~default", "$query"), grouped("spaceship~default", "$query")] },
        filters: [{ kind: "filter", entityType: "spaceship", conditions: { colour: "red" } }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([
      "tree.input.input.inputs.1.input.index: Search index 'spaceship~default' is not searchable in this lens",
      "tree.input.filters.0.entityType: Entity type 'spaceship' is not in this lens",
    ]);
  });

  it("resolves a filter's conditions against its type, a key it does not resolve at its path", async () => {
    withLens();
    const res = await put("filtered", {
      kind: "cut",
      limit: 10,
      input: {
        kind: "restrict",
        input: grouped("person~default", "$query"),
        filters: [{ kind: "filter", entityType: "person", conditions: { colour: "red", age__gte: "old" } }],
      },
    });
    expect(res.statusCode).toBe(422);
    const errors = errorsOf(res) as string[];
    expect(errors).toContain(
      "tree.input.filters.0.conditions.colour: Unknown filter property or relation type: 'colour'",
    );
    expect(errors.some((error) => error.startsWith("tree.input.filters.0.conditions.age__gte: "))).toBe(true);
  });

  it("reports the tree's rules at their nodes, with the rules that need no lens, together", async () => {
    withLens();
    const res = await put("rules", {
      kind: "fuse",
      inputs: [
        {
          kind: "cut",
          limit: 10,
          input: {
            kind: "merge",
            inputs: [
              { kind: "keywordSearch", index: "person~default", text: "$query" },
              { kind: "keywordSearch", index: "company~default", text: "staff" },
            ],
          },
        },
        { kind: "keywordSearch", index: "person~default", text: "$query" },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual([
      "tree.inputs.1: A search node needs a cut above it: its limit sets how deep it reads",
      expect.stringMatching(/^tree\.inputs\.0\.input: A merge combines rankings of one score kind/),
    ]);
  });

  it("refuses a cut's perEntity on a ranking of entities", async () => {
    withLens();
    const res = await put("per-entity", { ...TREE, perEntity: 2 });
    expect(res.statusCode).toBe(422);
    expect(errorsOf(res)).toEqual(["tree: perEntity cuts a ranking of passages"]);
  });
});

describe("delete", () => {
  it("answers 204", async () => {
    holder.store.deleteNamedSearch.mockResolvedValue(true);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/full_lens/named-searches/people",
    });
    expect(res.statusCode).toBe(204);
    expect(holder.store.deleteNamedSearch).toHaveBeenCalledWith("lens-1", "people");
  });

  it("an unknown key answers 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/onto/model/lenses/full_lens/named-searches/nope",
    });
    expect(res.statusCode).toBe(404);
  });
});
