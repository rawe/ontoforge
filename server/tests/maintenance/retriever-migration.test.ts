import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/config.js", () => ({ settings: { DB_BACKEND: "postgres" } }));
const doors = vi.hoisted(() => ({ init: vi.fn(), close: vi.fn(), inspect: vi.fn(), ensure: vi.fn(), initSchema: vi.fn() }));
vi.mock("../../src/adapters/postgres/errors.js", () => ({ initPool: doors.init, closePool: doors.close, withTransaction: async (work: (q: unknown) => unknown) => work({}) }));
vi.mock("../../src/adapters/postgres/registry.js", () => ({ listOntologyBindings: async () => [{ key: "demo", namespace: "ont_demo" }] }));
vi.mock("../../src/adapters/postgres/retrieverStorage.js", () => ({ inspectRetrieverStorage: doors.inspect, ensureRetrieverStorage: doors.ensure }));
vi.mock("../../src/adapters/postgres/ddl.js", () => ({ initSchema: doors.initSchema }));
import { migrateRetrievers, parseMigrationOptions, safeMigrationFailure } from "../../src/maintenance/migrateRetrievers.js";
import { ValidationError } from "../../src/core/exceptions.js";
beforeEach(() => { vi.clearAllMocks(); doors.inspect.mockResolvedValue("missing"); });
describe("explicit migration selection", () => {
  it("defaults to dry-run and deduplicates selected keys", () => {
    expect(parseMigrationOptions(["--ontology", "demo", "--ontology", "demo"])).toEqual({ apply: false, all: false, ontologyKeys: ["demo"] });
  });
  it("requires an explicit all-selection or ontology selection", () => {
    expect(() => parseMigrationOptions([])).toThrow();
    expect(() => parseMigrationOptions(["--all", "--ontology", "demo"])).toThrow();
  });
  it("rejects ambiguous modes and invalid keys before connecting", () => {
    expect(() => parseMigrationOptions(["--dry-run", "--apply", "--all"])).toThrow();
    expect(() => parseMigrationOptions(["--ontology", "demo;DROP"])).toThrow();
    expect(parseMigrationOptions(["--apply", "--all"])).toEqual({ apply: true, all: true, ontologyKeys: [] });
  });
  it("dry-run never invokes initSchema or apply", async () => {
    expect((await migrateRetrievers(parseMigrationOptions(["--dry-run", "--ontology", "demo"]))).results).toEqual([{ ontologyKey: "demo", status: "missing" }]);
    expect(doors.initSchema).not.toHaveBeenCalled(); expect(doors.ensure).not.toHaveBeenCalled();
    expect(doors.close).toHaveBeenCalledOnce();
  });
  it("rejects a selection containing an unknown ontology before any writes", async () => {
    await expect(migrateRetrievers(parseMigrationOptions(["--apply", "--ontology", "demo", "--ontology", "missing"]))).rejects.toThrow("not registered");
    expect(doors.ensure).not.toHaveBeenCalled(); expect(doors.close).toHaveBeenCalledOnce();
  });
  it("reports only safe failure codes, never raw exception messages", () => {
    expect(safeMigrationFailure(new Error("private connection details"))).toEqual({ status: "failed", code: "MIGRATION_FAILED" });
    expect(safeMigrationFailure(new ValidationError("private", { code: "RETRIEVER_STORAGE_INCOMPATIBLE" }))).toEqual({ status: "incompatible", code: "RETRIEVER_STORAGE_INCOMPATIBLE" });
  });
});
