import type { Driver } from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { checkRetrieverStorageReady, ensureRetrieverStorage, inspectRetrieverStorage } from "../../../src/adapters/neo4j/retrieverStorage.js";
function fixture(initial: Record<string, unknown>[] = []) {
  const rows = [...initial]; const statements: string[] = [];
  const driver = { session: () => ({
    run: async (query: string) => {
      statements.push(query);
      if (query.startsWith("CREATE CONSTRAINT")) {
        const name = query.includes("owner_key") ? "retriever_config_owner_key_unique" : "retriever_config_id_unique";
        if (!rows.some(row => row.name === name)) rows.push({ name, type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["_RetrieverConfig"], properties: name.includes("owner_key") ? ["ownerLensId", "key"] : ["retrieverConfigId"] });
      }
      return { records: query.startsWith("SHOW") ? rows.map(row => ({ get: (key: string) => row[key] })) : [] };
    }, close: async () => undefined,
  }) } as unknown as Driver;
  return { driver, statements };
}
describe("targeted Neo4j retriever constraints", () => {
  it("read-only probe and guard do not create storage", async () => {
    const f = fixture(); expect(await inspectRetrieverStorage(f.driver)).toBe("missing");
    await expect(checkRetrieverStorageReady(f.driver)).rejects.toMatchObject({ details: { code: "RETRIEVER_MIGRATION_REQUIRED" } });
    expect(f.statements.every(query => query.startsWith("SHOW"))).toBe(true);
  });
  it("ensures only internal constraints and leaves completed storage unchanged", async () => {
    const f = fixture(); expect(await ensureRetrieverStorage(f.driver)).toBe("created");
    expect(f.statements.filter(query => query.startsWith("CREATE"))).toHaveLength(2);
    expect(f.statements.some(query => /CREATE \(|MERGE|SET|DELETE/.test(query))).toBe(false);
    f.statements.length = 0;
    expect(await ensureRetrieverStorage(f.driver)).toBe("unchanged");
    expect(f.statements.every(query => query.startsWith("SHOW"))).toBe(true);
  });
  it("rejects a colliding named constraint instead of replacing it", async () => {
    const f = fixture([{ name: "retriever_config_id_unique", type: "UNIQUENESS", entityType: "NODE", labelsOrTypes: ["WrongLabel"], properties: ["retrieverConfigId"] }]);
    await expect(ensureRetrieverStorage(f.driver)).rejects.toMatchObject({ details: { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } });
    expect(f.statements.every(query => query.startsWith("SHOW"))).toBe(true);
  });
});
