/**
 * Runtime schema cache: lazy assembly, the four-row scoping matrix with
 * the inferred-relations rule and its cliff edge, silent skipping of dead
 * inclusion keys, and wholesale invalidation via the seam every modeling
 * mutation calls.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/core/exceptions.js";
import {
  invalidateLoadedSchemaCache,
  loadSchema,
} from "../../src/runtime/schemaCache.js";
import {
  asRuntimeStore,
  createMockRuntimeStore,
  makeFullSchema,
  makeScopedSchema,
} from "./helpers.js";

beforeEach(() => {
  invalidateLoadedSchemaCache();
});

function storeWith(schema: Record<string, unknown> | null) {
  const mock = createMockRuntimeStore();
  mock.getFullSchema.mockResolvedValue(schema);
  return mock;
}

describe("lazy assembly and reuse", () => {
  it("builds once and serves subsequent loads from the cache", async () => {
    const mock = storeWith(makeScopedSchema());
    const first = await loadSchema("hr_view", asRuntimeStore(mock));
    const second = await loadSchema("hr_view", asRuntimeStore(mock));
    expect(first.scoped.lensKey).toBe("hr_view");
    expect(second).toBe(first); // the lens is a value, held per process
    expect(mock.getFullSchema).toHaveBeenCalledTimes(1);
  });

  it("an unknown lens key answers not found", async () => {
    const mock = storeWith(null);
    await expect(loadSchema("nonexistent", asRuntimeStore(mock))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("holds both the scoped and the full schema", async () => {
    const mock = storeWith(makeScopedSchema());
    const loaded = await loadSchema("hr_view", asRuntimeStore(mock));
    // Full schema keeps everything, including what the lens hides.
    expect(Object.keys(loaded.full.entityTypes).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
    expect(Object.keys(loaded.full.entityTypes.person!.properties).sort()).toEqual([
      "active",
      "age",
      "email",
      "name",
    ]);
    // Scoped schema is the filtered subset.
    expect(Object.keys(loaded.scoped.entityTypes).sort()).toEqual(["company", "person"]);
  });
});

describe("the scoping matrix", () => {
  it("row 1 — no inclusions: all entity types, all relation types", async () => {
    const mock = storeWith(makeFullSchema({ lensKey: "full" }));
    const loaded = await loadSchema("full", asRuntimeStore(mock));
    expect(Object.keys(loaded.scoped.entityTypes).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
    expect(Object.keys(loaded.scoped.relationTypes).sort()).toEqual([
      "belongs_to",
      "works_for",
    ]);
  });

  it("row 2 — entity inclusions only: inferred relations need BOTH endpoints in scope", async () => {
    const mock = storeWith(
      makeFullSchema({
        lensKey: "lens",
        entityInclusions: [
          { key: "person", properties: null },
          { key: "company", properties: null },
        ],
      }),
    );
    const loaded = await loadSchema("lens", asRuntimeStore(mock));
    expect(Object.keys(loaded.scoped.entityTypes).sort()).toEqual(["company", "person"]);
    // works_for (person->company) is inferred; belongs_to (department->company)
    // is not — department is invisible.
    expect(Object.keys(loaded.scoped.relationTypes)).toEqual(["works_for"]);
  });

  it("row 2 — all endpoints in scope infers every relation type", async () => {
    const mock = storeWith(
      makeFullSchema({
        lensKey: "lens",
        entityInclusions: [
          { key: "person", properties: null },
          { key: "company", properties: null },
          { key: "department", properties: null },
        ],
      }),
    );
    const loaded = await loadSchema("lens", asRuntimeStore(mock));
    expect(Object.keys(loaded.scoped.relationTypes).sort()).toEqual([
      "belongs_to",
      "works_for",
    ]);
  });

  it("row 3 — relation inclusions only: ALL entity types, only included relations", async () => {
    const mock = storeWith(
      makeFullSchema({
        lensKey: "lens",
        relationInclusions: [{ key: "works_for", properties: null }],
      }),
    );
    const loaded = await loadSchema("lens", asRuntimeStore(mock));
    expect(Object.keys(loaded.scoped.entityTypes).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
    expect(Object.keys(loaded.scoped.relationTypes)).toEqual(["works_for"]);
  });

  it("row 4 — both dimensions scoped: only what is explicitly included", async () => {
    const loaded = await loadSchema(
      "hr_view",
      asRuntimeStore(storeWith(makeScopedSchema())),
    );
    expect(Object.keys(loaded.scoped.entityTypes).sort()).toEqual(["company", "person"]);
    expect(Object.keys(loaded.scoped.relationTypes)).toEqual(["works_for"]);
  });

  it("the cliff edge — the FIRST explicit relation inclusion drops every inferred one", async () => {
    // All three entity types in scope: both relation types are inferred.
    const inferred = await loadSchema(
      "before",
      asRuntimeStore(
        storeWith(
          makeFullSchema({
            lensKey: "before",
            entityInclusions: [
              { key: "person", properties: null },
              { key: "company", properties: null },
              { key: "department", properties: null },
            ],
          }),
        ),
      ),
    );
    expect(Object.keys(inferred.scoped.relationTypes).sort()).toEqual([
      "belongs_to",
      "works_for",
    ]);

    // Declaring works_for explicitly moves the lens to row 4: belongs_to
    // disappears at once, though the caller never named it.
    const explicit = await loadSchema(
      "after",
      asRuntimeStore(
        storeWith(
          makeFullSchema({
            lensKey: "after",
            entityInclusions: [
              { key: "person", properties: null },
              { key: "company", properties: null },
              { key: "department", properties: null },
            ],
            relationInclusions: [{ key: "works_for", properties: null }],
          }),
        ),
      ),
    );
    expect(Object.keys(explicit.scoped.relationTypes)).toEqual(["works_for"]);
  });

  it("a property allowlist narrows the type; absent means all properties", async () => {
    const loaded = await loadSchema(
      "hr_view",
      asRuntimeStore(storeWith(makeScopedSchema())),
    );
    expect(Object.keys(loaded.scoped.entityTypes.person!.properties).sort()).toEqual([
      "email",
      "name",
    ]);
    expect(Object.keys(loaded.scoped.entityTypes.company!.properties)).toEqual(["name"]);
  });

  it("an allowlist key that no longer resolves simply matches nothing", async () => {
    const mock = storeWith(
      makeFullSchema({
        lensKey: "lens",
        entityInclusions: [{ key: "person", properties: ["name", "ghost_prop"] }],
      }),
    );
    const loaded = await loadSchema("lens", asRuntimeStore(mock));
    expect(Object.keys(loaded.scoped.entityTypes.person!.properties)).toEqual(["name"]);
  });

  it("dead inclusion keys are skipped silently on both dimensions", async () => {
    const mock = storeWith(
      makeFullSchema({
        lensKey: "lens",
        entityInclusions: [
          { key: "person", properties: null },
          { key: "company", properties: null },
          { key: "ghost_type", properties: null },
        ],
        relationInclusions: [
          { key: "works_for", properties: null },
          { key: "ghost_relation", properties: null },
        ],
      }),
    );
    const loaded = await loadSchema("lens", asRuntimeStore(mock));
    expect(Object.keys(loaded.scoped.entityTypes).sort()).toEqual(["company", "person"]);
    expect(Object.keys(loaded.scoped.relationTypes)).toEqual(["works_for"]);
  });

  it("scope filtering never mutates the full schema", async () => {
    const loaded = await loadSchema(
      "hr_view",
      asRuntimeStore(storeWith(makeScopedSchema())),
    );
    // The scoped person was narrowed; the full person must keep all four.
    expect(Object.keys(loaded.full.entityTypes.person!.properties)).toHaveLength(4);
  });
});

describe("the cache key carries the ontology dimension", () => {
  it("the same lens key in two ontologies yields two independent entries", async () => {
    // Both ontologies hold a lens `default`, with different schemas.
    const crm = createMockRuntimeStore("crm");
    crm.getFullSchema.mockResolvedValue(makeFullSchema({ lensKey: "default" }));
    const hr = createMockRuntimeStore("hr");
    hr.getFullSchema.mockResolvedValue(
      makeFullSchema({
        lensKey: "default",
        entityInclusions: [{ key: "person", properties: ["name", "email"] }],
      }),
    );

    const fromCrm = await loadSchema("default", asRuntimeStore(crm));
    const fromHr = await loadSchema("default", asRuntimeStore(hr));

    // Each entry was built from its own store — the second load must not
    // be served from the first ontology's entry.
    expect(crm.getFullSchema).toHaveBeenCalledTimes(1);
    expect(hr.getFullSchema).toHaveBeenCalledTimes(1);
    expect(Object.keys(fromCrm.scoped.entityTypes).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
    expect(Object.keys(fromHr.scoped.entityTypes)).toEqual(["person"]);

    // Repeat loads hit each ontology's own entry.
    expect(await loadSchema("default", asRuntimeStore(crm))).toBe(fromCrm);
    expect(await loadSchema("default", asRuntimeStore(hr))).toBe(fromHr);
    expect(crm.getFullSchema).toHaveBeenCalledTimes(1);
    expect(hr.getFullSchema).toHaveBeenCalledTimes(1);
  });
});

describe("wholesale invalidation via the modeling seam", () => {
  it("a modeling mutation clears the WHOLE cache", async () => {
    const hrMock = storeWith(makeScopedSchema());
    const fullMock = storeWith(makeFullSchema({ lensKey: "full_lens" }));

    await loadSchema("hr_view", asRuntimeStore(hrMock));
    await loadSchema("full_lens", asRuntimeStore(fullMock));
    expect(hrMock.getFullSchema).toHaveBeenCalledTimes(1);
    expect(fullMock.getFullSchema).toHaveBeenCalledTimes(1);

    // What every mutating modeling service path calls.
    invalidateLoadedSchemaCache();

    await loadSchema("hr_view", asRuntimeStore(hrMock));
    await loadSchema("full_lens", asRuntimeStore(fullMock));
    expect(hrMock.getFullSchema).toHaveBeenCalledTimes(2);
    expect(fullMock.getFullSchema).toHaveBeenCalledTimes(2);
  });

  it("a real modeling service write invalidates the cache", async () => {
    const runtimeMock = storeWith(makeScopedSchema());
    await loadSchema("hr_view", asRuntimeStore(runtimeMock));
    await loadSchema("hr_view", asRuntimeStore(runtimeMock));
    expect(runtimeMock.getFullSchema).toHaveBeenCalledTimes(1);

    const { createMockModelingStore, asModelingStore, NOW } = await import(
      "../modeling/helpers.js"
    );
    const modelingService = await import("../../src/modeling/service.js");
    const modelingMock = createMockModelingStore();
    modelingMock.createLens.mockResolvedValue({
      lensId: "lens-2",
      key: "new_view",
      name: "New View",
      description: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await modelingService.createLens(
      { key: "new_view", name: "New View", description: null },
      asModelingStore(modelingMock),
    );

    await loadSchema("hr_view", asRuntimeStore(runtimeMock));
    expect(runtimeMock.getFullSchema).toHaveBeenCalledTimes(2);
  });
});
