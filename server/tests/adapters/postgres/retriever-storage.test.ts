import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, fakePgModule } from "./support.js";
vi.mock("pg", async original => fakePgModule(await original()));
vi.mock("../../../src/config.js", () => ({ settings: { DB_URI: "postgres://localhost/test", DB_USER: "fake", DB_PASSWORD: "fake" } }));
const db = await import("../../../src/adapters/postgres/errors.js");
const storage = await import("../../../src/adapters/postgres/retrieverStorage.js");

const readyColumns = [
  ["retriever_config_id", "uuid", "NO", null], ["lens_id", "uuid", "NO", null],
  ["key", "text", "NO", null], ["name", "text", "NO", null], ["description", "text", "YES", null],
  ["config_version", "integer", "NO", null], ["config", "jsonb", "NO", null],
  ["created_at", "timestamp with time zone", "NO", "now()"], ["updated_at", "timestamp with time zone", "NO", "now()"],
].map(([column_name, data_type, is_nullable, column_default]) => ({ column_name, data_type, is_nullable, column_default }));
const readyConstraints = [
  { conname: "retriever_config_pk", definition: "PRIMARY KEY (retriever_config_id)" },
  { conname: "retriever_config_lens_fk", definition: "FOREIGN KEY (lens_id) REFERENCES ont_demo.lens(lens_id) ON DELETE CASCADE" },
  { conname: "retriever_config_key_unique", definition: "UNIQUE (lens_id, key)" },
];
let present: boolean;
beforeEach(async () => {
  await db.closePool(); fakeDb.reset(); present = false;
  fakeDb.onQuery = async sql => {
    if (sql.includes("information_schema.columns")) return { rows: present ? readyColumns : [], rowCount: present ? 9 : 0 };
    if (sql.includes("FROM pg_constraint")) return { rows: readyConstraints, rowCount: 3 };
    if (sql.includes("FOR KEY SHARE")) return { rows: [{ key: "demo" }], rowCount: 1 };
    if (sql.startsWith("CREATE TABLE")) present = true;
    return { rows: [], rowCount: 0 };
  };
  await db.initPool(); fakeDb.queries = [];
});
describe("targeted PostgreSQL retriever provisioning", () => {
  it("dry inspection performs no DDL or data updates", async () => {
    const result = await db.withTransaction(q => storage.inspectRetrieverStorage(q, "ont_demo"), "READ COMMITTED", "ont_demo");
    expect(result).toBe("missing");
    expect(fakeDb.queries.some(q => /CREATE|INSERT|UPDATE|DELETE|DROP/.test(q.sql))).toBe(false);
  });
  it("locks, provisions the qualified table and commits; repetition leaves it intact", async () => {
    expect(await storage.ensureRetrieverStorage("ont_demo")).toBe("created");
    expect(fakeDb.queries.map(q => q.sql).findIndex(q => q.includes("pg_advisory_xact_lock"))).toBeLessThan(fakeDb.queries.map(q => q.sql).findIndex(q => q.startsWith("CREATE TABLE")));
    expect(fakeDb.queries.find(q => q.sql.startsWith("CREATE TABLE"))?.sql).toContain('ont_demo.retriever_config');
    expect(fakeDb.queries.at(-1)?.sql).toBe("COMMIT");
    fakeDb.queries = [];
    expect(await storage.ensureRetrieverStorage("ont_demo")).toBe("unchanged");
    expect(fakeDb.queries.some(q => q.sql.startsWith("CREATE"))).toBe(false);
  });
  it("refuses an existing incompatible structure without replacing it", async () => {
    present = true;
    const previous = fakeDb.onQuery!;
    fakeDb.onQuery = async (sql, params) => sql.includes("information_schema.columns") ? { rows: readyColumns.slice(0, 8), rowCount: 8 } : previous(sql, params);
    await expect(storage.ensureRetrieverStorage("ont_demo")).rejects.toMatchObject({ details: { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } });
    expect(fakeDb.queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(fakeDb.queries.some(q => /CREATE|DROP|ALTER/.test(q.sql))).toBe(false);
  });
  it("rolls back when post-DDL verification fails", async () => {
    const previous = fakeDb.onQuery!;
    fakeDb.onQuery = async (sql, params) => sql.includes("FROM pg_constraint") ? { rows: [], rowCount: 0 } : previous(sql, params);
    await expect(storage.ensureRetrieverStorage("ont_demo")).rejects.toThrow();
    expect(fakeDb.queries.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("guard fails closed before CRUD when storage is absent", async () => {
    await expect(storage.checkRetrieverStorageReady("ont_demo")).rejects.toMatchObject({ details: { code: "RETRIEVER_MIGRATION_REQUIRED" } });
    expect(fakeDb.queries.some(q => q.sql.startsWith("CREATE"))).toBe(false);
  });
  it.each([
    "FOREIGN KEY (lens_id) REFERENCES another_table(lens_id) ON DELETE CASCADE",
    "FOREIGN KEY (lens_id) REFERENCES lens(lens_id)",
  ])("rejects a wrong owner FK: %s", async definition => {
    present = true;
    const previous = fakeDb.onQuery!;
    fakeDb.onQuery = async (sql, params) => sql.includes("FROM pg_constraint") ? { rows: readyConstraints.map(row => row.conname === "retriever_config_lens_fk" ? { ...row, definition } : row), rowCount: 3 } : previous(sql, params);
    await expect(storage.checkRetrieverStorageReady("ont_demo")).rejects.toMatchObject({ details: { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } });
  });
  it("rejects extra columns rather than silently accepting a foreign structure", async () => {
    present = true;
    const previous = fakeDb.onQuery!;
    fakeDb.onQuery = async (sql, params) => sql.includes("information_schema.columns") ? { rows: [...readyColumns, { column_name: "other", data_type: "text", is_nullable: "YES", column_default: null }], rowCount: 10 } : previous(sql, params);
    await expect(storage.checkRetrieverStorageReady("ont_demo")).rejects.toMatchObject({ details: { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } });
  });
  it("accepts PostgreSQL 18 NOT NULL catalog records while retaining column validation", async () => {
    present = true;
    const previous = fakeDb.onQuery!;
    const notNullConstraints = readyColumns.filter(row => row.is_nullable === "NO").map(row => ({
      conname: `retriever_config_${row.column_name}_not_null`, contype: "n", definition: `NOT NULL ${row.column_name}`,
    }));
    fakeDb.onQuery = async (sql, params) => sql.includes("FROM pg_constraint")
      ? { rows: [...readyConstraints, ...notNullConstraints], rowCount: 11 } : previous(sql, params);
    await expect(storage.checkRetrieverStorageReady("ont_demo")).resolves.toBeUndefined();
    const pg18Query = fakeDb.onQuery!;
    fakeDb.onQuery = async (sql, params) => sql.includes("information_schema.columns")
      ? { rows: readyColumns.map(row => row.column_name === "key" ? { ...row, is_nullable: "YES" } : row), rowCount: 9 }
      : pg18Query(sql, params);
    await expect(storage.checkRetrieverStorageReady("ont_demo")).rejects.toMatchObject({ details: { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } });
  });
  it.each(["c", "x", "unknown"])("rejects additional structural constraints of kind %s", async contype => {
    present = true;
    const previous = fakeDb.onQuery!;
    fakeDb.onQuery = async (sql, params) => sql.includes("FROM pg_constraint")
      ? { rows: [...readyConstraints, { conname: "unexpected", contype, definition: "unexpected restriction" }], rowCount: 4 }
      : previous(sql, params);
    await expect(storage.checkRetrieverStorageReady("ont_demo")).rejects.toMatchObject({ details: { code: "RETRIEVER_STORAGE_INCOMPATIBLE" } });
  });
});
