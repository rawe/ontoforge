/**
 * Entity CRUD through scoped and unscoped lenses over a mocked store,
 * including the pipeline cases: collect-all,
 * default-from-hidden-property, both bad-default
 * failure modes, null-removal semantics, no-change updates, and the
 * stub + projection interplay.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeEntity,
  makeFullSchema,
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

/** A schema with a document property, for stub/projection scenarios. */
function makeDocumentSchema(): Record<string, unknown> {
  return {
    lens: {
      lensId: "lens-1",
      key: "doc_lens",
      name: "Doc Lens",
      description: null,
    },
    entityTypes: [
      {
        entityTypeId: "et-1",
        key: "article",
        displayName: "Article",
        description: null,
        properties: [
          { key: "title", displayName: "Title", dataType: "string", required: true, defaultValue: null },
          { key: "body", displayName: "Body", dataType: "document", required: false, defaultValue: null },
        ],
      },
    ],
    relationTypes: [],
    entityInclusions: [],
    relationInclusions: [],
  };
}

describe("create entity", () => {
  it("unscoped: validates against the full property set and returns everything", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.createEntity.mockResolvedValue(
      makeEntity({ name: "Alice", age: 30, email: "a@b.com", active: true }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person",
      payload: { name: "Alice", age: 30, email: "a@b.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Alice");
    expect(body.age).toBe(30);
    expect(body.email).toBe("a@b.com");
    expect(body.active).toBe(true);
    expect(body._id).toBeDefined();
  });

  it("scoped: validates scoped properties, applies hidden defaults, filters the response", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.createEntity.mockResolvedValue(
      makeEntity({ name: "Alice", email: "a@b.com", active: true }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person",
      payload: { name: "Alice", email: "a@b.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Alice");
    expect(body.email).toBe("a@b.com");
    expect(body).not.toHaveProperty("age");
    expect(body).not.toHaveProperty("active");
    expect(body._id).toBeDefined();
    expect(body._entityTypeKey).toBeDefined();

    // The hidden `active` default came from the FULL schema.
    const storedProps = holder.store.createEntity.mock.calls[0]![2] as Record<string, unknown>;
    expect(storedProps.active).toBe(true);
  });

  it("scoped: a hidden property in the payload is an unknown property", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person",
      payload: { name: "Alice", age: 30 }, // age is hidden by the lens
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toHaveProperty("age");
    expect(holder.store.createEntity).not.toHaveBeenCalled();
  });

  it("a system property is rejected as unknown too", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person",
      payload: { name: "Alice", _id: "forged-id" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields._id).toContain("Unknown property");
  });

  it("an out-of-scope entity type answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/department",
      payload: { name: "Engineering" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("an unknown lens key answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/nonexistent/entities/person",
      payload: { name: "Alice" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("collect-all: one write, several bad fields, one response naming every one", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person",
      payload: { age: "not-a-number", active: "not-a-bool", nickname: "Al" },
    });

    expect(res.statusCode).toBe(422);
    const fields = res.json().error.details.fields;
    expect(fields.name).toBe("Required property missing"); // required, absent
    expect(fields.age).toContain("Expected integer");
    expect(fields.active).toContain("Expected boolean");
    expect(fields.nickname).toContain("Unknown property");
    expect(Object.keys(fields).sort()).toEqual(["active", "age", "name", "nickname"]);
  });

  it("required property missing on explicit null", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person",
      payload: { name: null },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.name).toBe("Required property missing");
  });
});

describe("bad-default failure modes", () => {
  function schemaWithBadDefault(required: boolean): Record<string, unknown> {
    return {
      lens: { lensId: "lens-1", key: "lens", name: "Lens", description: null },
      entityTypes: [
        {
          entityTypeId: "et-1",
          key: "thing",
          displayName: "Thing",
          description: null,
          properties: [
            { key: "name", displayName: "Name", dataType: "string", required: true, defaultValue: null },
            { key: "count", displayName: "Count", dataType: "integer", required, defaultValue: "not-a-number" },
          ],
        },
      ],
      relationTypes: [],
      entityInclusions: [],
      relationInclusions: [],
    };
  }

  it("mode 1 — validation applies the default (required, in scope): field error, write rejected", async () => {
    holder.store.getFullSchema.mockResolvedValue(schemaWithBadDefault(true));

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/lens/entities/thing",
      payload: { name: "A" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.count).toContain("Expected integer");
    expect(holder.store.createEntity).not.toHaveBeenCalled();
  });

  it("mode 1 — explicit null routes through validation even for an optional property", async () => {
    holder.store.getFullSchema.mockResolvedValue(schemaWithBadDefault(false));

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/lens/entities/thing",
      payload: { name: "A", count: null },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.count).toContain("Expected integer");
  });

  it("mode 2 — post-validation default application swallows the failure and skips the property", async () => {
    holder.store.getFullSchema.mockResolvedValue(schemaWithBadDefault(false));
    holder.store.createEntity.mockResolvedValue(makeEntity({ name: "A" }, "thing"));

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/lens/entities/thing",
      payload: { name: "A" }, // count omitted: default applied after validation
    });

    expect(res.statusCode).toBe(201);
    const storedProps = holder.store.createEntity.mock.calls[0]![2] as Record<string, unknown>;
    expect(storedProps).not.toHaveProperty("count");
  });
});

describe("get entity", () => {
  it("scoped: filters properties to the lens", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", age: 30, email: "a@b.com", active: true }),
    );

    const res = await app.inject({ method: "GET", url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/ent-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Alice");
    expect(body.email).toBe("a@b.com");
    expect(body).not.toHaveProperty("age");
    expect(body).not.toHaveProperty("active");
  });

  it("unscoped: returns all properties", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", age: 30, email: "a@b.com", active: true }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.age).toBe(30);
    expect(body.active).toBe(true);
  });

  it("a missing entity answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.getEntity.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/no-such-id",
    });

    expect(res.statusCode).toBe(404);
  });

  it("fields projection keeps the named fields plus _id unconditionally", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ name: "Alice", age: 30, email: "a@b.com", active: true }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1?fields=name",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ _id: "ent-1", name: "Alice" });
  });

  it("unknown names in fields are not an error; they match nothing", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1?fields=ghost",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ _id: "ent-1" });
  });
});

describe("update entity (partial)", () => {
  it("scoped: validates against scoped properties; response filtered", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.updateEntity.mockResolvedValue(
      makeEntity({ name: "Alice Updated", age: 30, email: "new@b.com", active: true }),
    );

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/ent-1",
      payload: { email: "new@b.com" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("new@b.com");
    expect(body.name).toBe("Alice Updated");
    expect(body).not.toHaveProperty("age");
    expect(body).not.toHaveProperty("active");
  });

  it("an out-of-scope property in the payload is rejected as unknown", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/ent-1",
      payload: { age: 31 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields).toHaveProperty("age");
  });

  it("null removes an optional property", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1",
      payload: { email: null },
    });

    expect(res.statusCode).toBe(200);
    const [, , setProps, removeProps] = holder.store.updateEntity.mock.calls[0]!;
    expect(setProps).toEqual({});
    expect(removeProps).toEqual(["email"]);
  });

  it("null on a required property is rejected — no default rescues it", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1",
      payload: { name: null },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.fields.name).toBe("Cannot set required property to null");
    expect(holder.store.updateEntity).not.toHaveBeenCalled();
  });

  it("defaults are NOT re-applied on update", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.updateEntity.mockResolvedValue(makeEntity({ name: "Bob" }));

    await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1",
      payload: { name: "Bob" },
    });

    const [, , setProps] = holder.store.updateEntity.mock.calls[0]!;
    expect(setProps).toEqual({ name: "Bob" }); // no `active` default injected
  });

  it("a no-change update returns the current state WITHOUT advancing _updatedAt", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ name: "Alice" }));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/ent-1",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Alice");
    expect(holder.store.updateEntity).not.toHaveBeenCalled(); // no write, no timestamp
    expect(holder.store.getEntity).toHaveBeenCalledTimes(1);
  });

  it("a missing entity answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeUnscopedSchema());
    holder.store.updateEntity.mockResolvedValue(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/full_lens/entities/person/no-such-id",
      payload: { name: "Bob" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("delete entity", () => {
  it("answers 204 on success", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.deleteEntity.mockResolvedValue(true);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/ent-1",
    });

    expect(res.statusCode).toBe(204);
  });

  it("an out-of-scope type answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());

    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/department/ent-99",
    });

    expect(res.statusCode).toBe(404);
    expect(holder.store.deleteEntity).not.toHaveBeenCalled();
  });

  it("a missing entity answers 404", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeScopedSchema());
    holder.store.deleteEntity.mockResolvedValue(false);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/ontologies/test_ont/runtime/lenses/hr_view/entities/person/no-such-id",
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("document stubs and projection interplay", () => {
  it("a document value reads as a stub with its recorded length", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocumentSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity(
        { title: "T", body: "full text here", _doc_body_length: 14 },
        "article",
      ),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article/ent-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.body).toEqual({ document: true, length: 14 });
    // Length bookkeeping never appears in any response.
    expect(body).not.toHaveProperty("_doc_body_length");
  });

  it("missing bookkeeping falls back to measuring the value on read", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocumentSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity({ title: "T", body: "12345" }, "article"),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article/ent-1",
    });

    expect(res.json().body).toEqual({ document: true, length: 5 });
  });

  it("an unset document property is absent entirely — no stub", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocumentSchema());
    holder.store.getEntity.mockResolvedValue(makeEntity({ title: "T" }, "article"));

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article/ent-1",
    });

    expect(res.json()).not.toHaveProperty("body");
  });

  it("naming the document property in fields returns the raw content", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocumentSchema());
    holder.store.getEntity.mockResolvedValue(
      makeEntity(
        { title: "T", body: "full text here", _doc_body_length: 14 },
        "article",
      ),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article/ent-1?fields=body",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ _id: "ent-1", body: "full text here" });
  });

  it("create records the character count alongside the value", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocumentSchema());
    holder.store.createEntity.mockResolvedValue(
      makeEntity({ title: "T", body: "hello", _doc_body_length: 5 }, "article"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article",
      payload: { title: "T", body: "hello" },
    });

    expect(res.statusCode).toBe(201);
    const storedProps = holder.store.createEntity.mock.calls[0]![2] as Record<string, unknown>;
    expect(storedProps._doc_body_length).toBe(5);
    // The write response stubs the document.
    expect(res.json().body).toEqual({ document: true, length: 5 });
  });

  it("update maintains the count for a changed value and removes it on null", async () => {
    holder.store.getFullSchema.mockResolvedValue(makeDocumentSchema());
    holder.store.updateEntity.mockResolvedValue(makeEntity({ title: "T" }, "article"));

    await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article/ent-1",
      payload: { body: "longer text!" },
    });
    let [, , setProps, removeProps] = holder.store.updateEntity.mock.calls[0]!;
    expect((setProps as Record<string, unknown>)._doc_body_length).toBe(12);
    expect(removeProps).toEqual([]);

    await app.inject({
      method: "PATCH",
      url: "/api/ontologies/test_ont/runtime/lenses/doc_lens/entities/article/ent-1",
      payload: { body: null },
    });
    [, , setProps, removeProps] = holder.store.updateEntity.mock.calls[1]!;
    expect(removeProps).toEqual(["body", "_doc_body_length"]);
  });
});
