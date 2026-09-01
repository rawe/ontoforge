/**
 * Startup maintenance walks the registry: the reserved-key report runs
 * once per registered ontology, against a store bound to it, and a
 * server with zero ontologies has nothing to check — the walk completes
 * without touching any store.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registryHolder: { ontologies: Record<string, unknown>[] } = { ontologies: [] };
const collisionsByOntology: Record<string, { kind: string; key: string }[]> = {};
const boundStoreRequests: string[] = [];

vi.mock("../../src/core/ports.js", () => ({
  getOntologyRegistry: () => ({
    listOntologies: async () => registryHolder.ontologies,
  }),
  getModelingStore: async (ontologyKey: string) => {
    boundStoreRequests.push(ontologyKey);
    return {
      findReservedTypeKeysInUse: async () => collisionsByOntology[ontologyKey] ?? [],
    };
  },
}));

let warnings: string[];
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  registryHolder.ontologies = [];
  for (const key of Object.keys(collisionsByOntology)) {
    delete collisionsByOntology[key];
  }
  boundStoreRequests.length = 0;
  warnings = [];
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("warnAboutReservedTypeKeysInUse", () => {
  it("checks every registered ontology through its own bound store", async () => {
    registryHolder.ontologies = [{ key: "crm" }, { key: "hr" }];
    collisionsByOntology.crm = [{ kind: "EntityType", key: "entity" }];
    collisionsByOntology.hr = [{ kind: "RelationType", key: "relation" }];

    const { warnAboutReservedTypeKeysInUse } = await import("../../src/main.js");
    await warnAboutReservedTypeKeysInUse();

    expect(boundStoreRequests.sort()).toEqual(["crm", "hr"]);
    expect(warnings).toHaveLength(2);
    const joined = warnings.join("\n");
    expect(joined).toContain("'entity' in ontology 'crm'");
    expect(joined).toContain("'relation' in ontology 'hr'");
  });

  it("with zero ontologies there is nothing to check and no warning", async () => {
    const { warnAboutReservedTypeKeysInUse } = await import("../../src/main.js");
    await warnAboutReservedTypeKeysInUse();

    expect(boundStoreRequests).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("a clean ontology produces no warning", async () => {
    registryHolder.ontologies = [{ key: "crm" }];

    const { warnAboutReservedTypeKeysInUse } = await import("../../src/main.js");
    await warnAboutReservedTypeKeysInUse();

    expect(boundStoreRequests).toEqual(["crm"]);
    expect(warnings).toEqual([]);
  });
});
