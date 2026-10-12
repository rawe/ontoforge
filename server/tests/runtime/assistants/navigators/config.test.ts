/**
 * The navigator configuration (version 1): defaults, limits, the strict
 * shape, the check against a lens (every error collected), the derived
 * default and the allowed sets a turn walks with.
 */

import { describe, expect, it } from "vitest";

import {
  allowedAnchors,
  allowedRelations,
  checkNavigator,
  deriveNavigator,
  NAVIGATOR_CONFIG_VERSION,
  NavigatorConfig,
} from "../../../../src/runtime/assistants/kinds/navigator/config.js";
import { navigator } from "../../../../src/runtime/assistants/kinds/navigator/index.js";
import { LENS } from "./fixture.js";

const DEFAULTS = { hops: 2, relationTypes: null, anchorTypes: null, maxEntities: 40, instructions: null };

describe("navigator configuration", () => {
  it("is version 1 and fills every default", () => {
    expect(NAVIGATOR_CONFIG_VERSION).toBe(1);
    expect(navigator.configVersion).toBe(1);
    expect(NavigatorConfig.parse({})).toEqual(DEFAULTS);
  });

  it("keeps hops within 1 to 3, whole numbers only", () => {
    for (const hops of [1, 2, 3]) expect(NavigatorConfig.safeParse({ hops }).success, String(hops)).toBe(true);
    for (const hops of [0, 4, 1.5, -1, "2"]) expect(NavigatorConfig.safeParse({ hops }).success, String(hops)).toBe(false);
  });

  it("keeps maxEntities within 10 to 80", () => {
    for (const maxEntities of [10, 80]) expect(NavigatorConfig.safeParse({ maxEntities }).success).toBe(true);
    for (const maxEntities of [9, 81, 40.5]) expect(NavigatorConfig.safeParse({ maxEntities }).success).toBe(false);
  });

  it("allows instructions up to 4,000 characters", () => {
    expect(NavigatorConfig.safeParse({ instructions: "x".repeat(4000) }).success).toBe(true);
    expect(NavigatorConfig.safeParse({ instructions: "x".repeat(4001) }).success).toBe(false);
    expect(NavigatorConfig.safeParse({ instructions: null }).success).toBe(true);
  });

  it("type lists are null or one to 100 keys; unknown fields are refused", () => {
    expect(NavigatorConfig.safeParse({ relationTypes: [] }).success).toBe(false);
    expect(NavigatorConfig.safeParse({ anchorTypes: [] }).success).toBe(false);
    expect(NavigatorConfig.safeParse({ relationTypes: ["x"] }).success).toBe(true);
    expect(NavigatorConfig.safeParse({ relationTypes: Array.from({ length: 101 }, (_, i) => `r${i}`) }).success).toBe(false);
    expect(NavigatorConfig.safeParse({ hops: 2, depth: 3 }).success).toBe(false);
  });
});

describe("checkNavigator", () => {
  const check = (config: Record<string, unknown>) => checkNavigator(NavigatorConfig.parse(config), LENS);

  it("a configuration naming only what the lens shows is valid", () => {
    expect(check({})).toEqual([]);
    expect(check({ relationTypes: ["manages", "works_on"], anchorTypes: ["person"] })).toEqual([]);
  });

  it("collects every unknown and every duplicated key, relation types first", () => {
    expect(check({
      relationTypes: ["manages", "ghost", "manages", "manages"],
      anchorTypes: ["person", "robot", "person"],
    })).toEqual([
      "relationTypes: the lens shows no relation type 'ghost'",
      "relationTypes: 'manages' is listed more than once",
      "anchorTypes: the lens shows no entity type 'robot'",
      "anchorTypes: 'person' is listed more than once",
    ]);
  });

  it("an entity type key is no relation type key and the other way round", () => {
    expect(check({ relationTypes: ["person"], anchorTypes: ["manages"] })).toEqual([
      "relationTypes: the lens shows no relation type 'person'",
      "anchorTypes: the lens shows no entity type 'manages'",
    ]);
  });
});

describe("the derived default", () => {
  it("is the defaults, valid against any lens", () => {
    expect(deriveNavigator()).toEqual(DEFAULTS);
    expect(navigator.derive(LENS)).toEqual(DEFAULTS);
    expect(checkNavigator(navigator.derive(LENS), LENS)).toEqual([]);
  });

  it("walks every relation and anchors every entity type the lens shows", () => {
    const config = deriveNavigator();
    expect([...allowedRelations(config, LENS)]).toEqual(["manages", "works_on", "member_of", "requires", "has_kpi"]);
    expect([...allowedAnchors(config, LENS)]).toEqual(["person", "project", "team", "skill"]);
  });

  it("a configured list narrows them", () => {
    const config = NavigatorConfig.parse({ relationTypes: ["manages"], anchorTypes: ["team"] });
    expect([...allowedRelations(config, LENS)]).toEqual(["manages"]);
    expect([...allowedAnchors(config, LENS)]).toEqual(["team"]);
  });
});
