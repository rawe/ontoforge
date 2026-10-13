/**
 * The navigator's runtime: its topology, checking a stored configuration
 * (version, shape, the navigator's own check), the runtime list with the
 * built-in default first, and loading the navigator a request names —
 * derived, stored and valid, unknown, or invalid in its lens.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "../../../../src/core/exceptions.js";
import { NAVIGATOR_DEFAULT_DESCRIPTION, NAVIGATOR_TOPOLOGY } from "../../../../src/runtime/assistants/navigators/index.js";
import {
  checkStoredNavigator,
  DEFAULT_NAVIGATOR_KEY,
  listRuntimeNavigators,
  loadRunnableNavigator,
} from "../../../../src/runtime/assistants/navigators/runtime.js";
import { invalidateLoadedSchemaCache } from "../../../../src/runtime/schemaCache.js";
import { asRuntimeStore, createMockRuntimeStore, makeFullSchema, makeScopedSchema, NOW } from "../../helpers.js";
import { LENS } from "./fixture.js";

const DEFAULTS = { hops: 2, relationTypes: null, anchorTypes: null, maxEntities: 40, instructions: null };
const stored = (key: string, config: unknown, configVersion = 1, name = key) => ({
  navigatorId: `id-${key}`, key, name, description: `About ${key}`, configVersion, config, createdAt: NOW, updatedAt: NOW,
});

beforeEach(() => {
  invalidateLoadedSchemaCache();
});

describe("the topology", () => {
  it("is the contract's", () => {
    expect(NAVIGATOR_TOPOLOGY.steps.map((s) => [s.id, s.label, s.model])).toEqual([
      ["understand", "Understand", true],
      ["anchor", "Anchor", false],
      ["walk", "Walk", false],
      ["focus", "Focus", false],
      ["answer", "Answer", true],
    ]);
    expect(NAVIGATOR_TOPOLOGY.edges).toEqual([
      { from: "understand", to: "anchor" },
      { from: "anchor", to: "walk" },
      { from: "walk", to: "focus" },
      { from: "walk", to: "walk", label: "widen: not everything asked for was reached" },
      { from: "focus", to: "answer" },
    ]);
  });
});

describe("checkStoredNavigator", () => {
  it("refuses another configuration version before reading the configuration", () => {
    for (const version of [2, 0, "1", null, undefined]) {
      expect(checkStoredNavigator(version, { hops: 99 }, LENS), String(version)).toEqual({
        config: null,
        errors: [`Configuration version ${String(version)} is not supported; this release runs version 1`],
      });
    }
  });

  it("reports shape errors by path", () => {
    const { config, errors } = checkStoredNavigator(1, { hops: 4, maxEntities: 5, extra: true }, LENS);
    expect(config).toBeNull();
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.startsWith("hops: "))).toBe(true);
    expect(errors.some((e) => e.startsWith("maxEntities: "))).toBe(true);
    expect(errors.some((e) => e.includes("extra"))).toBe(true);
    expect(checkStoredNavigator(1, "nope", LENS).config).toBeNull();
  });

  it("reports the navigator's own errors against the lens", () => {
    expect(checkStoredNavigator(1, { relationTypes: ["ghost"] }, LENS)).toEqual({
      config: null,
      errors: ["relationTypes: the lens shows no relation type 'ghost'"],
    });
  });

  it("a valid configuration comes back parsed, defaults filled", () => {
    expect(checkStoredNavigator(1, { hops: 3 }, LENS)).toEqual({ config: { ...DEFAULTS, hops: 3 }, errors: [] });
  });
});

describe("listRuntimeNavigators", () => {
  it("names the built-in default first, then the stored ones without validating them", async () => {
    const store = createMockRuntimeStore();
    store.getFullSchemaWithLensInclusions.mockResolvedValue(makeFullSchema({ lensKey: "main" }));
    store.navigatorStore.listNavigators.mockResolvedValue([
      stored("broken", { relationTypes: ["ghost"] }, 7, "Broken"),
      stored("walker", {}, 1, "Walker"),
    ]);
    expect(await listRuntimeNavigators("main", asRuntimeStore(store))).toEqual([
      { key: "_default", name: "Default", description: NAVIGATOR_DEFAULT_DESCRIPTION, builtIn: true },
      { key: "broken", name: "Broken", description: "About broken", builtIn: false },
      { key: "walker", name: "Walker", description: "About walker", builtIn: false },
    ]);
    expect(store.navigatorStore.listNavigators).toHaveBeenCalledWith("lens-1");
  });

  it("an unknown lens is not found", async () => {
    const store = createMockRuntimeStore();
    await expect(listRuntimeNavigators("nope", asRuntimeStore(store))).rejects.toThrow(NotFoundError);
  });
});

describe("loadRunnableNavigator", () => {
  function store() {
    const s = createMockRuntimeStore();
    s.getFullSchemaWithLensInclusions.mockResolvedValue(makeScopedSchema());
    return s;
  }

  it("derives the default from the lens without reading the store", async () => {
    const s = store();
    const runnable = await loadRunnableNavigator("hr_view", DEFAULT_NAVIGATOR_KEY, asRuntimeStore(s));
    expect(runnable.key).toBe("_default");
    expect(runnable.config).toEqual(DEFAULTS);
    expect(Object.keys(runnable.loaded.scoped.entityTypes).sort()).toEqual(["company", "person"]);
    expect(s.navigatorStore.getNavigator).not.toHaveBeenCalled();
  });

  it("loads a stored navigator checked against the scoped lens", async () => {
    const s = store();
    s.navigatorStore.getNavigator.mockResolvedValue(stored("walker", { relationTypes: ["works_for"], hops: 1 }));
    const runnable = await loadRunnableNavigator("hr_view", "walker", asRuntimeStore(s));
    expect(runnable.config).toEqual({ ...DEFAULTS, hops: 1, relationTypes: ["works_for"] });
    expect(s.navigatorStore.getNavigator).toHaveBeenCalledWith("lens-1", "walker");
  });

  it("an unknown navigator is not found", async () => {
    const s = store();
    await expect(loadRunnableNavigator("hr_view", "ghost", asRuntimeStore(s))).rejects.toThrow("Navigator 'ghost' not found");
  });

  it("a navigator the lens can no longer run is a validation error carrying every error", async () => {
    const s = store();
    // belongs_to and department exist in the schema but the scoped lens hides them.
    s.navigatorStore.getNavigator.mockResolvedValue(stored("walker", { relationTypes: ["belongs_to"], anchorTypes: ["department"] }));
    const error = await loadRunnableNavigator("hr_view", "walker", asRuntimeStore(s)).catch((e: unknown) => e);
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
