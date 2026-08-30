/**
 * The Neo4j adapter module surface: `createRegistry` hands out the real
 * capped registry, and `ensureSemanticIndexes` covers every ontology the
 * registry lists — zero ontologies means it touches nothing (port
 * contract, `core/ports.ts`).
 */

import type { Driver } from "neo4j-driver";
import { describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const queries: string[] = [];
let respond: (query: string) => Row[] = () => [];

vi.mock("../../../src/adapters/neo4j/driver.js", () => ({
  getDriver: (): Driver =>
    ({
      session: () => ({
        run: async (query: string) => {
          queries.push(query);
          return {
            records: respond(query).map((row) => ({
              get: (key: string) => row[key],
            })),
          };
        },
        close: async () => undefined,
      }),
    }) as unknown as Driver,
  initDriver: async () => undefined,
  closeDriver: async () => undefined,
}));

const adapter = await import("../../../src/adapters/neo4j/index.js");

describe("ensureSemanticIndexes", () => {
  it("does nothing when the registry holds no ontology", async () => {
    queries.length = 0;
    respond = () => [{ registered: 0 }];

    await adapter.ensureSemanticIndexes(768);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("_OntologyRegistry");
  });

  it("ensures the graph's indexes when the one ontology exists", async () => {
    queries.length = 0;
    respond = (query) => (query.includes("_OntologyRegistry") ? [{ registered: 1 }] : []);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await adapter.ensureSemanticIndexes(768);
    } finally {
      infoSpy.mockRestore();
    }

    expect(queries.some((q) => q.includes("CREATE VECTOR INDEX entity_embedding"))).toBe(
      true,
    );
    expect(
      queries.some((q) => q.includes("CREATE VECTOR INDEX saved_query_embedding")),
    ).toBe(true);
  });
});

describe("createRegistry", () => {
  it("hands out the capped registry, backed by the driver", async () => {
    queries.length = 0;
    respond = () => [];

    const registry = adapter.createRegistry();
    expect(await registry.getOntology("crm")).toBeNull();
    expect(queries[0]).toContain("_OntologyRegistry");
  });
});
