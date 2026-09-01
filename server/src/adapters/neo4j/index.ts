/**
 * Neo4j persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on Neo4j.
 * Everything Neo4j-specific — the bolt driver, Cypher text, labels, index
 * DDL, driver temporal types — lives inside this package and must not be
 * imported from anywhere else in the server.
 */

import { reportEnsureFailed } from "../../core/vectorDrift.js";
import type { OntologyRegistry } from "../../core/ports.js";
import { ensureVectorIndexes } from "./ddl.js";
import { closeDriver, getDriver, initDriver } from "./driver.js";
import { Neo4jModelingStore } from "./modelingStore.js";
import { Neo4jOntologyRegistry, registeredOntologyKey } from "./registry.js";
import { Neo4jRuntimeStore } from "./runtimeStore.js";

/** Initialize the Neo4j adapter: connect and verify the driver. */
export async function initAdapter(): Promise<void> {
  await initDriver();
}

/**
 * The single-graph stores. This adapter holds at most one ontology (its
 * registry enforces the cap, see `registry.ts`), so the binding key
 * selects nothing physical — today's label derivation and Cypher stay
 * valid unchanged. The port accessors have already verified the key
 * against the registry.
 */
export function createModelingStore(_ontologyKey: string): Neo4jModelingStore {
  return new Neo4jModelingStore(getDriver());
}

export function createRuntimeStore(ontologyKey: string): Neo4jRuntimeStore {
  return new Neo4jRuntimeStore(getDriver(), ontologyKey);
}

/** The one-ontology-capped registry (`registry.ts`). */
export function createRegistry(): OntologyRegistry {
  return new Neo4jOntologyRegistry(getDriver());
}

export async function closeStores(): Promise<void> {
  await closeDriver();
}

/**
 * Ensure all vector indexes exist for the configured dimensions, covering
 * every ontology the registry lists: zero ontologies means nothing to
 * ensure, one means the whole graph.
 *
 * The startup path (architecture step 5): width mismatches are REPORTED and
 * nothing is repaired — only the rebuild operation drops a drifted index,
 * and it regenerates the vectors before building it again
 * (`docs/decisions.md#behaviour`).
 *
 * A failure here cannot stop the boot. An unfinished rebuild leaves
 * vectors of mixed width behind, over which no index can be built;
 * failing to start would take away the server the operator needs to
 * finish that rebuild.
 */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  const driver = getDriver();
  const ontologyKey = await registeredOntologyKey(driver);
  if (ontologyKey === null) {
    return;
  }
  try {
    await ensureVectorIndexes(driver, dimensions);
  } catch {
    reportEnsureFailed(ontologyKey);
  }
}
