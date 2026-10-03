import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeStore } from "../../src/core/ports.js";
import { ConflictError, ValidationError } from "../../src/core/exceptions.js";
import { createMockModelingStore } from "./helpers.js";
import * as retrievers from "../../src/modeling/retrievers.js";
import { getSchemaExport, importSchema } from "../../src/modeling/service.js";
const config = { buckets: [{ entityTypeKey: "item", searchFields: ["name"], answerFields: ["name"], conditions: [] }], threshold: .35, answerFieldCharacters: 800 };
const current = { lens: { lensId: "a", key: "source", name: "Source" }, entityTypes: [{ key: "item", displayName: "Item", properties: [{ key: "name", dataType: "string", required: false }] }], relationTypes: [], entityInclusions: [], relationInclusions: [] };
const raw = { retrieverConfigId: "saved-id", key: "find", name: "Find", description: null, configVersion: 1, config, createdAt: "2026-10-03", updatedAt: "2026-10-03" };
let store = createMockModelingStore();
const runtime = { ontologyKey: "one", getFullSchemaWithLensInclusions: vi.fn(async () => current), getAiAgentConfigs: vi.fn(async () => []), getSavedQueries: vi.fn(async () => []) } as unknown as RuntimeStore;
beforeEach(() => {
    store = createMockModelingStore();
    store.getLensByKey.mockImplementation(async (key: string) => ({ lensId: key === "target" ? "b" : "a", key, name: key }));
    vi.mocked(runtime.getFullSchemaWithLensInclusions).mockResolvedValue(current);
    store.getRetriever.mockResolvedValue(raw);
});
describe("Saved retriever management", () => {
    it("stores a validated profile without invoking a model or embedding and retains the adapter identity", async () => {
        store.upsertRetriever.mockResolvedValue([raw, false]);
        const [result, created] = await retrievers.write("source", "find", { name: "Find", description: null, configVersion: 1, config }, store, runtime);
        expect(result.retrieverConfigId).toBe("saved-id");
        expect(created).toBe(false);
        expect(store.upsertRetriever).toHaveBeenCalledWith("a", expect.any(String), "find", "Find", null, 1, config, false);
    });
    it("keeps invalid stored configurations readable and exportable while blocking execution", async () => {
        store.getRetriever.mockResolvedValue({ ...raw, configVersion: 99 });
        const result = await retrievers.read("source", "find", store, runtime);
        expect(result.configVersion).toBe(99);
        expect(result.validation.valid).toBe(false);
        expect(retrievers.portable(await retrievers.getStored("source", "find", store))).toHaveProperty("configVersion", 99);
        await expect(retrievers.executable("source", "find", store, runtime)).rejects.toThrow("Unsupported");
    });
    it("does not write when a selected field disappears", async () => {
        vi.mocked(runtime.getFullSchemaWithLensInclusions).mockResolvedValue({ ...current, entityTypes: [] });
        await expect(retrievers.write("source", "find", { name: "Find", description: null, configVersion: 1, config }, store, runtime)).rejects.toBeInstanceOf(ValidationError);
        expect(store.upsertRetriever).not.toHaveBeenCalled();
    });
    it("revalidates saved configuration on each execution", async () => {
        await retrievers.executable("source", "find", store, runtime);
        vi.mocked(runtime.getFullSchemaWithLensInclusions).mockResolvedValue({ ...current, entityTypes: [] });
        await expect(retrievers.executable("source", "find", store, runtime)).rejects.toBeInstanceOf(ValidationError);
    });
    it("blocks target scope incompatibility before copy or move", async () => {
        vi.mocked(runtime.getFullSchemaWithLensInclusions).mockResolvedValue({ ...current, entityTypes: [] });
        await expect(retrievers.transfer("source", "find", { targetLensKey: "target", targetKey: "copy" }, false, store, runtime)).rejects.toBeInstanceOf(ValidationError);
        expect(store.transferRetriever).not.toHaveBeenCalled();
    });
    it.each([true, false])("does not overwrite target keys (copy=%s)", async (copy) => {
        await expect(retrievers.transfer("source", "find", { targetLensKey: "target", targetKey: "copy" }, copy, store, runtime)).rejects.toBeInstanceOf(ConflictError);
        expect(store.transferRetriever).not.toHaveBeenCalled();
    });
    it.each([true, false])("delegates atomic transfer with expected source configuration (copy=%s)", async (copy) => {
        store.getRetriever.mockImplementation(async (id: string) => id === "b" ? null : raw);
        store.transferRetriever.mockResolvedValue({ ...raw, key: "copy" });
        await retrievers.transfer("source", "find", { targetLensKey: "target", targetKey: "copy" }, copy, store, runtime);
        expect(store.transferRetriever).toHaveBeenCalledWith("a", "find", "b", "copy", copy ? expect.any(String) : null, JSON.stringify([1, config]));
    });
    it("uses create-only storage for single-profile import", async () => {
        store.upsertRetriever.mockResolvedValue([raw, true]);
        await retrievers.write("target", "find", { name: "Find", description: null, configVersion: 1, config }, store, runtime, true);
        expect(store.upsertRetriever.mock.calls[0]!.at(-1)).toBe(true);
    });
    it("adds portable retrievers to design export without identities or timestamps", async () => {
        store.getFullSchema.mockResolvedValue({ entityTypes: [], relationTypes: [], lenses: [{ lensId: "a", key: "source", name: "Source" }] });
        store.listRetrieversForExport.mockResolvedValue([raw]);
        const exported = await getSchemaExport(store);
        const lens = (exported.lenses as Record<string, unknown>[])[0]!;
        expect(lens.retrievers).toEqual([retrievers.portable(raw)]);
        expect(lens.retrievers).not.toHaveProperty("retrieverConfigId");
    });
    it("preflights missing migration before any design import write", async () => {
        store.getLensByKey.mockResolvedValue(null);
        store.assertRetrieverStorageReady.mockRejectedValue(new ValidationError("Migration required", { code: "RETRIEVER_MIGRATION_REQUIRED" }));
        await expect(importSchema({ textSearchLanguage: store.textSearchLanguage, formatVersion: "5.0", entityTypes: current.entityTypes.map(t => ({ ...t, description: null, properties: t.properties.map(p => ({ ...p, displayName: p.key, description: null, defaultValue: null })) })), relationTypes: [], lenses: [{ key: "source", name: "Source", aiAgents: [], savedQueries: [], retrievers: [retrievers.portable(raw)] }] }, store)).rejects.toThrow("Migration required");
        expect(store.createEntityType).not.toHaveBeenCalled();
        expect(store.createLens).not.toHaveBeenCalled();
    });
});
