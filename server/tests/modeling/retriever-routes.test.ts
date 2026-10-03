import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockModelingStore } from "./helpers.js";
import { ValidationError } from "../../src/core/exceptions.js";
const holder = { store: createMockModelingStore() };
const runtime = { ontologyKey: 'one', getFullSchemaWithLensInclusions: async () => ({ lens: { lensId: 'a', key: 'main', name: 'Main' }, entityTypes: [{ key: 'item', properties: [{ key: 'name', dataType: 'string' }] }], relationTypes: [], entityInclusions: [], relationInclusions: [] }), getAiAgentConfigs: async () => [], getSavedQueries: async () => [] };
const models = vi.hoisted(() => ({ prepare: vi.fn(async () => ({ entityCount: 1, embeddingRequests: 0 })), chat: vi.fn() }));
vi.mock('../../src/core/ports.js', () => ({ getModelingStore: async () => holder.store, getRuntimeStore: async () => runtime }));
vi.mock('../../src/runtime/retrievalPrototype/runtime.js', () => models);
const config = { buckets: [{ entityTypeKey: 'item', searchFields: ['name'], answerFields: ['name'], conditions: [] }], threshold: .35, answerFieldCharacters: 800 };
const body = { key: 'find', name: 'Find', description: null, configVersion: 1 as const, config };
const row = { ...body, retrieverConfigId: 'id', createdAt: '2026-10-03', updatedAt: '2026-10-03' };
let app: FastifyInstance;
beforeAll(async () => { const { createApp } = await import('../../src/app.js'); app = await createApp(); await app.ready(); });
afterAll(async () => app.close());
beforeEach(() => { vi.clearAllMocks(); holder.store = createMockModelingStore(); holder.store.getLensByKey.mockResolvedValue({ lensId: 'a', key: 'main', name: 'Main' }); holder.store.getRetriever.mockResolvedValue(row); holder.store.listRetrievers.mockResolvedValue([row]); holder.store.upsertRetriever.mockResolvedValue([row, true]); });
const base = '/api/ontologies/one/model/lenses/main/retrievers';
describe('saved retriever REST', () => {
    it('returns named profiles with fresh validation', async () => {
        const response = await app.inject({ method: 'GET', url: base });
        expect(response.statusCode).toBe(200);
        expect(response.json()[0].validation).toEqual({ valid: true, errors: [] });
    });
    it('imports create-only and exports only the portable definition', async () => {
        const created = await app.inject({ method: 'POST', url: base + '/import', payload: body });
        expect(created.statusCode).toBe(201);
        expect(holder.store.upsertRetriever.mock.calls[0]!.at(-1)).toBe(true);
        const exported = await app.inject({ method: 'GET', url: base + '/find/export' });
        expect(exported.statusCode).toBe(200);
        expect(exported.json()).toEqual(body);
    });
    it('preserves a future version on read/export but refuses import', async () => {
        holder.store.getRetriever.mockResolvedValue({ ...row, configVersion: 9 });
        const read = await app.inject({ method: 'GET', url: base + '/find' });
        expect(read.json().validation.valid).toBe(false);
        const exported = await app.inject({ method: 'GET', url: base + '/find/export' });
        expect(exported.json().configVersion).toBe(9);
        const imported = await app.inject({ method: 'POST', url: base + '/import', payload: { ...body, configVersion: 9 } });
        expect(imported.statusCode).toBe(422);
        expect(holder.store.upsertRetriever).not.toHaveBeenCalled();
    });
    it('returns actionable migration errors without rewriting storage', async () => {
        holder.store.listRetrievers.mockRejectedValue(new ValidationError('Retriever storage requires the targeted migration', { code: 'RETRIEVER_MIGRATION_REQUIRED' }));
        const response = await app.inject({ method: 'GET', url: base });
        expect(response.statusCode).toBe(422);
        expect(response.json().error.details.code).toBe('RETRIEVER_MIGRATION_REQUIRED');
    });
    it('prepares with server-resolved config and rejects request overrides', async () => {
        const url = '/api/ontologies/one/runtime/lenses/main/retrievers/find/prepare';
        const response = await app.inject({ method: 'POST', url, payload: {} });
        expect(response.statusCode).toBe(200);
        expect(models.prepare.mock.calls[0]![2]).toEqual(config);
        const overridden = await app.inject({ method: 'POST', url, payload: { config } });
        expect(overridden.statusCode).toBe(422);
        expect(models.prepare).toHaveBeenCalledTimes(1);
    });
    it('accepts saved preparation without a payload or Content-Type header', async () => {
        const response = await app.inject({
            method: 'POST', url: '/api/ontologies/one/runtime/lenses/main/retrievers/find/prepare',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ entityCount: 1, embeddingRequests: 0 });
        expect(holder.store.getRetriever).toHaveBeenCalledWith('a', 'find');
        expect(models.prepare).toHaveBeenCalledTimes(1);
        expect(models.prepare.mock.calls[0]!.slice(0, 3)).toEqual(['main', runtime, config]);
    });
    it('keeps the saved chat stream contract and resolves server configuration', async () => {
        models.chat.mockImplementationOnce(async (...args: unknown[]) => {
            const execution = args[5] as { onToolEvent(event: Record<string, unknown>): Promise<void> };
            await execution.onToolEvent({ type: 'delta', text: 'Answer' });
            return { reply: 'Answer' };
        });
        const response = await app.inject({ method: 'POST', url: '/api/ontologies/one/runtime/lenses/main/retrievers/find/chat', payload: { message: 'Find items', history: [] } });
        expect(response.headers['content-type']).toBe('application/x-ndjson');
        const events = response.body.trim().split('\n').map(line => JSON.parse(line));
        expect(events).toEqual([{ type: 'delta', text: 'Answer' }, { type: 'final', reply: 'Answer' }]);
        expect(models.chat.mock.calls[0]![2]).toEqual(config);
    });
    it('rejects invalid stored profiles before runtime invocation', async () => {
        holder.store.getRetriever.mockResolvedValue({ ...row, configVersion: 9 });
        const response = await app.inject({ method: 'POST', url: '/api/ontologies/one/runtime/lenses/main/retrievers/find/chat', payload: { message: 'Find items', history: [] } });
        expect(response.statusCode).toBe(422);
        expect(models.chat).not.toHaveBeenCalled();
    });
});
