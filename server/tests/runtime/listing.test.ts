/**
 * Listing machinery: paging bounds (REST rejects out-of-range), sort
 * aliases, the free-text term, `filter.*` parameter parsing, projection,
 * and the `items/total/limit/offset` envelope — over a mocked store.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeEntity,
  makeScopedSchema,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

const holder: { store: MockRuntimeStore } = { store: createMockRuntimeStore() };

vi.mock("../../src/core/ports.js", () => ({
  getModelingStore: async () => ({}),
  getRuntimeStore: async () => holder.store,
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

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
});

describe("the list envelope", () => {
  it("carries items, total, limit and offset; total counts before paging", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.listEntities.mockResolvedValue([
      [makeEntity({ name: "Alice" }, "person", "ent-1")],
      42,
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?limit=1&offset=3",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(42);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(3);
    expect(body.items).toHaveLength(1);
  });

  it("scoped listing filters properties on every item", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.listEntities.mockResolvedValue([
      [
        makeEntity({ name: "Alice", age: 30, email: "a@b.com", active: true }, "person", "ent-1"),
        makeEntity({ name: "Bob", age: 25, email: "b@b.com", active: false }, "person", "ent-2"),
      ],
      2,
    ]);

    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person" });

    expect(res.statusCode).toBe(200);
    for (const item of res.json().items) {
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("email");
      expect(item).not.toHaveProperty("age");
      expect(item).not.toHaveProperty("active");
    }
  });

  it("fields projection narrows every item to the named fields plus _id", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.listEntities.mockResolvedValue([
      [makeEntity({ name: "Alice", age: 30, email: "a@b.com" }, "person", "ent-1")],
      1,
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?fields=name&fields=email",
    });

    expect(res.json().items[0]).toEqual({ _id: "ent-1", name: "Alice", email: "a@b.com" });
  });
});

describe("paging bounds — REST rejects where MCP clamps", () => {
  it.each([
    ["limit=0", "limit"],
    ["limit=201", "limit"],
    ["offset=-1", "offset"],
    ["limit=abc", "limit"],
  ])("%s answers 422 VALIDATION_ERROR", async (queryString) => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?${queryString}`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(holder.store.listEntities).not.toHaveBeenCalled();
  });

  it("defaults are limit 50, offset 0, sort _createdAt ascending", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.listEntities.mockResolvedValue([[], 0]);

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person",
    });

    expect(res.statusCode).toBe(200);
    const call = holder.store.listEntities.mock.calls[0]!;
    // (typeKey, defs, filters, q, stringProps, sortField, order, limit, offset)
    expect(call[5]).toBe("_createdAt");
    expect(call[6]).toBe("asc");
    expect(call[7]).toBe(50);
    expect(call[8]).toBe(0);
  });
});

describe("sorting", () => {
  it.each([
    ["createdAt", "_createdAt"],
    ["updatedAt", "_updatedAt"],
    ["_createdAt", "_createdAt"],
    ["_updatedAt", "_updatedAt"],
    ["name", "name"],
  ])("sort=%s resolves to %s", async (sort, resolved) => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.listEntities.mockResolvedValue([[], 0]);

    const res = await app.inject({
      method: "GET",
      url: `/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?sort=${sort}`,
    });

    expect(res.statusCode).toBe(200);
    expect(holder.store.listEntities.mock.calls[0]![5]).toBe(resolved);
  });

  it("an unknown sort field answers 422 naming the field", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?sort=ghost",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.sort).toContain("'ghost'");
  });

  it("a hidden property is not a valid sort field through the lens", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person?sort=age",
    });

    expect(res.statusCode).toBe(422);
  });

  it("an invalid order answers 422", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?order=sideways",
    });

    expect(res.statusCode).toBe(422);
  });
});

describe("free-text search and filters", () => {
  it("q and the in-scope string properties cross the port together", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.listEntities.mockResolvedValue([[], 0]);

    await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person?q=ali" });

    const call = holder.store.listEntities.mock.calls[0]!;
    expect(call[3]).toBe("ali");
    expect(call[4]).toEqual(["name", "email"]); // scoped string props only
  });

  it("q rejects the NUL character before crossing the port", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?q=%00",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe(
      "String value for 'q' must not contain the NUL character",
    );
    expect(holder.store.listEntities).not.toHaveBeenCalled();
  });

  it("q with no string property in scope is passed with an empty search set (silently ignored)", async () => {
    const { makeFullSchema } = await import("./helpers.js");
    holder.store.getFullSchema.mockResolvedValue(
      makeFullSchema({
        lensKey: "narrow",
        entityInclusions: [{ key: "person", properties: ["age", "active"] }],
      }),
    );
    holder.store.listEntities.mockResolvedValue([[makeEntity({ age: 30 })], 1]);

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/narrow/entities/person?q=alice",
    });

    // Not an error: the unfiltered list comes back rather than nothing.
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    const call = holder.store.listEntities.mock.calls[0]!;
    expect(call[3]).toBe("alice");
    expect(call[4]).toEqual([]); // the adapter adds no clause for an empty set
  });

  it("filter.* parameters cross the port as parsed, coerced conditions", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.listEntities.mockResolvedValue([[], 0]);

    await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?filter.age__gte=30&filter.name=Alice",
    });

    const call = holder.store.listEntities.mock.calls[0]!;
    expect(call[2]).toEqual([
      { key: "age", dataType: "integer", op: "gte", value: 30 },
      { key: "name", dataType: "string", op: "eq", value: "Alice" },
    ]);
  });

  it("a repeated filter parameter keeps the last value", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.listEntities.mockResolvedValue([[], 0]);

    await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?filter.name=Alice&filter.name=Bob",
    });

    expect(holder.store.listEntities.mock.calls[0]![2]).toEqual([
      { key: "name", dataType: "string", op: "eq", value: "Bob" },
    ]);
  });

  it("an invalid filter answers 422 before the store is consulted", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person?filter.age=abc",
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.age).toContain("Expected integer");
    expect(holder.store.listEntities).not.toHaveBeenCalled();
  });
});
