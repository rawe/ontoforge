import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../../src/core/exceptions.js";
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/adapters/postgres/errors.js', () => ({ runQuery: mocks.query, withTransaction: mocks.transaction }));
import { PostgresSearchIndexStore } from "../../src/adapters/postgres/searchIndexStore.js";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const config = { indices: [{ index: "item~default" }], filters: [], answerFields: { item: ["name"] }, threshold: .35, answerFieldCharacters: 800 };
const now = new Date("2026-10-06T00:00:00Z");
const source = { retriever_agent_id: 'stable', key: 'find', name: 'Find', description: null, config_version: 2, config, warnings: [], created_at: now, updated_at: now };
const expected = JSON.stringify([2, config]);
const agent = { retrieverAgentId: 'id', key: 'find', name: 'Find', description: null, configVersion: 2, config, warnings: [] };
const store = () => new PostgresSearchIndexStore('ont_one', 'one');
beforeEach(() => { vi.clearAllMocks(); mocks.transaction.mockImplementation(async (work) => work({ query: mocks.query })); });
describe('PostgreSQL atomic retriever agent operations', () => {
    it('locks both owners in deterministic order, preserves identity for move and performs no insert', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ lens_id: A }, { lens_id: B }] }).mockResolvedValueOnce({ rows: [source] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...source, key: 'moved' }] });
        const result = await store().transferRetrieverAgent(A, 'find', B, 'moved', null, expected);
        expect(result.retrieverAgentId).toBe('stable');
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.query.mock.calls[0]![0]).toContain('ORDER BY lens_id FOR UPDATE');
        expect(mocks.query.mock.calls[3]![0]).toContain('UPDATE retriever_agent');
    });
    it.each([null, 'new-id'])('rechecks target conflict after acquiring owner locks (copyId=%s)', async (id) => {
        mocks.query.mockResolvedValueOnce({ rows: [{}, {}] }).mockResolvedValueOnce({ rows: [source] }).mockResolvedValueOnce({ rows: [{ key: 'target' }] });
        await expect(store().transferRetrieverAgent(A, 'find', B, 'target', id, expected)).rejects.toBeInstanceOf(ConflictError);
        expect(mocks.query).toHaveBeenCalledTimes(3);
    });
    it('rejects source replacement after target scope validation', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{}, {}] }).mockResolvedValueOnce({ rows: [{ ...source, config: { changed: true } }] });
        await expect(store().transferRetrieverAgent(A, 'find', B, 'target', null, expected)).rejects.toThrow('Source retriever agent changed');
        expect(mocks.query).toHaveBeenCalledTimes(2);
    });
    it('rejects a vanished owner before create', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });
        await expect(store().saveRetrieverAgent(A, agent, true)).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });
    it('creates only under an owner lock and reports a taken key as a conflict', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({ rows: [] });
        await expect(store().saveRetrieverAgent(A, agent, true)).rejects.toBeInstanceOf(ConflictError);
        expect(mocks.query.mock.calls[0]![0]).toContain('FOR UPDATE');
        expect(mocks.query.mock.calls[1]![0]).toContain('DO NOTHING');
    });
    it('replaces configuration and warnings, keeping identity', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({ rows: [{ ...source, created: false }] });
        const [saved, created] = await store().saveRetrieverAgent(A, agent, false);
        expect(created).toBe(false);
        expect(saved.retrieverAgentId).toBe('stable');
        expect(mocks.query.mock.calls[1]![0]).toContain('warnings = EXCLUDED.warnings');
    });
});
