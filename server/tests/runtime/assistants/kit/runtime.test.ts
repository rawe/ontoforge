/**
 * The kit's runtime over the registry: checking a stored configuration
 * (version, shape, the kind's own check), the runtime list with the
 * built-in default first, and loading the assistant a request names —
 * derived, stored and valid, unknown, or invalid in its lens.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "../../../../src/core/exceptions.js";
import { ASSISTANT_KIND_KEYS } from "../../../../src/core/assistant.js";
import { ASSISTANT_KINDS, assistantKind } from "../../../../src/runtime/assistants/kinds/index.js";
import { navigator } from "../../../../src/runtime/assistants/kinds/navigator/index.js";
import {
  checkAssistant,
  DEFAULT_ASSISTANT_KEY,
  listRuntimeAssistants,
  loadRunnable,
} from "../../../../src/runtime/assistants/kit/runtime.js";
import { invalidateLoadedSchemaCache } from "../../../../src/runtime/schemaCache.js";
import { asRuntimeStore, createMockRuntimeStore, makeFullSchema, makeScopedSchema, NOW } from "../../helpers.js";
import { LENS } from "../navigators/fixture.js";

const DEFAULTS = { hops: 2, relationTypes: null, anchorTypes: null, maxEntities: 40, instructions: null };
const stored = (key: string, config: unknown, configVersion = 1, name = key) => ({
  assistantId: `id-${key}`, kind: "navigators", key, name, description: `About ${key}`, configVersion, config, createdAt: NOW, updatedAt: NOW,
});

beforeEach(() => {
  invalidateLoadedSchemaCache();
});

describe("the registry", () => {
  it("serves the navigator under its route segment, in step with the kind keys", () => {
    expect(ASSISTANT_KINDS.map((kind) => kind.kind)).toEqual([...ASSISTANT_KIND_KEYS]);
    expect(assistantKind("navigators")).toBe(navigator);
    expect([navigator.event, navigator.noun]).toEqual(["navigator", "Navigator"]);
    expect(() => assistantKind("analysts" as never)).toThrow("not registered");
  });

  it("the navigator's topology is the contract's", () => {
    expect(navigator.topology.steps.map((s) => [s.id, s.label, s.model])).toEqual([
      ["understand", "Understand", true],
      ["anchor", "Anchor", false],
      ["walk", "Walk", false],
      ["focus", "Focus", false],
      ["answer", "Answer", true],
    ]);
    expect(navigator.topology.edges).toEqual([
      { from: "understand", to: "anchor" },
      { from: "anchor", to: "walk" },
      { from: "walk", to: "focus" },
      { from: "walk", to: "walk", label: "widen: not everything asked for was reached" },
      { from: "focus", to: "answer" },
    ]);
  });
});

describe("checkAssistant", () => {
  it("refuses another configuration version before reading the configuration", () => {
    for (const version of [2, 0, "1", null, undefined]) {
      expect(checkAssistant(navigator, version, { hops: 99 }, LENS), String(version)).toEqual({
        config: null,
        errors: [`Configuration version ${String(version)} is not supported; this release runs version 1`],
      });
    }
  });

  it("reports shape errors by path", () => {
    const { config, errors } = checkAssistant(navigator, 1, { hops: 4, maxEntities: 5, extra: true }, LENS);
    expect(config).toBeNull();
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.startsWith("hops: "))).toBe(true);
    expect(errors.some((e) => e.startsWith("maxEntities: "))).toBe(true);
    expect(errors.some((e) => e.includes("extra"))).toBe(true);
    expect(checkAssistant(navigator, 1, "nope", LENS).config).toBeNull();
  });

  it("reports the kind's own errors against the lens", () => {
    expect(checkAssistant(navigator, 1, { relationTypes: ["ghost"] }, LENS)).toEqual({
      config: null,
      errors: ["relationTypes: the lens shows no relation type 'ghost'"],
    });
  });

  it("a valid configuration comes back parsed, defaults filled", () => {
    expect(checkAssistant(navigator, 1, { hops: 3 }, LENS)).toEqual({ config: { ...DEFAULTS, hops: 3 }, errors: [] });
  });
});

describe("listRuntimeAssistants", () => {
  it("names the built-in default first, then the stored ones without validating them", async () => {
    const store = createMockRuntimeStore();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "main" }));
    store.assistantStore.listAssistants.mockResolvedValue([
      stored("broken", { relationTypes: ["ghost"] }, 7, "Broken"),
      stored("walker", {}, 1, "Walker"),
    ]);
    expect(await listRuntimeAssistants(navigator, "main", asRuntimeStore(store))).toEqual([
      { key: "_default", name: "Default", description: navigator.defaultDescription, builtIn: true },
      { key: "broken", name: "Broken", description: "About broken", builtIn: false },
      { key: "walker", name: "Walker", description: "About walker", builtIn: false },
    ]);
    expect(store.assistantStore.listAssistants).toHaveBeenCalledWith("lens-1", "navigators");
  });

  it("an unknown lens is not found", async () => {
    const store = createMockRuntimeStore();
    await expect(listRuntimeAssistants(navigator, "nope", asRuntimeStore(store))).rejects.toThrow(NotFoundError);
  });
});

describe("loadRunnable", () => {
  function store() {
    const s = createMockRuntimeStore();
    s.getFullSchemaWithLensInclusions.mockResolvedValue(makeScopedSchema());
    return s;
  }

  it("derives the default from the lens without reading the store", async () => {
    const s = store();
    const runnable = await loadRunnable(navigator, "hr_view", DEFAULT_ASSISTANT_KEY, asRuntimeStore(s));
    expect(runnable.key).toBe("_default");
    expect(runnable.config).toEqual(DEFAULTS);
    expect(Object.keys(runnable.loaded.scoped.entityTypes).sort()).toEqual(["company", "person"]);
    expect(s.assistantStore.getAssistant).not.toHaveBeenCalled();
  });

  it("loads a stored navigator checked against the scoped lens", async () => {
    const s = store();
    s.assistantStore.getAssistant.mockResolvedValue(stored("walker", { relationTypes: ["works_for"], hops: 1 }));
    const runnable = await loadRunnable(navigator, "hr_view", "walker", asRuntimeStore(s));
    expect(runnable.config).toEqual({ ...DEFAULTS, hops: 1, relationTypes: ["works_for"] });
    expect(s.assistantStore.getAssistant).toHaveBeenCalledWith("lens-1", "navigators", "walker");
  });

  it("an unknown navigator is not found", async () => {
    const s = store();
    await expect(loadRunnable(navigator, "hr_view", "ghost", asRuntimeStore(s))).rejects.toThrow("Navigator 'ghost' not found");
  });

  it("a navigator the lens can no longer run is a validation error carrying every error", async () => {
    const s = store();
    // belongs_to and department exist in the schema but the scoped lens hides them.
    s.assistantStore.getAssistant.mockResolvedValue(stored("walker", { relationTypes: ["belongs_to"], anchorTypes: ["department"] }));
    const error = await loadRunnable(navigator, "hr_view", "walker", asRuntimeStore(s)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(
      "Navigator 'walker' is invalid in this lens: relationTypes: the lens shows no relation type 'belongs_to'; " +
        "anchorTypes: the lens shows no entity type 'department'",
    );
    expect((error as ValidationError).details).toEqual({
      errors: [
        "relationTypes: the lens shows no relation type 'belongs_to'",
        "anchorTypes: the lens shows no entity type 'department'",
      ],
    });
  });
});
