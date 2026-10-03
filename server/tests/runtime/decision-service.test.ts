import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDecisionModel, type ChoiceAnswer } from "../../src/core/decision.js";
import { compareEntities, type PropertySnapshot } from "../../src/runtime/decisionService.js";
import { invalidateLoadedSchemaCache } from "../../src/runtime/schemaCache.js";
import { createMockRuntimeStore, makeFullSchema, makeScopedSchema } from "./helpers.js";

const answer: ChoiceAnswer = {
  type: "choice", choice: "insufficient",
  probabilities: { same: 0.2, different: 0.1, insufficient: 0.7 }, confidence: 0.7,
};
const decide = vi.fn(async (_state: unknown, _questions: unknown, _signal?: AbortSignal) => ({ identity: answer }));
let store = createMockRuntimeStore();
const compare = (left: PropertySnapshot = { name: "Bosch" }, right: PropertySnapshot = { name: "Robert Bosch" }) =>
  compareEntities("test_lens", { entityTypeKey: "person", left, right }, store);

beforeEach(() => {
  store = createMockRuntimeStore();
  store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "test_lens" }));
  invalidateLoadedSchemaCache();
  decide.mockReset().mockResolvedValue({ identity: answer });
  setDecisionModel({ decide });
});
afterEach(() => setDecisionModel(null));

describe("identity comparison", () => {
  it("uses one fixed choice question and returns its probabilities without executing data or search operations", async () => {
    expect(await compare()).toEqual({ decision: "insufficient", probabilities: answer.probabilities,
      confidence: 0.7, truncatedFields: [] });
    expect(decide).toHaveBeenCalledTimes(1);
    const [state, questions] = decide.mock.calls[0]!;
    expect(state).toMatchObject({ schema: { entityTypeKey: "person", displayName: "Person",
      properties: { name: { dataType: "string", displayName: "Name" } } },
      left: { name: "Bosch" }, right: { name: "Robert Bosch" } });
    expect(questions).toMatchObject({ identity: { type: "choice",
      criteria: { same: expect.any(String), different: expect.any(String), insufficient: expect.any(String) },
      instructions: expect.stringContaining("Missing or null values are unknown") } });
    expect(store.getEntity).not.toHaveBeenCalled();
    expect(store.createEntity).not.toHaveBeenCalled();
    expect(store.updateEntity).not.toHaveBeenCalled();
    expect(store.propertySearchSemantic).not.toHaveBeenCalled();
    expect(store.propertySearchKeyword).not.toHaveBeenCalled();
  });

  it("rejects a disabled provider before loading context", async () => {
    setDecisionModel(null);
    await expect(compare()).rejects.toMatchObject({ details: { code: "FEATURE_DISABLED" } });
    expect(store.getFullSchemaWithLensInclusions).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("allows empty, missing required properties, null and uncoerced scalar values without applying defaults", async () => {
    await compare({}, { email: null, age: 42, active: false });
    expect(decide.mock.calls[0]![0]).toMatchObject({ left: {}, right: { email: null, age: 42, active: false } });
    expect(JSON.stringify(decide.mock.calls[0]![0])).not.toContain("defaultValue");
  });

  it.each(["not_a_property", "_id", "constructor", "toString", "__proto__"])("rejects non-schema field %s", async (key) => {
    await expect(compare(Object.fromEntries([[key, "x"]]))).rejects.toMatchObject({
      details: { fields: { [`left.${key}`]: expect.any(String) } },
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects unknown and out-of-scope types", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeScopedSchema());
    for (const entityTypeKey of ["department", "missing", "constructor"]) {
      await expect(compareEntities("hr_view", { entityTypeKey, left: {}, right: {} }, store))
        .rejects.toMatchObject({ name: "NotFoundError" });
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects hidden fields on both sides and does not send hidden definitions", async () => {
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeScopedSchema());
    await expect(compareEntities("hr_view", { entityTypeKey: "person", left: { age: 40 }, right: { active: true } }, store))
      .rejects.toMatchObject({ details: { fields: { "left.age": expect.any(String), "right.active": expect.any(String) } } });
    await compareEntities("hr_view", { entityTypeKey: "person", left: { name: "A" }, right: {} }, store);
    expect(JSON.stringify(decide.mock.calls[0]![0])).not.toContain('"age"');
  });

  it("rejects document fields, even when their snapshot value is null", async () => {
    const schema = makeFullSchema({ lensKey: "test_lens" });
    const person = (schema.entityTypes as Record<string, unknown>[])[0]!;
    (person.properties as Record<string, unknown>[]).push({ key: "body", displayName: "Body", dataType: "document", required: false });
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    await expect(compare({ body: null })).rejects.toMatchObject({ details: { fields: {
      "left.body": "Document properties cannot be compared",
    } } });
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects arrays/objects and non-finite numbers even through the service seam", async () => {
    for (const value of [[], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(compare({ name: value } as unknown as PropertySnapshot)).rejects.toMatchObject({ name: "ValidationError" });
    }
  });

  it("uses the first 500 Unicode code points and reports every truncated data/schema path", async () => {
    const schema = makeFullSchema({ lensKey: "test_lens" });
    const person = (schema.entityTypes as Record<string, unknown>[])[0]!;
    person.description = "x".repeat(501);
    const name = (person.properties as Record<string, unknown>[])[0]!;
    name.description = "y".repeat(501);
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    const result = await compare({ name: "😀".repeat(501) }, { name: "r".repeat(501) });
    expect(result.truncatedFields).toEqual(["schema.description", "schema.properties.name.description", "left.name", "right.name"]);
    expect(decide.mock.calls[0]![0]).toMatchObject({ left: { name: "😀".repeat(500) }, right: { name: "r".repeat(500) } });
  });

  it("preserves exactly 500 code points without reporting truncation", async () => {
    expect((await compare({ name: "😀".repeat(500) })).truncatedFields).toEqual([]);
  });

  it("rejects prepared contexts above 16 KiB UTF-8 before a provider call", async () => {
    const schema = makeFullSchema({ lensKey: "test_lens" });
    const person = (schema.entityTypes as Record<string, unknown>[])[0]!;
    const values: PropertySnapshot = {};
    for (let n = 0; n < 9; n++) {
      const key = `field_${n}`;
      (person.properties as Record<string, unknown>[]).push({ key, displayName: key, dataType: "string", required: false });
      values[key] = "😀".repeat(500);
    }
    store.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    await expect(compare(values, {})).rejects.toThrow("exceeds 16 KiB");
    expect(decide).not.toHaveBeenCalled();
  });

  it("passes cancellation into the provider and prevents already-cancelled work", async () => {
    const controller = new AbortController();
    await compareEntities("test_lens", { entityTypeKey: "person", left: {}, right: {} }, store, controller.signal);
    expect(decide.mock.calls[0]![2]).toBe(controller.signal);
    decide.mockClear();
    controller.abort();
    await expect(compareEntities("test_lens", { entityTypeKey: "person", left: {}, right: {} }, store, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not return a judgment after cancellation during the provider call", async () => {
    const controller = new AbortController();
    decide.mockImplementationOnce(async () => { controller.abort(); return { identity: answer }; });
    await expect(compareEntities("test_lens", { entityTypeKey: "person", left: {}, right: {} }, store, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates provider failures without retry or fallback", async () => {
    decide.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(compare()).rejects.toThrow("provider unavailable");
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("uses the supplied ontology store for schema loading", async () => {
    await compare();
    const other = createMockRuntimeStore("another_ontology");
    const schema = makeFullSchema({ lensKey: "test_lens" });
    (schema.entityTypes as Record<string, unknown>[])[0]!.displayName = "Other Person";
    other.getFullSchemaWithLensInclusions.mockResolvedValue(schema);
    await compareEntities("test_lens", { entityTypeKey: "person", left: {}, right: {} }, other);
    expect(decide.mock.calls[1]![0]).toMatchObject({ schema: { displayName: "Other Person" } });
    expect(other.getFullSchemaWithLensInclusions).toHaveBeenCalledTimes(1);
  });
});
