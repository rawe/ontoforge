/** Saved retriever management. Definitions survive schema changes; execution revalidates. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import type { ModelingStore, RuntimeStore, Row } from "../core/ports.js";
import { loadSchemaUncached, invalidateLoadedSchemaCache, type SchemaCacheValue } from "../runtime/schemaCache.js";
import { validateConfig } from "../runtime/retrievalPrototype/config.js";
export const RetrieverWrite = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().default(null),
  configVersion: z.literal(1),
  config: z.unknown(),
}).strict();
export const RetrieverTransfer = z.object({
  targetLensKey: z.string(),
  targetKey: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(64),
}).strict();
export const RetrieverExport = RetrieverWrite.extend({ key: z.string() });
// Reads and exports preserve unknown versions/configurations without converting them.
export const StoredRetrieverExport = z.object({ key: z.string(), name: z.string(), description: z.string().nullable(), configVersion: z.number(), config: z.unknown() });
export const RetrieverResponse = StoredRetrieverExport.extend({
  retrieverConfigId: z.string(), createdAt: z.string(), updatedAt: z.string(),
  validation: z.object({ valid: z.boolean(), errors: z.array(z.string()) }),
});
export type Write = z.infer<typeof RetrieverWrite>;
export function validateDefinition(version: unknown, config: unknown, schema: SchemaCacheValue) {
  if(version !== 1)
    throw new ValidationError("Unsupported retriever configuration version");
  return validateConfig(config, schema);
}
export function portable(row: Row) {
  return { key: row.key as string, name: row.name as string, description: (row.description as string | null) ?? null, configVersion: row.configVersion as number, config: row.config };
}
function response(row: Row, schema: SchemaCacheValue) {
  const errors: string[] = [];
  try {
    validateDefinition(row.configVersion, row.config, schema);
  }
  catch(error) {
    if(error instanceof ValidationError)
      errors.push(error.message);
    else
      throw error;
  }
  const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
  return {
    ...portable(row), retrieverConfigId: row.retrieverConfigId as string,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), validation: { valid: errors.length === 0, errors }
  };
}
async function lens(key: string, store: ModelingStore) {
  const found = await store.getLensByKey(key);
  if(!found)
    throw new NotFoundError(`Lens '${key}' not found`);
  return found.lensId as string;
}
function validateKey(key: string) {
  if(!/^[a-z][a-z0-9_-]*$/.test(key) || key.length > 64)
    throw new ValidationError("Invalid retriever key");
}
export async function list(lensKey: string, store: ModelingStore, runtime: RuntimeStore) {
  const id = await lens(lensKey, store);
  const schema = (await loadSchemaUncached(lensKey, runtime)).scoped;
  return (await store.listRetrievers(id)).map(row => response(row, schema));
}
export async function read(lensKey: string, key: string, store: ModelingStore, runtime: RuntimeStore) {
  const row = await getStored(lensKey, key, store);
  return response(row, (await loadSchemaUncached(lensKey, runtime)).scoped);
}
export async function getStored(lensKey: string, key: string, store: ModelingStore) {
  const row = await store.getRetriever(await lens(lensKey, store), key);
  if(!row)
    throw new NotFoundError(`Retriever '${key}' not found`);
  return row;
}
export async function write(lensKey: string, key: string, body: Write, store: ModelingStore, runtime: RuntimeStore, createOnly = false) {
  validateKey(key);
  const parsed = RetrieverWrite.parse(body);
  const id = await lens(lensKey, store);
  const schema = (await loadSchemaUncached(lensKey, runtime)).scoped;
  const config = validateDefinition(parsed.configVersion, parsed.config, schema);
  const [row, created] = await store.upsertRetriever(id, randomUUID(), key, parsed.name, parsed.description, 1, config, createOnly);
  invalidateLoadedSchemaCache();
  return [response(row, schema), created] as const;
}
export async function remove(lensKey: string, key: string, store: ModelingStore) {
  if(!await store.deleteRetriever(await lens(lensKey, store), key))
    throw new NotFoundError(`Retriever '${key}' not found`);
  invalidateLoadedSchemaCache();
}
export async function transfer(lensKey: string, key: string, target: {
  targetLensKey: string;
  targetKey: string;
}, copy: boolean, store: ModelingStore, runtime: RuntimeStore) {
  validateKey(target.targetKey);
  const sourceId = await lens(lensKey, store), targetId = await lens(target.targetLensKey, store);
  const source = await getStored(lensKey, key, store);
  const schema = (await loadSchemaUncached(target.targetLensKey, runtime)).scoped;
  validateDefinition(source.configVersion, source.config, schema);
  if(await store.getRetriever(targetId, target.targetKey))
    throw new ConflictError(`Retriever '${target.targetKey}' already exists in the target lens`);
  const row = await store.transferRetriever(sourceId, key, targetId, target.targetKey, copy ? randomUUID() : null, JSON.stringify([source.configVersion, source.config]));
  invalidateLoadedSchemaCache();
  return response(row, schema);
}
export async function executable(lensKey: string, key: string, store: ModelingStore, runtime: RuntimeStore) {
  const row = await getStored(lensKey, key, store);
  return validateDefinition(row.configVersion, row.config, (await loadSchemaUncached(lensKey, runtime)).scoped);
}
