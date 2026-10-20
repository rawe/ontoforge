/**
 * The path read over a mocked store: root first, ending with the entity,
 * walked over every parent relation of the FULL schema and cut by the
 * lens below the nearest hidden ancestor. Names come from one batch read;
 * a hidden type or an unknown entity is not found.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeEntity, makeFullSchema, type MockRuntimeStore } from "./helpers.js";

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

const READINGS = { belongs_to: "target", member_of: "target", manages: "source" };

/**
 * company › department › person › person: `belongs_to` (department →
 * company) and `member_of` (person → department) point up, the
 * self-relation `manages` (person → person) points down.
 */
function hierarchySchema(options?: Parameters<typeof makeFullSchema>[0]): Row {
  const schema = makeFullSchema(options);
  const relationTypes = schema.relationTypes as Row[];
  relationTypes.find((rt) => rt.key === "belongs_to")!.parent = "target";
  for (const [key, sourceKey, targetKey, parent] of [
    ["member_of", "person", "department", "target"],
    ["manages", "person", "person", "source"],
  ]) {
    relationTypes.push({
      relationTypeId: `rt-${key}`,
      key,
      displayName: key,
      description: null,
      sourceKey,
      targetKey,
      parent,
      properties: [],
    });
  }
  return schema;
}

/** hr_view without department: person (name and email) and company. */
function hidingDepartment(personProperties: string[] = ["name", "email"]): Row {
  return hierarchySchema({
    entityInclusions: [
      { key: "person", properties: personProperties },
      { key: "company", properties: null },
    ],
  });
}

const ENTITIES: Record<string, Row> = {
  acme: makeEntity({ name: "ACME" }, "company", "acme"),
  sales: makeEntity({ name: "Sales" }, "department", "sales"),
  lea: makeEntity({ name: "Lea", email: "lea@x" }, "person", "lea"),
  ben: makeEntity({ name: "Ben" }, "person", "ben"),
};

/** The batch read answers from ENTITIES. */
function stored(): void {
  holder.store.getEntitiesByIds.mockImplementation(async (ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id in ENTITIES).map((id) => [id, ENTITIES[id]])),
  );
}

function getPath(lensKey: string, entityTypeKey: string, entityId: string) {
  return app.inject({
    method: "GET",
    url: `/api/ontologies/test_ont/runtime/lenses/${lensKey}/entities/${entityTypeKey}/${entityId}/path`,
  });
}

describe("the path read", () => {
  it("a deep entity: root first, ending with the entity, in two reads", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hierarchySchema());
    holder.store.getAncestors.mockResolvedValue([
      { type: "person", id: "lea" },
      { type: "department", id: "sales" },
      { type: "company", id: "acme" },
    ]);
    stored();

    const res = await getPath("hr_view", "person", "ben");

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual([
      { type: "company", id: "acme", name: "ACME" },
      { type: "department", id: "sales", name: "Sales" },
      { type: "person", id: "lea", name: "Lea" },
      { type: "person", id: "ben", name: "Ben" },
    ]);
    expect(holder.store.getAncestors.mock.calls).toEqual([["ben", READINGS]]);
    expect(holder.store.getEntitiesByIds).toHaveBeenCalledTimes(1);
    expect(holder.store.getEntity).not.toHaveBeenCalled();
  });

  it("a root's path is the entity alone", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hierarchySchema());
    stored();

    const res = await getPath("hr_view", "company", "acme");

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual([{ type: "company", id: "acme", name: "ACME" }]);
  });

  it("a lens hiding a middle level: the path starts below the hidden ancestor", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hidingDepartment());
    holder.store.getAncestors.mockResolvedValue([
      { type: "person", id: "lea" },
      { type: "department", id: "sales" },
      { type: "company", id: "acme" },
    ]);
    stored();

    const res = await getPath("hr_view", "person", "ben");

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual([
      { type: "person", id: "lea", name: "Lea" },
      { type: "person", id: "ben", name: "Ben" },
    ]);
    // The walk still follows every parent relation of the full schema.
    expect(holder.store.getAncestors.mock.calls).toEqual([["ben", READINGS]]);
    // Neither the hidden ancestor nor the visible one above it is named.
    expect(res.body).not.toContain("sales");
    expect(res.body).not.toContain("acme");
  });

  it("the entity's parent hidden: the path is the entity alone", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hidingDepartment());
    holder.store.getAncestors.mockResolvedValue([
      { type: "department", id: "sales" },
      { type: "company", id: "acme" },
    ]);
    stored();

    const res = await getPath("hr_view", "person", "lea");

    expect(res.json()).toEqual([{ type: "person", id: "lea", name: "Lea" }]);
  });

  it("a name property the lens hides gives a null name", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hidingDepartment(["email"]));
    holder.store.getAncestors.mockResolvedValue([{ type: "person", id: "lea" }]);
    stored();

    const res = await getPath("hr_view", "person", "ben");

    expect(res.json()).toEqual([
      { type: "person", id: "lea", name: null },
      { type: "person", id: "ben", name: null },
    ]);
  });

  it("an unknown entity, or an id of another type: 404", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hierarchySchema());
    stored();

    const unknown = await getPath("hr_view", "person", "nobody");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.message).toBe("Entity 'nobody' not found");

    const otherType = await getPath("hr_view", "person", "acme");
    expect(otherType.statusCode).toBe(404);
    expect(otherType.json().error.message).toBe("Entity 'acme' not found");
  });

  it("a type the lens hides: 404 without a store read", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hidingDepartment());
    stored();

    const res = await getPath("hr_view", "department", "sales");

    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe("Entity type 'department' not found");
    expect(holder.store.getAncestors).not.toHaveBeenCalled();
    expect(holder.store.getEntitiesByIds).not.toHaveBeenCalled();
  });

  it("two parents (the accepted race): every ancestor, in the walk's order reversed, no error", async () => {
    holder.store.getFullSchemaWithLensInclusions.mockResolvedValue(hierarchySchema());
    // Ben has two parents, Lea (manages) and Sales (member_of): the walk
    // holds both at its first level, by type and id.
    holder.store.getAncestors.mockResolvedValue([
      { type: "department", id: "sales" },
      { type: "person", id: "lea" },
      { type: "company", id: "acme" },
    ]);
    stored();

    const res = await getPath("hr_view", "person", "ben");

    expect(res.statusCode).toBe(200);
    expect(res.json().map((step: Row) => step.id)).toEqual(["acme", "lea", "sales", "ben"]);
  });
});
