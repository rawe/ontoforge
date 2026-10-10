/**
 * Retrievers in modeling: lens-local CRUD, copy and move within the
 * ontology, and the single-retriever export and import. Retrievers search the
 * ontology's search indices, so an adapter without search indices answers
 * every operation with `FEATURE_DISABLED`.
 *
 * A save checks the configuration against the owning lens
 * (`runtime/assistants/retrievers/config.ts`) and refuses an invalid one; a
 * stored retriever can still become invalid later, which every read reports.
 * An import also takes a version-1 export of a 5.x retriever and converts
 * it (`core/legacyRetrieverConfig.ts`), renaming a key with `-`; the
 * conversion's warnings stay with the retriever until its next save.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "../core/exceptions.js";
import {
  convertLegacyRetrieverConfig,
  LEGACY_RETRIEVER_CONFIG_VERSION,
  legacyRetrieverKey,
} from "../core/legacyRetrieverConfig.js";
import type { ModelingStore, RuntimeStore, SearchIndexStore } from "../core/ports.js";
import {
  RETRIEVER_CONFIG_VERSION,
  type RetrieverRecord,
} from "../core/retriever.js";
import { LENS_RESOURCE_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import { checkRetrieverConfig, type RetrieverLens } from "../runtime/assistants/retrievers/config.js";
import { loadSchema } from "../runtime/schemaCache.js";
import { searchIndexCatalog } from "../runtime/search/indexSearch.js";
import { ExportRetriever, type ExportRetrieverInput } from "./schemas.js";
import { requireSearchIndices } from "./searchIndices.js";

const Key = z.string().regex(LENS_RESOURCE_KEY_PATTERN).max(MAX_KEY_LENGTH);

/** The write body of `PUT`. */
export const RetrieverWriteBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().default(null),
    configVersion: z.literal(RETRIEVER_CONFIG_VERSION),
    config: z.unknown(),
  })
  .strict();
export type RetrieverWriteBodyInput = z.input<typeof RetrieverWriteBody>;

/** The portable form (export, import, transfer format). */
export const PortableRetriever = ExportRetriever;
export type PortableRetriever = ExportRetrieverInput;

/** An import body: version 2, or a version-1 export to convert. */
export const RetrieverImportBody = z
  .object({
    key: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().default(null),
    configVersion: z.union([
      z.literal(RETRIEVER_CONFIG_VERSION),
      z.literal(LEGACY_RETRIEVER_CONFIG_VERSION),
    ]),
    config: z.unknown(),
  })
  .strict();

export const RetrieverTransferBody = z
  .object({ targetLensKey: z.string(), targetKey: z.string() })
  .strict();

export const RetrieverResponse = PortableRetriever.extend({
  lensKey: z.string(),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RetrieverResponse = z.infer<typeof RetrieverResponse>;

export function portable(agent: RetrieverRecord): PortableRetriever {
  return {
    key: agent.key,
    name: agent.name,
    description: agent.description,
    configVersion: agent.configVersion,
    config: agent.config,
  };
}

function toResponse(agent: RetrieverRecord, lensKey: string, lens: RetrieverLens): RetrieverResponse {
  const { errors } = checkRetrieverConfig(agent.configVersion, agent.config, lens);
  return {
    ...portable(agent),
    lensKey,
    validation: { valid: errors.length === 0, errors, warnings: agent.warnings },
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function checkKey(key: string): void {
  if (!Key.safeParse(key).success) {
    throw new ValidationError(
      `Invalid retriever key '${key}'. Must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`,
    );
  }
}

/** The lens's id, and what its retrievers are checked against. */
async function lensOf(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<{ lensId: string; lens: RetrieverLens }> {
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  const [loaded, catalog] = await Promise.all([
    loadSchema(lensKey, runtime),
    searchIndexCatalog(lensKey, runtime),
  ]);
  return { lensId: found.lensId as string, lens: { scoped: loaded.scoped, catalog } };
}

async function stored(indices: SearchIndexStore, lensId: string, key: string): Promise<RetrieverRecord> {
  const agent = await indices.getRetriever(lensId, key);
  if (agent === null) throw new NotFoundError(`Retriever '${key}' not found`);
  return agent;
}

/** Refuse a configuration the lens cannot run. */
function requireValid(version: unknown, config: unknown, lens: RetrieverLens): unknown {
  const { config: valid, errors } = checkRetrieverConfig(version, config, lens);
  if (valid === null) {
    throw new ValidationError(`Invalid retriever configuration: ${errors.join("; ")}`, { errors });
  }
  return valid;
}

export async function listRetrievers(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverResponse[]> {
  const indices = requireSearchIndices(store);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  return (await indices.listRetrievers(lensId)).map((agent) => toResponse(agent, lensKey, lens));
}

export async function getRetriever(
  lensKey: string,
  key: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverResponse> {
  const indices = requireSearchIndices(store);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  return toResponse(await stored(indices, lensId, key), lensKey, lens);
}

/** The portable form of one stored retriever, as stored. */
export async function exportRetriever(
  lensKey: string,
  key: string,
  store: ModelingStore,
): Promise<PortableRetriever> {
  const indices = requireSearchIndices(store);
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  return portable(await stored(indices, found.lensId as string, key));
}

/** Create or replace (`PUT`). A save clears conversion warnings. */
export async function saveRetriever(
  lensKey: string,
  key: string,
  body: RetrieverWriteBodyInput,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<[RetrieverResponse, boolean]> {
  const indices = requireSearchIndices(store);
  checkKey(key);
  const parsed = RetrieverWriteBody.parse(body);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  const config = requireValid(parsed.configVersion, parsed.config, lens);
  const [agent, created] = await indices.saveRetriever(
    lensId,
    {
      retrieverId: randomUUID(),
      key,
      name: parsed.name,
      description: parsed.description,
      configVersion: RETRIEVER_CONFIG_VERSION,
      config,
      warnings: [],
    },
    false,
  );
  return [toResponse(agent, lensKey, lens), created];
}

/** Create from a portable export (never replaces). A version-1 export is
 * converted first, with the lens's schema telling document fields apart. */
export async function importRetriever(
  lensKey: string,
  body: z.input<typeof RetrieverImportBody>,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverResponse> {
  const indices = requireSearchIndices(store);
  const parsed = RetrieverImportBody.parse(body);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  let key = parsed.key;
  let config: unknown = parsed.config;
  let warnings: string[] = [];
  if (parsed.configVersion === LEGACY_RETRIEVER_CONFIG_VERSION) {
    // A version-1 key with `-` is renamed, unique in the lens.
    const taken = new Set((await indices.listRetrievers(lensId)).map((agent) => agent.key));
    const renamed = legacyRetrieverKey(key, taken);
    key = renamed.key;
    if (renamed.warning !== null) warnings.push(renamed.warning);
    const converted = convertLegacyRetrieverConfig(
      parsed.config,
      (type, field) => lens.scoped.entityTypes[type]?.properties[field]?.dataType,
    );
    if (converted === null) {
      throw new ValidationError("Invalid retriever configuration: not a readable version-1 configuration");
    }
    config = converted.config;
    warnings = [...converted.warnings, ...warnings];
  }
  checkKey(key);
  const valid = requireValid(RETRIEVER_CONFIG_VERSION, config, lens);
  const [agent] = await indices.saveRetriever(
    lensId,
    {
      retrieverId: randomUUID(),
      key,
      name: parsed.name,
      description: parsed.description,
      configVersion: RETRIEVER_CONFIG_VERSION,
      config: valid,
      warnings,
    },
    true,
  );
  return toResponse(agent, lensKey, lens);
}

export async function deleteRetriever(lensKey: string, key: string, store: ModelingStore): Promise<void> {
  const indices = requireSearchIndices(store);
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  if (!(await indices.deleteRetriever(found.lensId as string, key))) {
    throw new NotFoundError(`Retriever '${key}' not found`);
  }
}

/** Copy or move a retriever to a lens and key of the same ontology. The
 * configuration must be valid in the target lens; the target key must be
 * free. */
export async function transferRetriever(
  lensKey: string,
  key: string,
  target: z.input<typeof RetrieverTransferBody>,
  copy: boolean,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverResponse> {
  const indices = requireSearchIndices(store);
  checkKey(target.targetKey);
  const source = await store.getLensByKey(lensKey);
  if (!source) throw new NotFoundError(`Lens '${lensKey}' not found`);
  const agent = await stored(indices, source.lensId as string, key);
  const { lensId: targetLensId, lens } = await lensOf(target.targetLensKey, store, runtime);
  requireValid(agent.configVersion, agent.config, lens);
  if (await indices.getRetriever(targetLensId, target.targetKey)) {
    throw new ConflictError(`Retriever '${target.targetKey}' already exists in the target lens`);
  }
  const moved = await indices.transferRetriever(
    source.lensId as string,
    key,
    targetLensId,
    target.targetKey,
    copy ? randomUUID() : null,
    JSON.stringify([agent.configVersion, agent.config]),
  );
  return toResponse(moved, target.targetLensKey, lens);
}
