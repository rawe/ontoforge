/**
 * Persistence port: store accessors and adapter lifecycle.
 *
 * Services, routers, and MCP handlers obtain their store through this
 * module and speak ontology vocabulary only (type keys, property keys,
 * instance ids, structured filters). Everything database-specific —
 * connections, transactions, query text, physical naming, index DDL,
 * driver types — is owned by the adapter selected via
 * `settings.DB_BACKEND`.
 *
 * Port contract (every adapter must satisfy it):
 *
 * 1. Methods accept and return plain JSON-safe values; temporal values
 *    cross the boundary as JS `Date` objects or ISO strings, never as
 *    driver types. The sole exception is the validated-query object from
 *    `core/oql`, which crosses the port opaque and is compiled by the
 *    adapter.
 * 2. Each method owns its connection.
 * 3. Filtering, search, and sorting inputs are structured values, never
 *    query fragments.
 * 4. Driver exceptions never cross the port; adapters raise the domain
 *    exceptions from `core/exceptions`. Expected conditions are pre-checked
 *    by the services or expressed as `null` returns; anything left — lost
 *    connections, timeouts, index state, constraint violations the code did
 *    not anticipate — is raised as `StoreError`, whose message carries no
 *    storage detail. The adapter logs what it withheld against the error's
 *    `errorId`, which is what reaches the client.
 * 5. Adapters declare the type keys they cannot store — keys whose physical
 *    form would collide with the adapter's own storage objects — through
 *    `reservedEntityTypeKeys()` and `reservedRelationTypeKeys()` on the
 *    modeling store. They return plain type keys, never physical names, so
 *    the modeling service can reject a colliding key without knowing why it
 *    collides. An adapter with no such collisions returns empty sets.
 *
 * The reference implementation and the authoritative method list is the
 * Neo4j adapter: `adapters/neo4j/modelingStore.ts` and
 * `adapters/neo4j/runtimeStore.ts`. A future adapter implements the same
 * method surface and is registered in `initStores`.
 */

import { settings } from "../config.js";
import type { Neo4jModelingStore } from "../adapters/neo4j/modelingStore.js";
import type { Neo4jRuntimeStore } from "../adapters/neo4j/runtimeStore.js";

export type ModelingStore = Neo4jModelingStore;
export type RuntimeStore = Neo4jRuntimeStore;

let modelingStore: ModelingStore | null = null;
let runtimeStore: RuntimeStore | null = null;

function unknownBackend(): never {
  throw new Error(`Unknown DB_BACKEND '${settings.DB_BACKEND}' (supported: neo4j)`);
}

/** Initialize the configured persistence adapter and its stores. */
export async function initStores(): Promise<void> {
  if (settings.DB_BACKEND === "neo4j") {
    const adapter = await import("../adapters/neo4j/index.js");
    [modelingStore, runtimeStore] = await adapter.createStores();
  } else {
    unknownBackend();
  }
}

export async function closeStores(): Promise<void> {
  if (settings.DB_BACKEND === "neo4j") {
    const adapter = await import("../adapters/neo4j/index.js");
    await adapter.closeStores();
  }
  modelingStore = null;
  runtimeStore = null;
}

/** Ensure the adapter's semantic-search indexes exist (startup hook). */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  if (settings.DB_BACKEND === "neo4j") {
    const adapter = await import("../adapters/neo4j/index.js");
    await adapter.ensureSemanticIndexes(dimensions);
  } else {
    unknownBackend();
  }
}

/** Delete all stored data via the active adapter. Test support only. */
export async function wipeDatabase(): Promise<void> {
  if (settings.DB_BACKEND === "neo4j") {
    const adapter = await import("../adapters/neo4j/index.js");
    await adapter.wipe();
  } else {
    unknownBackend();
  }
}

export function getModelingStore(): ModelingStore {
  if (modelingStore === null) {
    throw new Error("Stores not initialized");
  }
  return modelingStore;
}

export function getRuntimeStore(): RuntimeStore {
  if (runtimeStore === null) {
    throw new Error("Stores not initialized");
  }
  return runtimeStore;
}
