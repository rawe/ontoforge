/**
 * How the Valkey thread store reads a thread hash's binding: the scope
 * decides the lens key, and a hash written before scopes is a lens's. The
 * Lua side runs against a real Valkey (`tests/integration/valkey/`).
 */

import { describe, expect, it } from "vitest";

import { storedBinding } from "../../../src/adapters/valkey/threadStore.js";

// ontologyKey, scope, lensKey, kind, assistantKey, owner
const fields = (scope: string | null, lensKey: string | null, owner: string | null = "") =>
  ["fair", scope, lensKey, "agents", "guide", owner];

describe("a thread hash's binding", () => {
  it("is a lens's without a scope, as written before ontology-scoped threads", () => {
    expect(storedBinding(fields(null, "visitor"))).toEqual({
      ontologyKey: "fair", lensKey: "visitor", kind: "agents", assistantKey: "guide", owner: null,
    });
  });

  it("names its lens with the lens scope, none with the ontology scope", () => {
    expect(storedBinding(fields("lens", "visitor", "p1"))?.lensKey).toBe("visitor");
    expect(storedBinding(fields("lens", "visitor", "p1"))?.owner).toBe("p1");
    expect(storedBinding(fields("ontology", ""))?.lensKey).toBeNull();
  });

  it("is incomplete for a lens without a key, an ontology scope with one, or an unknown scope", () => {
    expect(storedBinding(fields("lens", ""))).toBeNull();
    expect(storedBinding(fields(null, null))).toBeNull();
    expect(storedBinding(fields("ontology", "visitor"))).toBeNull();
    expect(storedBinding(fields("elsewhere", "visitor"))).toBeNull();
    expect(storedBinding(["fair", null, "visitor", null, "guide", ""])).toBeNull();
  });
});
