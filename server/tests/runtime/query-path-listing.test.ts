/**
 * Query paths on the list surfaces, over a mocked store: the entity list
 * resolves a path against the lens-scoped schema and hands the port a
 * path condition; the relation list, sort, and the fields projection do
 * not take paths.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeEntity,
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
  holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
});

const ENTITIES = "/api/ontologies/test_ont/runtime/lenses/full_lens/entities";
const RELATIONS = "/api/ontologies/test_ont/runtime/lenses/full_lens/relations";

describe("the entity list", () => {
  it("hands the port a resolved path condition next to the plain ones", async () => {
    holder.store.listEntities.mockResolvedValue([[], 0]);

    const res = await app.inject({
      method: "GET",
      url: `${ENTITIES}/person?filter.works_for.name=Acme&filter.age__gte=18`,
    });

    expect(res.statusCode, res.body).toBe(200);
    // (typeKey, defs, filters, q, stringProps, sortField, order, limit, offset)
    const conditions = holder.store.listEntities.mock.calls[0]![2];
    expect(conditions).toEqual([
      {
        kind: "path",
        relationTypeKey: "works_for",
        direction: "outgoing",
        propertySource: "relatedEntity",
        propertyKey: "name",
        dataType: "string",
        op: "eq",
        value: "Acme",
      },
      { kind: "property", propertyKey: "age", dataType: "integer", op: "gte", value: 18 },
    ]);
  });

  it("a path in the fields projection matches nothing, as any unknown name does", async () => {
    holder.store.listEntities.mockResolvedValue([
      [makeEntity({ name: "Alice", age: 30 }, "person", "ent-1")],
      1,
    ]);

    const res = await app.inject({
      method: "GET",
      url: `${ENTITIES}/person?filter.works_for.name=Acme&fields=works_for.name&fields=name`,
    });

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items[0]).toEqual({ _id: "ent-1", name: "Alice" });
  });

  it("a sort key that is a query path answers 422", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${ENTITIES}/person?sort=works_for.name`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe("Sorting by query paths is not supported");
    expect(holder.store.listEntities).not.toHaveBeenCalled();
  });
});

describe("the relation list", () => {
  it("rejects a path key as an entity-list-only feature", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${RELATIONS}/works_for?filter.works_for.name=Acme`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe(
      "Query paths apply to entity lists only: 'works_for.name'",
    );
    expect(holder.store.listRelations).not.toHaveBeenCalled();
  });
});
