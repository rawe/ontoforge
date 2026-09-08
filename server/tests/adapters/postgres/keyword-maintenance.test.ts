import { describe, expect, it, vi } from "vitest";
import type { Querier } from "../../../src/adapters/postgres/errors.js";
import { rebuildPropertyKeywords } from "../../../src/maintenance/propertyKeywords.js";

const entityId = "4f2d8a31-1111-4222-8333-444455556666";
function fakeMaintenance(migrated = false) {
  const query = vi.fn<Querier["query"]>(async (sql, params) => {
    if (sql.includes("FROM entity_type et JOIN")) return {
      rows: [{ type_key: "person", key: "name", data_type: "string" }, { type_key: "person", key: "role", data_type: "string" }], rowCount: 2,
    };
    if (sql.includes("SELECT id, type_key, props") && params?.[0] === null) return {
      rows: [{ id: entityId, type_key: "person", props: { role: "Engineer", name: "Alice", bio: "not indexed" } }], rowCount: 1,
    };
    if (sql.includes("pg_get_expr")) return {
      rows: [{ expression: migrated ? "to_tsvector('english', keyword_text)" : "to_tsvector('english', property_text)" }], rowCount: 1,
    };
    return { rows: [], rowCount: sql.startsWith("UPDATE entity") && !migrated ? 1 : 0 };
  });
  return query;
}

describe("keyword-only maintenance", () => {
  it("backfills exact current-schema string segments and migrates only keyword columns/index", async () => {
    const query = fakeMaintenance();
    expect(await rebuildPropertyKeywords({ query }, "english")).toEqual({ scanned: 1, updated: 1, migrated: true });
    const update = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE entity"));
    expect(update?.[1]).toEqual([entityId, "Alice\nEngineer", JSON.stringify([{ propertyKey: "name", text: "Alice" }, { propertyKey: "role", text: "Engineer" }])]);
    const writes = query.mock.calls.map(([sql]) => sql).filter((sql) => /^(UPDATE|ALTER|CREATE|DROP)/.test(sql));
    expect(writes.join("\n")).not.toMatch(/embedding|document_chunk|property_text|updated_at/);
    expect(writes).toContain("ALTER TABLE entity DROP COLUMN IF EXISTS search_vector");
    expect(query.mock.calls[0]?.[0]).toBe("LOCK TABLE entity IN ACCESS EXCLUSIVE MODE");
  });
  it("keeps the existing generated column/index on repeat and skips unchanged rows", async () => {
    const query = fakeMaintenance(true);
    expect(await rebuildPropertyKeywords({ query }, "german")).toEqual({ scanned: 1, updated: 0, migrated: false });
    expect(query.mock.calls.some(([sql]) => sql.includes("DROP COLUMN"))).toBe(false);
    expect(query.mock.calls.find(([sql]) => sql.startsWith("UPDATE entity"))?.[0]).toContain("IS DISTINCT FROM");
  });
});
