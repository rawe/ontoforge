/**
 * Relation CRUD through scoped and unscoped lenses over a mocked store,
 * including the pipeline cases: endpoint type mismatch checked against the
 * FULL schema through a narrow lens, endpoint + property errors collected
 * in ONE response, silent endpoint-ignore on update, and endpoint filters
 * on listing.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
  makeRelation,
  makeScopedSchema,
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

describe("create relation", () => {
  it("creates a relation through a scoped lens; response is property-filtered", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntityById
      .mockResolvedValueOnce(makeEntity({ name: "Alice" }, "person", "ent-1"))
      .mockResolvedValueOnce(makeEntity({ name: "Acme" }, "company", "ent-2"));
    holder.store.createRelation.mockResolvedValue(
      makeRelation({ role: "Engineer", since: "2024-01-15" }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/relations/works_for",
      payload: { fromEntityId: "ent-1", toEntityId: "ent-2", role: "Engineer" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body._id).toBe("rel-1");
    expect(body.fromEntityId).toBe("ent-1");
    expect(body.toEntityId).toBe("ent-2");
    // works_for is included with properties=null, so all props are visible.
    expect(body.role).toBe("Engineer");
  });

  it("a relation type outside the lens answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/relations/belongs_to",
      payload: { fromEntityId: "ent-1", toEntityId: "ent-2" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("endpoint type mismatch is checked against the FULL schema through a narrow lens", async () => {
    // hr_view does not expose 'department' at all, yet the endpoint check
    // names the full schema's declared source type in its error.
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntityById
      .mockResolvedValueOnce(makeEntity({ name: "R&D" }, "department", "ent-9"))
      .mockResolvedValueOnce(makeEntity({ name: "Acme" }, "company", "ent-2"));

    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/relations/works_for",
      payload: { fromEntityId: "ent-9", toEntityId: "ent-2" },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields.fromEntityId).toBe(
      "Source entity type mismatch: expected 'person', got 'department'",
    );
    expect(holder.store.createRelation).not.toHaveBeenCalled();
  });

  it("collects endpoint errors alongside property errors in ONE response", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntityById
      .mockResolvedValueOnce(null) // source missing
      .mockResolvedValueOnce(makeEntity({ name: "Alice" }, "person", "ent-1")); // target wrong type

    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/relations/works_for",
      payload: {
        fromEntityId: "no-such-entity",
        toEntityId: "ent-1",
        bogus: "value",
      },
    });

    expect(res.statusCode).toBe(422);
    const fields = res.json().error.details.fields;
    expect(fields.bogus).toBe("Unknown property: not defined in type 'works_for'");
    expect(fields.fromEntityId).toBe("Source entity 'no-such-entity' not found");
    expect(fields.toEntityId).toBe(
      "Target entity type mismatch: expected 'company', got 'person'",
    );
    expect(holder.store.createRelation).not.toHaveBeenCalled();
  });

  it("missing endpoints in the payload answer 422 in the standard envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/runtime/hr_view/relations/works_for",
      payload: { role: "Engineer" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("read relation", () => {
  it("returns endpoint ids and scoped properties", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getRelation.mockResolvedValue(
      makeRelation({ role: "Engineer", since: "2024-01-15" }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for/rel-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body._id).toBe("rel-1");
    expect(body.role).toBe("Engineer");
    expect(body.fromEntityId).toBe("ent-1");
    expect(body.toEntityId).toBe("ent-2");
  });

  it("a property-filtered inclusion hides the excluded relation property", async () => {
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
    holder.store.getRelation.mockResolvedValue(
      makeRelation({ role: "Engineer", since: "2024-01-15" }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/restricted_view/relations/works_for/rel-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("Engineer");
    expect(body).not.toHaveProperty("since");
  });

  it("a missing relation answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getRelation.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for/no-such-id",
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("list relations", () => {
  it("returns items, total, limit, offset", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.listRelations.mockResolvedValue([
      [
        makeRelation({ role: "Engineer" }, { relationId: "rel-1" }),
        makeRelation({ role: "Manager" }, { relationId: "rel-2" }),
      ],
      2,
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("a relation type outside the lens answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/belongs_to",
    });

    expect(res.statusCode).toBe(404);
  });

  it("passes fromEntityId / toEntityId endpoint filters to the store", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.listRelations.mockResolvedValue([[], 0]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for?fromEntityId=ent-1&toEntityId=ent-2",
    });

    expect(res.statusCode).toBe(200);
    const call = holder.store.listRelations.mock.calls[0]!;
    expect(call[3]).toBe("ent-1"); // fromEntityId
    expect(call[4]).toBe("ent-2"); // toEntityId
  });

  it("either endpoint filter alone reaches the store", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.listRelations.mockResolvedValue([[], 0]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for?fromEntityId=ent-1",
    });

    expect(res.statusCode).toBe(200);
    const call = holder.store.listRelations.mock.calls[0]!;
    expect(call[3]).toBe("ent-1");
    expect(call[4]).toBeNull();
  });

  it("takes no free-text term: a q parameter is ignored, not an error", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.listRelations.mockResolvedValue([[], 0]);

    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for?q=alice",
    });

    expect(res.statusCode).toBe(200);
    // No search machinery for relations: filters stay empty.
    const filters = holder.store.listRelations.mock.calls[0]![2] as Record<string, string>;
    expect(filters).toEqual({});
  });

  it("out-of-range limit answers 422 on REST", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/runtime/hr_view/relations/works_for?limit=500",
    });

    expect(res.statusCode).toBe(422);
  });
});

describe("update relation", () => {
  it("applies a partial property update", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.updateRelation.mockResolvedValue(
      makeRelation({ role: "Senior Engineer", since: "2024-01-15" }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/api/runtime/hr_view/relations/works_for/rel-1",
      payload: { role: "Senior Engineer" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("Senior Engineer");
  });

  it("SILENTLY ignores endpoint ids in the payload; properties still apply", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.updateRelation.mockResolvedValue(makeRelation({ role: "Senior Engineer" }));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/runtime/hr_view/relations/works_for/rel-1",
      payload: {
        fromEntityId: "ent-999",
        toEntityId: "ent-888",
        role: "Senior Engineer",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("Senior Engineer");
    // The stored endpoints are untouched.
    expect(body.fromEntityId).toBe("ent-1");
    expect(body.toEntityId).toBe("ent-2");
    // The endpoint ids never reached the write: only `role` was set.
    const call = holder.store.updateRelation.mock.calls[0]!;
    expect(call[2]).toEqual({ role: "Senior Engineer" });
    expect(call[3]).toEqual([]);
  });

  it("a payload of ONLY endpoint ids changes nothing and returns the current relation", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getRelation.mockResolvedValue(makeRelation({ role: "Engineer" }));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/runtime/hr_view/relations/works_for/rel-1",
      payload: { fromEntityId: "ent-999", toEntityId: "ent-888" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("Engineer");
    expect(holder.store.updateRelation).not.toHaveBeenCalled();
  });

  it("a relation type outside the lens answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "PATCH",
      url: "/api/runtime/hr_view/relations/belongs_to/rel-1",
      payload: { name: "X" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("delete relation", () => {
  it("deletes and answers 204", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.deleteRelation.mockResolvedValue(true);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/runtime/hr_view/relations/works_for/rel-1",
    });

    expect(res.statusCode).toBe(204);
  });

  it("a relation type outside the lens answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "DELETE",
      url: "/api/runtime/hr_view/relations/belongs_to/rel-1",
    });

    expect(res.statusCode).toBe(404);
  });

  it("a missing relation answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.deleteRelation.mockResolvedValue(false);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/runtime/hr_view/relations/works_for/no-such-id",
    });

    expect(res.statusCode).toBe(404);
  });
});
