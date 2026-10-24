/**
 * Runtime schema cache: lazy assembly, the four-row scoping matrix with
 * the inferred-relations rule and its cliff edge, silent skipping of dead
 * inclusion keys, and the design revision every use checks.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/core/exceptions.js";
import {
  cachedEntryCounts,
  invalidateLoadedSchemaCache,
  loadSchema,
} from "../../src/runtime/schemaCache.js";
import { TEST_DESIGN } from "../mockSearchIndexStore.js";
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
  mock.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
  return mock;
}

describe("lazy assembly and reuse", () => {
  it("builds once and serves subsequent loads from the cache", async () => {
    const mock = storeWith(makeScopedSchema());
    const first = await loadSchema("hr_view", asRuntimeStore(mock));
    const second = await loadSchema("hr_view", asRuntimeStore(mock));
    expect(first.scoped.lensKey).toBe("hr_view");
    expect(second).toBe(first); // the lens is a value, held per process
    expect(mock.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
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

  it("row 4 — a relation inclusion whose endpoint type the lens hides is skipped", async () => {
    // belongs_to is department -> company; department is not included.
    const loaded = await loadSchema(
      "lens",
      asRuntimeStore(
        storeWith(
          makeFullSchema({
            lensKey: "lens",
            entityInclusions: [
              { key: "person", properties: null },
              { key: "company", properties: null },
            ],
            relationInclusions: [
              { key: "works_for", properties: null },
              { key: "belongs_to", properties: null },
            ],
          }),
        ),
      ),
    );
    expect(Object.keys(loaded.scoped.relationTypes)).toEqual(["works_for"]);
    expect(Object.keys(loaded.full.relationTypes).sort()).toEqual(["belongs_to", "works_for"]);
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

  it("the name property shows through a lens that exposes it, and is null where the lens hides it", async () => {
    const mock = storeWith(
      makeFullSchema({
        lensKey: "lens",
        entityInclusions: [
          { key: "person", properties: ["email"] },
          { key: "company", properties: null },
        ],
      }),
    );
    const loaded = await loadSchema("lens", asRuntimeStore(mock));
    expect(loaded.scoped.entityTypes.person!.nameProperty).toBeNull();
    expect(loaded.scoped.entityTypes.company!.nameProperty).toBe("name");
    expect(loaded.full.entityTypes.person!.nameProperty).toBe("name");
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
    crm.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "default" }));
    const hr = createMockRuntimeStore("hr");
    hr.getFullSchemaWithLensInclusions.mockResolvedValue(
      makeFullSchema({
        lensKey: "default",
        entityInclusions: [{ key: "person", properties: ["name", "email"] }],
      }),
    );

    const fromCrm = await loadSchema("default", asRuntimeStore(crm));
    const fromHr = await loadSchema("default", asRuntimeStore(hr));

    // Each entry was built from its own store — the second load must not
    // be served from the first ontology's entry.
    expect(crm.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
    expect(hr.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
    expect(Object.keys(fromCrm.scoped.entityTypes).sort()).toEqual([
      "company",
      "department",
      "person",
    ]);
    expect(Object.keys(fromHr.scoped.entityTypes)).toEqual(["person"]);

    // Repeat loads hit each ontology's own entry.
    expect(await loadSchema("default", asRuntimeStore(crm))).toBe(fromCrm);
    expect(await loadSchema("default", asRuntimeStore(hr))).toBe(fromHr);
    expect(crm.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
    expect(hr.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
  });
});

describe("design revisions", () => {
  const design = (revision: number, ontologyId = TEST_DESIGN.ontologyId) => ({ ontologyId, revision });

  /** A promise and the function that settles it. */
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  it("serves an entry while the revision holds and reloads once it moved", async () => {
    const mock = storeWith(makeScopedSchema());
    await loadSchema("hr_view", asRuntimeStore(mock));
    await loadSchema("hr_view", asRuntimeStore(mock));
    expect(mock.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
    expect(mock.designRevision).toHaveBeenCalledTimes(2);

    // Another process changed the design: no signal, only the revision.
    mock.designRevision.mockResolvedValue(design(2));
    mock.getFullSchemaWithLensInclusions.mockResolvedValue({ ...makeScopedSchema(), design: design(2) });
    const reloaded = await loadSchema("hr_view", asRuntimeStore(mock));
    expect(reloaded.design).toEqual(design(2));
    expect(mock.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(2);
    expect(await loadSchema("hr_view", asRuntimeStore(mock))).toBe(reloaded);
  });

  it("a revision passed in is used without reading it", async () => {
    const mock = storeWith(makeScopedSchema());
    await loadSchema("hr_view", asRuntimeStore(mock), TEST_DESIGN);
    expect(mock.designRevision).not.toHaveBeenCalled();
  });

  it("an ontology created again under its key is never served its predecessor's entry", async () => {
    const mock = storeWith(makeScopedSchema());
    await loadSchema("hr_view", asRuntimeStore(mock));

    // Same key, same lens key, revision 1 again — another ontology id.
    const successor = design(1, "00000000-0000-4000-8000-000000000002");
    mock.designRevision.mockResolvedValue(successor);
    mock.getFullSchemaWithLensInclusions.mockResolvedValue({ ...makeFullSchema(), design: successor });
    const loaded = await loadSchema("hr_view", asRuntimeStore(mock));
    expect(loaded.design).toEqual(successor);
    expect(Object.keys(loaded.scoped.entityTypes)).toEqual(["person", "company", "department"]);
  });

  it("a slower fill of an older revision never replaces a newer entry", async () => {
    const mock = storeWith(null);
    const slow = deferred<Record<string, unknown>>();
    // The first fill reads revision 1 and stalls; a second, of revision 2,
    // finishes first.
    mock.designRevision.mockResolvedValueOnce(design(1)).mockResolvedValue(design(2));
    mock.getFullSchemaWithLensInclusions
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ ...makeFullSchema(), design: design(2) });

    const older = loadSchema("hr_view", asRuntimeStore(mock));
    const newer = await loadSchema("hr_view", asRuntimeStore(mock));
    expect(newer.design).toEqual(design(2));

    slow.resolve({ ...makeScopedSchema(), design: design(1) });
    expect((await older).design).toEqual(design(1));

    // Revision 2 is still served from the cache.
    expect(await loadSchema("hr_view", asRuntimeStore(mock))).toBe(newer);
    expect(mock.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(2);
  });

  it("holds at most 512 lenses, dropping the least recently used", async () => {
    const mock = createMockRuntimeStore();
    mock.getFullSchemaWithLensInclusions.mockImplementation(async (lensKey: string) =>
      makeFullSchema({ lensKey }));
    const first = await loadSchema("lens_0", asRuntimeStore(mock));
    for (let i = 1; i < 512; i++) await loadSchema(`lens_${i}`, asRuntimeStore(mock));
    expect(cachedEntryCounts().lenses).toBe(512);

    // A hit makes lens_0 the most recent; lens_1 is now the oldest.
    expect(await loadSchema("lens_0", asRuntimeStore(mock))).toBe(first);
    await loadSchema("lens_512", asRuntimeStore(mock));
    expect(cachedEntryCounts().lenses).toBe(512);
    expect(await loadSchema("lens_0", asRuntimeStore(mock))).toBe(first);
    const calls = mock.getFullSchemaWithLensInclusions.mock.calls.length;
    await loadSchema("lens_1", asRuntimeStore(mock));
    expect(mock.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(calls + 1);
  });
});
