/**
 * Retriever agents in modeling: lens-local CRUD, copy and move within the
 * ontology, and the single-agent export and import. Agents search the
 * ontology's search indices, so an adapter without search indices answers
 * every operation with `FEATURE_DISABLED`.
 *
 * A save checks the configuration against the owning lens
 * (`runtime/retrieverAgents/config.ts`) and refuses an invalid one; a
 * stored agent can still become invalid later, which every read reports.
 * An import also takes a version-1 export of a 5.x retriever and converts
 * it (`core/legacyRetrieverConfig.ts`), renaming a key with `-`; the
 * conversion's warnings stay with the agent until its next save.
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
  RETRIEVER_AGENT_CONFIG_VERSION,
  type RetrieverAgentRecord,
} from "../core/retrieverAgent.js";
import { LENS_RESOURCE_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import { checkAgentConfig, type AgentLens } from "../runtime/retrieverAgents/config.js";
import { loadSchema } from "../runtime/schemaCache.js";
import { searchIndexCatalog } from "../runtime/search/indexSearch.js";
import { ExportRetrieverAgent, type ExportRetrieverAgentInput } from "./schemas.js";
import { requireSearchIndices } from "./searchIndices.js";

const Key = z.string().regex(LENS_RESOURCE_KEY_PATTERN).max(MAX_KEY_LENGTH);

/** The write body of `PUT`. */
export const RetrieverAgentWriteBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().default(null),
    configVersion: z.literal(RETRIEVER_AGENT_CONFIG_VERSION),
    config: z.unknown(),
  })
  .strict();
export type RetrieverAgentWriteBodyInput = z.input<typeof RetrieverAgentWriteBody>;

/** The portable form (export, import, transfer format). */
export const PortableRetrieverAgent = ExportRetrieverAgent;
export type PortableRetrieverAgent = ExportRetrieverAgentInput;

/** An import body: version 2, or a version-1 export to convert. */
export const RetrieverAgentImportBody = z
  .object({
    key: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().default(null),
    configVersion: z.union([
      z.literal(RETRIEVER_AGENT_CONFIG_VERSION),
      z.literal(LEGACY_RETRIEVER_CONFIG_VERSION),
    ]),
    config: z.unknown(),
  })
  .strict();

export const RetrieverAgentTransferBody = z
  .object({ targetLensKey: z.string(), targetKey: z.string() })
  .strict();

export const RetrieverAgentResponse = PortableRetrieverAgent.extend({
  lensKey: z.string(),
  validation: z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RetrieverAgentResponse = z.infer<typeof RetrieverAgentResponse>;

export function portable(agent: RetrieverAgentRecord): PortableRetrieverAgent {
  return {
    key: agent.key,
    name: agent.name,
    description: agent.description,
    configVersion: agent.configVersion,
    config: agent.config,
  };
}

function toResponse(agent: RetrieverAgentRecord, lensKey: string, lens: AgentLens): RetrieverAgentResponse {
  const { errors } = checkAgentConfig(agent.configVersion, agent.config, lens);
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
      `Invalid retriever agent key '${key}'. Must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`,
    );
  }
}

/** The lens's id, and what its agents are checked against. */
async function lensOf(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<{ lensId: string; lens: AgentLens }> {
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  const [loaded, catalog] = await Promise.all([
    loadSchema(lensKey, runtime),
    searchIndexCatalog(lensKey, runtime),
  ]);
  return { lensId: found.lensId as string, lens: { scoped: loaded.scoped, catalog } };
}

async function stored(indices: SearchIndexStore, lensId: string, key: string): Promise<RetrieverAgentRecord> {
  const agent = await indices.getRetrieverAgent(lensId, key);
  if (agent === null) throw new NotFoundError(`Retriever agent '${key}' not found`);
  return agent;
}

/** Refuse a configuration the lens cannot run. */
function requireValid(version: unknown, config: unknown, lens: AgentLens): unknown {
  const { config: valid, errors } = checkAgentConfig(version, config, lens);
  if (valid === null) {
    throw new ValidationError(`Invalid retriever agent configuration: ${errors.join("; ")}`, { errors });
  }
  return valid;
}

export async function listRetrieverAgents(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverAgentResponse[]> {
  const indices = requireSearchIndices(store);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  return (await indices.listRetrieverAgents(lensId)).map((agent) => toResponse(agent, lensKey, lens));
}

export async function getRetrieverAgent(
  lensKey: string,
  key: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverAgentResponse> {
  const indices = requireSearchIndices(store);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  return toResponse(await stored(indices, lensId, key), lensKey, lens);
}

/** The portable form of one stored agent, as stored. */
export async function exportRetrieverAgent(
  lensKey: string,
  key: string,
  store: ModelingStore,
): Promise<PortableRetrieverAgent> {
  const indices = requireSearchIndices(store);
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  return portable(await stored(indices, found.lensId as string, key));
}

/** Create or replace (`PUT`). A save clears conversion warnings. */
export async function saveRetrieverAgent(
  lensKey: string,
  key: string,
  body: RetrieverAgentWriteBodyInput,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<[RetrieverAgentResponse, boolean]> {
  const indices = requireSearchIndices(store);
  checkKey(key);
  const parsed = RetrieverAgentWriteBody.parse(body);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  const config = requireValid(parsed.configVersion, parsed.config, lens);
  const [agent, created] = await indices.saveRetrieverAgent(
    lensId,
    {
      retrieverAgentId: randomUUID(),
      key,
      name: parsed.name,
      description: parsed.description,
      configVersion: RETRIEVER_AGENT_CONFIG_VERSION,
      config,
      warnings: [],
    },
    false,
  );
  return [toResponse(agent, lensKey, lens), created];
}

/** Create from a portable export (never replaces). A version-1 export is
 * converted first, with the lens's schema telling document fields apart. */
export async function importRetrieverAgent(
  lensKey: string,
  body: z.input<typeof RetrieverAgentImportBody>,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverAgentResponse> {
  const indices = requireSearchIndices(store);
  const parsed = RetrieverAgentImportBody.parse(body);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  let key = parsed.key;
  let config: unknown = parsed.config;
  let warnings: string[] = [];
  if (parsed.configVersion === LEGACY_RETRIEVER_CONFIG_VERSION) {
    // A version-1 key with `-` is renamed, unique in the lens.
    const taken = new Set((await indices.listRetrieverAgents(lensId)).map((agent) => agent.key));
    const renamed = legacyRetrieverKey(key, taken);
    key = renamed.key;
    if (renamed.warning !== null) warnings.push(renamed.warning);
    const converted = convertLegacyRetrieverConfig(
      parsed.config,
      (type, field) => lens.scoped.entityTypes[type]?.properties[field]?.dataType,
    );
    if (converted === null) {
      throw new ValidationError("Invalid retriever agent configuration: not a readable version-1 configuration");
    }
    config = converted.config;
    warnings = [...converted.warnings, ...warnings];
  }
  checkKey(key);
  const valid = requireValid(RETRIEVER_AGENT_CONFIG_VERSION, config, lens);
  const [agent] = await indices.saveRetrieverAgent(
    lensId,
    {
      retrieverAgentId: randomUUID(),
      key,
      name: parsed.name,
      description: parsed.description,
      configVersion: RETRIEVER_AGENT_CONFIG_VERSION,
      config: valid,
      warnings,
    },
    true,
  );
  return toResponse(agent, lensKey, lens);
}

export async function deleteRetrieverAgent(lensKey: string, key: string, store: ModelingStore): Promise<void> {
  const indices = requireSearchIndices(store);
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  if (!(await indices.deleteRetrieverAgent(found.lensId as string, key))) {
    throw new NotFoundError(`Retriever agent '${key}' not found`);
  }
}

/** Copy or move an agent to a lens and key of the same ontology. The
 * configuration must be valid in the target lens; the target key must be
 * free. */
export async function transferRetrieverAgent(
  lensKey: string,
  key: string,
  target: z.input<typeof RetrieverAgentTransferBody>,
  copy: boolean,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<RetrieverAgentResponse> {
  const indices = requireSearchIndices(store);
  checkKey(target.targetKey);
  const source = await store.getLensByKey(lensKey);
  if (!source) throw new NotFoundError(`Lens '${lensKey}' not found`);
  const agent = await stored(indices, source.lensId as string, key);
  const { lensId: targetLensId, lens } = await lensOf(target.targetLensKey, store, runtime);
  requireValid(agent.configVersion, agent.config, lens);
  if (await indices.getRetrieverAgent(targetLensId, target.targetKey)) {
    throw new ConflictError(`Retriever agent '${target.targetKey}' already exists in the target lens`);
  }
  const moved = await indices.transferRetrieverAgent(
    source.lensId as string,
    key,
    targetLensId,
    target.targetKey,
    copy ? randomUUID() : null,
    JSON.stringify([agent.configVersion, agent.config]),
  );
  return toResponse(moved, target.targetLensKey, lens);
}
