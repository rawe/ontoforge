/**
 * Neighbourhood traversal with scope filtering over a mocked store.
 * Ported from `tests/runtime/test_neighbors.py`, plus the projection rows
 * of `docs/interfaces.md#field-projection` and the documented out-of-scope
 * neighbour leak (`docs/capabilities/instance-data.md#traversal`).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  NOW,
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
  makeScopedSchema,
  makeUnscopedSchema,
  type MockRuntimeStore,
} from "./helpers.js";

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

beforeEach(() => {
  holder.store = createMockRuntimeStore();
  invalidateLoadedSchemaCache();
});

type Row = Record<string, unknown>;

/** Build a raw neighbour entry as returned by the store's getNeighbors. */
function makeNeighbor(options: {
  relationTypeKey: string;
  direction: string;
  neighborEntityTypeKey: string;
  neighborId: string;
  relationProps?: Row;
  entityProps?: Row;
}): Row {
  return {
    relation: {
      _id: `rel-${options.neighborId}`,
      _relationTypeKey: options.relationTypeKey,
      _createdAt: NOW,
      _updatedAt: NOW,
      direction: options.direction,
      ...options.relationProps,
    },
    entity: {
      _id: options.neighborId,
      _entityTypeKey: options.neighborEntityTypeKey,
      _createdAt: NOW,
      _updatedAt: NOW,
      ...options.entityProps,
    },
  };
}

describe("scope filtering", () => {
  it("drops relations whose type the lens does not expose, with their neighbour", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", email: "a@b.com" }, "person", "ent-1"),
    );
    holder.store.getNeighbors.mockResolvedValue([
      makeNeighbor({
        relationTypeKey: "works_for",
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-2",
        relationProps: { role: "Engineer", since: "2024-01-15" },
        entityProps: { name: "Acme" },
      }),
      makeNeighbor({
        relationTypeKey: "belongs_to", // NOT in the scoped schema
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-3",
        entityProps: { name: "OtherCorp" },
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person/ent-1/neighbors",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.neighbors).toHaveLength(1);
    expect(body.neighbors[0].relation._relationTypeKey).toBe("works_for");
  });

  it("filters centre and neighbour entity properties to the lens", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", email: "a@b.com", age: 30 }, "person", "ent-1"),
    );
    holder.store.getNeighbors.mockResolvedValue([
      makeNeighbor({
        relationTypeKey: "works_for",
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-2",
        relationProps: { role: "Engineer" },
        entityProps: { name: "Acme" },
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person/ent-1/neighbors",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Centre entity: scoped to name+email; age is hidden.
    expect(body.entity.name).toBe("Alice");
    expect(body.entity.email).toBe("a@b.com");
    expect(body.entity).not.toHaveProperty("age");
    // Neighbour (company: whole via properties=null).
    expect(body.neighbors[0].entity.name).toBe("Acme");
  });

  it("filters relation properties to a property-narrowed inclusion", async () => {
    holder.store.getFullSchema.mockResolvedValue(
      makeFullSchema({
        ontologyKey: "restricted_view",
        entityInclusions: [
          { key: "person", properties: null },
          { key: "company", properties: null },
        ],
        relationInclusions: [{ key: "works_for", properties: ["role"] }],
      }),
    );
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "ent-1"));
    holder.store.getNeighbors.mockResolvedValue([
      makeNeighbor({
        relationTypeKey: "works_for",
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-2",
        relationProps: { role: "Engineer", since: "2024-01-15" },
        entityProps: { name: "Acme" },
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/restricted_view/entities/person/ent-1/neighbors",
    });

    expect(res.statusCode).toBe(200);
    const rel = res.json().neighbors[0].relation;
    expect(rel.role).toBe("Engineer");
    expect(rel).not.toHaveProperty("since");
    expect(rel.direction).toBe("outgoing");
  });

  it("the documented leak: an out-of-scope neighbour escapes property stripping", async () => {
    // A lens exposing person and belongs_to (department -> company) but NOT
    // department: the department neighbour comes back with ALL properties.
    holder.store.getFullSchema.mockResolvedValue(
      makeFullSchema({
        ontologyKey: "leaky_view",
        entityInclusions: [
          { key: "person", properties: ["name"] },
          { key: "company", properties: null },
        ],
        relationInclusions: [{ key: "belongs_to", properties: null }],
      }),
    );
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Acme" }, "company", "ent-2"));
    holder.store.getNeighbors.mockResolvedValue([
      makeNeighbor({
        relationTypeKey: "belongs_to",
        direction: "incoming",
        neighborEntityTypeKey: "department", // NOT in scope
        neighborId: "ent-9",
        entityProps: { name: "R&D", code: "RD-1" },
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/leaky_view/entities/company/ent-2/neighbors",
    });

    expect(res.statusCode).toBe(200);
    const neighbour = res.json().neighbors[0].entity;
    // Both properties leak through, unstripped.
    expect(neighbour.name).toBe("R&D");
    expect(neighbour.code).toBe("RD-1");
  });

  it("an unscoped lens returns neighbours of every relation type", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", age: 30, email: "a@b.com" }, "person", "ent-1"),
    );
    holder.store.getNeighbors.mockResolvedValue([
      makeNeighbor({
        relationTypeKey: "works_for",
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-2",
        relationProps: { role: "Engineer" },
        entityProps: { name: "Acme" },
      }),
      makeNeighbor({
        relationTypeKey: "belongs_to",
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-3",
        entityProps: { name: "ParentCo" },
      }),
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/entities/person/ent-1/neighbors",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.neighbors).toHaveLength(2);
    const relTypes = body.neighbors.map((n: Row) => (n.relation as Row)._relationTypeKey).sort();
    expect(relTypes).toEqual(["belongs_to", "works_for"]);
    expect(body.entity.age).toBe(30);
  });
});

describe("addressing", () => {
  it("an entity type outside the lens answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/department/ent-1/neighbors",
    });

    expect(res.statusCode).toBe(404);
  });

  it("a missing centre entity answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person/no-such-id/neighbors",
    });

    expect(res.statusCode).toBe(404);
  });

  it("passes direction, relation type filter and limit to the store", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "ent-1"));
    holder.store.getNeighbors.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url:
        "/api/runtime/hr_view/entities/person/ent-1/neighbors" +
        "?direction=outgoing&relationTypeKey=works_for&limit=5",
    });

    expect(res.statusCode).toBe(200);
    expect(holder.store.getNeighbors).toHaveBeenCalledWith(
      "ent-1",
      "outgoing",
      "works_for",
      5,
      expect.any(Object), // the full-schema per-type-key defs map, for row decoding
    );
  });

  it("an unknown relationTypeKey yields no neighbours, not an error", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }, "person", "ent-1"));
    holder.store.getNeighbors.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person/ent-1/neighbors?relationTypeKey=no_such_type",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().neighbors).toEqual([]);
  });

  it("rejects an invalid direction and an out-of-range limit on REST", async () => {
    const badDirection = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person/ent-1/neighbors?direction=sideways",
    });
    expect(badDirection.statusCode).toBe(422);

    const badLimit = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/entities/person/ent-1/neighbors?limit=201",
    });
    expect(badLimit.statusCode).toBe(422);
  });
});

describe("field projection", () => {
  function projectionFixture(): void {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", age: 30, email: "a@b.com" }, "person", "ent-1"),
    );
    holder.store.getNeighbors.mockResolvedValue([
      makeNeighbor({
        relationTypeKey: "works_for",
        direction: "outgoing",
        neighborEntityTypeKey: "company",
        neighborId: "ent-2",
        relationProps: { role: "Engineer", since: "2024-01-15" },
        entityProps: { name: "Acme" },
      }),
    ]);
  }

  it("`fields` shapes the centre entity and every neighbour, with their system fields", async () => {
    projectionFixture();

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/entities/person/ent-1/neighbors?fields=name",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Centre: _id survives; _entityTypeKey does NOT (per the projection table).
    expect(Object.keys(body.entity).sort()).toEqual(["_id", "name"]);
    // Neighbour: _id and _entityTypeKey survive.
    expect(Object.keys(body.neighbors[0].entity).sort()).toEqual([
      "_entityTypeKey",
      "_id",
      "name",
    ]);
    // Relations are untouched by `fields`.
    expect(body.neighbors[0].relation.role).toBe("Engineer");
  });

  it("`relationFields` shapes the relations; _id, _relationTypeKey, direction survive", async () => {
    projectionFixture();

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/full_ontology/entities/person/ent-1/neighbors?relationFields=role",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body.neighbors[0].relation).sort()).toEqual([
      "_id",
      "_relationTypeKey",
      "direction",
      "role",
    ]);
    // Entities are untouched by `relationFields`.
    expect(body.entity.age).toBe(30);
  });
});
