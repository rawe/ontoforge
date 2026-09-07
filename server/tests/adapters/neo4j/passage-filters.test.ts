import type { Driver } from "neo4j-driver";
import { expect, it, vi } from "vitest";
import { Neo4jRuntimeStore } from "../../../src/adapters/neo4j/runtimeStore.js";
import { cond } from "../../propertyDefs.js";
for (const filtered of [false, true])
  it(`document ranking (${filtered ? "filtered" : "unfiltered"}) uses one statement and strips vectors`, async () => {
    const run = vi.fn(async () => ({
      records: [
        {
          get: (key: string) =>
            key === "value" ? { _id: "c", _entityId: "e", _embedding: [1] } : 0.9,
        },
      ],
    }));
    const driver = { session: () => ({ run, close: async () => {} }) } as unknown as Driver;
    const store = new Neo4jRuntimeStore(driver);
    const hits = await store.documentSearchSemantic(
      [
        {
          entityTypeKey: "person",
          propertyKey: "bio",
          conditions: filtered ? [cond("age", "integer", "gt", 25)] : [],
        },
      ],
      [1],
      5,
    );
    expect(run).toHaveBeenCalledTimes(1);
    const sql = run.mock.calls[0]![0] as string;
    expect(sql).toContain("VECTOR INDEX person_document_bio_embedding");
    expect(sql).toContain("ORDER BY score DESC LIMIT $limit");
    expect(sql.includes("MATCH (n:_Entity)-[:_HAS_CHUNK]->(c)")).toBe(filtered);
    expect(hits[0]!.chunk).not.toHaveProperty("_embedding");
  });
