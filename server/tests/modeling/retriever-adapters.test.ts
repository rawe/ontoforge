import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "neo4j-driver";
import { ConflictError, NotFoundError } from "../../src/core/exceptions.js";
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/adapters/postgres/errors.js', () => ({ runQuery: mocks.query, withTransaction: mocks.transaction }));
import { PostgresModelingStore } from "../../src/adapters/postgres/modelingStore.js";
import * as neo from "../../src/adapters/neo4j/retrieverQueries.js";
const config = { buckets: [] };
const source = { retriever_config_id: 'stable', config_version: 1, config, key: 'find' };
const expected = JSON.stringify([1, config]);
beforeEach(() => { vi.clearAllMocks(); mocks.transaction.mockImplementation(async (work) => work({ query: mocks.query })); });
describe('PostgreSQL atomic retriever operations', () => {
    it('locks both owners in deterministic order, preserves identity for move and performs no insert', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ lens_id: 'a' }, { lens_id: 'b' }] }).mockResolvedValueOnce({ rows: [source] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...source, lens_id: 'b', key: 'moved' }] });
        const result = await new PostgresModelingStore('ont_one').transferRetriever('a', 'find', 'b', 'moved', null, expected);
        expect(result.retrieverConfigId).toBe('stable');
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.query.mock.calls[0]![0]).toContain('ORDER BY lens_id FOR UPDATE');
        expect(mocks.query.mock.calls[3]![0]).toContain('UPDATE retriever_config');
    });
    it.each([null, 'new-id'])('rechecks target conflict after acquiring owner locks (copyId=%s)', async (id) => {
        mocks.query.mockResolvedValueOnce({ rows: [{}, {}] }).mockResolvedValueOnce({ rows: [source] }).mockResolvedValueOnce({ rows: [{ key: 'target' }] });
        await expect(new PostgresModelingStore('ont_one').transferRetriever('a', 'find', 'b', 'target', id, expected)).rejects.toBeInstanceOf(ConflictError);
        expect(mocks.query).toHaveBeenCalledTimes(3);
    });
    it('rejects source replacement after target scope validation', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{}, {}] }).mockResolvedValueOnce({ rows: [{ ...source, config: { changed: true } }] });
        await expect(new PostgresModelingStore('ont_one').transferRetriever('a', 'find', 'b', 'target', null, expected)).rejects.toThrow('Source retriever changed');
        expect(mocks.query).toHaveBeenCalledTimes(2);
    });
    it('rejects a vanished owner before create', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });
        await expect(new PostgresModelingStore('ont_one').upsertRetriever('a', 'id', 'find', 'Find', null, 1, config, true)).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });
    it('serializes create-only conflict check under an owner lock', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce({ rows: [{ key: 'find' }] });
        await expect(new PostgresModelingStore('ont_one').upsertRetriever('a', 'id', 'find', 'Find', null, 1, config, true)).rejects.toBeInstanceOf(ConflictError);
        expect(mocks.query.mock.calls[0]![0]).toContain('FOR UPDATE');
        expect(mocks.query).toHaveBeenCalledTimes(2);
    });
});
function result(values: Record<string, unknown>[]) { return { records: values.map(value => ({ get: (key: string) => value[key] })) }; }
describe('Neo4j atomic retriever transfer', () => {
    it('uses one managed write transaction and preserves identity in move statement', async () => {
        const run = vi.fn().mockResolvedValueOnce(result([{ id: 'a' }, { id: 'b' }])).mockResolvedValueOnce(result([{ retriever: { retrieverConfigId: 'stable', configVersion: 1, configJson: JSON.stringify(config) } }])).mockResolvedValueOnce(result([])).mockResolvedValueOnce(result([{ retriever: { retrieverConfigId: 'stable', configVersion: 1, configJson: JSON.stringify(config) } }]));
        const executeWrite = vi.fn(async (work) => work({ run }));
        const output = await neo.transfer({ executeWrite } as unknown as Session, 'a', 'find', 'b', 'target', null, expected);
        expect(executeWrite).toHaveBeenCalledTimes(1);
        expect(output.retrieverConfigId).toBe('stable');
        expect(run.mock.calls[3]![0]).toContain('DELETE edge');
        expect(run.mock.calls[3]![0]).not.toContain('r.retrieverConfigId=');
    });
    it('rejects target conflict inside the managed transaction without mutating config', async () => {
        const run = vi.fn().mockResolvedValueOnce(result([{ id: 'a' }, { id: 'b' }])).mockResolvedValueOnce(result([{ retriever: { configVersion: 1, configJson: JSON.stringify(config) } }])).mockResolvedValueOnce(result([{ key: 'target' }]));
        const executeWrite = vi.fn(async (work) => work({ run }));
        await expect(neo.transfer({ executeWrite } as unknown as Session, 'a', 'find', 'b', 'target', 'copy-id', expected)).rejects.toBeInstanceOf(ConflictError);
        expect(run).toHaveBeenCalledTimes(3);
    });
});
