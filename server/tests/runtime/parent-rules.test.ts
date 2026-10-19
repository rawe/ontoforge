/**
 * The parent rules over a mocked store: a relation create of a parent
 * relation type refuses a second parent (on the child end) and a cycle
 * (on the parent end), collected with the other field errors; an entity
 * delete refuses an entity with children wherever the ontology flags a
 * parent relation. Both read every parent relation of the FULL schema.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
  makeRelation,
  type MockRuntimeStore,
} from "./helpers.js";

type Row = Record<string, unknown>;

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

/** Every parent relation of `withParents`, as the store receives them. */
const READINGS = { belongs_to: "target", manages: "source" };

/**
 * The helper schema with two parent relations: `belongs_to` (department
 * → company, the company is the parent) and the self-relation `manages`
 * (person → person, the source is the parent). `works_for` stays
 * ordinary.
 */
function withParents(options?: Parameters<typeof makeFullSchema>[0]): Row {
  const schema = makeFullSchema(options);
  const relationTypes = schema.relationTypes as Row[];
  relationTypes.find((rt) => rt.key === "belongs_to")!.parent = "target";
  relationTypes.push({
    relationTypeId: "rt-3",
    key: "manages",
    displayName: "Manages",
    description: null,
    sourceKey: "person",
    targetKey: "person",
    parent: "source",
    properties: [],
  });
  return schema;
}

function createRelation(lensKey: string, relationTypeKey: string, payload: Row) {
  return app.inject({
    method: "POST",
    url: `/api/ontologies/test_ont/runtime/lenses/${lensKey}/relations/${relationTypeKey}`,
    payload,
  });
}

function deleteEntity(lensKey: string, entityTypeKey: string, entityId: string) {
  return app.inject({
    method: "DELETE",
    url: `/api/ontologies/test_ont/runtime/lenses/${lensKey}/entities/${entityTypeKey}/${entityId}`,
  });
}

/** The two endpoint reads of a `manages` create, in call order. */
function bothPersons(fromId: string, toId: string): void {
  holder.store.getEntityById
    .mockResolvedValueOnce(makeEntity({ name: fromId }, "person", fromId))
    .mockResolvedValueOnce(makeEntity({ name: toId }, "person", toId));
}

describe("relation create of a parent relation type", () => {
  it("a child without a parent, under a parent not below it: created", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    bothPersons("lea", "ben");
    holder.store.createRelation.mockResolvedValue(
      makeRelation({}, { relationTypeKey: "manages", fromEntityId: "lea", toEntityId: "ben" }),
    );

    const res = await createRelation("hr_view", "manages", { fromEntityId: "lea", toEntityId: "ben" });

    expect(res.statusCode).toBe(201);
    // The child's walk, then the parent's, both over every parent relation.
    expect(holder.store.getAncestors.mock.calls).toEqual([
      ["ben", READINGS],
      ["lea", READINGS],
    ]);
  });

  it("a second parent through the same relation: 422 on the child end, naming no parent", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    bothPersons("kim", "ben");
    holder.store.getAncestors.mockImplementation(async (id: string) =>
      id === "ben" ? [{ type: "person", id: "lea" }] : [],
    );

    const res = await createRelation("hr_view", "manages", { fromEntityId: "kim", toEntityId: "ben" });

    expect(res.statusCode).toBe(422);
    const fields = res.json().error.details.fields;
    expect(fields).toEqual({ toEntityId: "Entity 'ben' already has a parent" });
    expect(JSON.stringify(res.json())).not.toContain("lea");
    expect(holder.store.createRelation).not.toHaveBeenCalled();
  });

  it("a parent target end: the child is the source, so its field carries the refusal", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    holder.store.getEntityById
      .mockResolvedValueOnce(makeEntity({ name: "R&D" }, "department", "rnd"))
      .mockResolvedValueOnce(makeEntity({ name: "Beta" }, "company", "beta"));
    holder.store.getAncestors.mockImplementation(async (id: string) =>
      id === "rnd" ? [{ type: "company", id: "acme" }] : [],
    );

    const res = await createRelation("hr_view", "belongs_to", { fromEntityId: "rnd", toEntityId: "beta" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      fromEntityId: "Entity 'rnd' already has a parent",
    });
  });

  it("the rules read every parent relation of the full schema, through a lens hiding the others", async () => {
    // The lens shows only `manages` and persons; `belongs_to` is hidden.
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(
      withParents({
        lensKey: "people",
        entityInclusions: [{ key: "person", properties: null }],
        relationInclusions: [{ key: "manages", properties: null }],
      }),
    );
    bothPersons("kim", "ben");
    holder.store.getAncestors.mockResolvedValue([{ type: "person", id: "lea" }]);

    const res = await createRelation("people", "manages", { fromEntityId: "kim", toEntityId: "ben" });

    expect(res.statusCode).toBe(422);
    expect(holder.store.getAncestors).toHaveBeenCalledWith("ben", READINGS);
  });

  it("a cycle: the child among the parent's ancestors gives 422 on the parent end", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    // ben manages kim already; kim manages ben would close the loop.
    bothPersons("kim", "ben");
    holder.store.getAncestors.mockImplementation(async (id: string) =>
      id === "kim" ? [{ type: "person", id: "ben" }, { type: "person", id: "lea" }] : [],
    );

    const res = await createRelation("hr_view", "manages", { fromEntityId: "kim", toEntityId: "ben" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      fromEntityId: "Entity 'kim' cannot be the parent: this would close a cycle",
    });
    expect(holder.store.createRelation).not.toHaveBeenCalled();
  });

  it("a self-loop is a cycle", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    bothPersons("ben", "ben");

    const res = await createRelation("hr_view", "manages", { fromEntityId: "ben", toEntityId: "ben" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      fromEntityId: "Entity 'ben' cannot be the parent: this would close a cycle",
    });
  });

  it("rule errors are collected with property and endpoint errors in one response", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    bothPersons("ben", "ben");
    holder.store.getAncestors.mockResolvedValue([{ type: "person", id: "lea" }]);

    const res = await createRelation("hr_view", "manages", {
      fromEntityId: "ben",
      toEntityId: "ben",
      bogus: 1,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      bogus: "Unknown property: not defined in type 'manages'",
      toEntityId: "Entity 'ben' already has a parent",
      fromEntityId: "Entity 'ben' cannot be the parent: this would close a cycle",
    });
  });

  it("an end with an endpoint error is not checked", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    holder.store.getEntityById
      .mockResolvedValueOnce(makeEntity({ name: "lea" }, "person", "lea"))
      .mockResolvedValueOnce(null);

    const res = await createRelation("hr_view", "manages", { fromEntityId: "lea", toEntityId: "gone" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toEqual({
      toEntityId: "Target entity 'gone' not found",
    });
    expect(holder.store.getAncestors).not.toHaveBeenCalled();
  });

  it("an ordinary relation type walks nothing", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    holder.store.getEntityById
      .mockResolvedValueOnce(makeEntity({ name: "Ben" }, "person", "ben"))
      .mockResolvedValueOnce(makeEntity({ name: "Acme" }, "company", "acme"));
    holder.store.createRelation.mockResolvedValue(makeRelation());

    const res = await createRelation("hr_view", "works_for", { fromEntityId: "ben", toEntityId: "acme" });

    expect(res.statusCode).toBe(201);
    expect(holder.store.getAncestors).not.toHaveBeenCalled();
  });
});

describe("entity delete: leaves only, wherever a parent relation is flagged", () => {
  it("an entity with children: 409 with the exact text, nothing deleted", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Acme" }, "company", "acme"));
    holder.store.hasChildren.mockResolvedValue(true);

    const res = await deleteEntity("hr_view", "company", "acme");

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: "RESOURCE_CONFLICT",
      message: "This entity has children; delete them first",
    });
    expect(holder.store.hasChildren).toHaveBeenCalledWith("acme", READINGS);
    expect(holder.store.deleteEntity).not.toHaveBeenCalled();
  });

  it("the same through a lens that hides the children and their parent relation", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(
      withParents({ lensKey: "firms", entityInclusions: [{ key: "company", properties: null }] }),
    );
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Acme" }, "company", "acme"));
    holder.store.hasChildren.mockResolvedValue(true);

    const res = await deleteEntity("firms", "company", "acme");

    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe("This entity has children; delete them first");
    expect(holder.store.hasChildren).toHaveBeenCalledWith("acme", READINGS);
  });

  it("a leaf deletes as today", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Ben" }, "person", "ben"));
    holder.store.deleteEntity.mockResolvedValue(true);

    const res = await deleteEntity("hr_view", "person", "ben");

    expect(res.statusCode).toBe(204);
    expect(holder.store.deleteEntity).toHaveBeenCalled();
  });

  it("a missing entity is not found, whatever its id has below it", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(withParents());
    holder.store.hasChildren.mockResolvedValue(true);

    const res = await deleteEntity("hr_view", "company", "task-id");

    expect(res.statusCode).toBe(404);
    expect(holder.store.hasChildren).not.toHaveBeenCalled();
    expect(holder.store.deleteEntity).not.toHaveBeenCalled();
  });

  it("an ontology without flags deletes as today, with no hierarchy read", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema());
    holder.store.deleteEntity.mockResolvedValue(true);

    const res = await deleteEntity("hr_view", "company", "acme");

    expect(res.statusCode).toBe(204);
    expect(holder.store.getEntity).not.toHaveBeenCalled();
    expect(holder.store.hasChildren).not.toHaveBeenCalled();
  });
});
