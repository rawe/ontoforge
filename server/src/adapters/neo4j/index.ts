/**
 * Neo4j persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on Neo4j.
 * Everything Neo4j-specific — the bolt driver, Cypher text, labels, index
 * DDL, driver temporal types — lives inside this package and must not be
 * imported from anywhere else in the server.
 */

import { StoreError } from "../../core/exceptions.js";
import type { OntologyRegistry, Row } from "../../core/ports.js";
import { ensureVectorIndexes } from "./ddl.js";
import { closeDriver, getDriver, initDriver } from "./driver.js";
import { Neo4jModelingStore } from "./modelingStore.js";
import { Neo4jRuntimeStore } from "./runtimeStore.js";

/** Initialize the Neo4j adapter: connect and verify the driver. */
export async function initAdapter(): Promise<void> {
  await initDriver();
}

/**
 * The single-graph stores. This adapter holds at most one ontology
 * (spec §6.6; the capped registry is ticket 18's), so the binding key
 * selects nothing physical yet — today's label derivation and Cypher
 * stay valid unchanged.
 */
export function createModelingStore(_ontologyKey: string): Neo4jModelingStore {
  return new Neo4jModelingStore(getDriver());
}

export function createRuntimeStore(_ontologyKey: string): Neo4jRuntimeStore {
  return new Neo4jRuntimeStore(getDriver());
}

/**
 * The one-ontology-capped Neo4j registry is not built yet; until it is,
 * every registry operation rejects as a `StoreError` (port contract rule
 * 4: nothing else crosses the port, and the client sees no backend
 * detail — the cause is logged against the error id). The adapter itself
 * still initializes and serves — only the registry surface is
 * unavailable on this backend.
 */
export function createRegistry(): OntologyRegistry {
  const unavailable = (): Promise<never> => {
    const error = new StoreError();
    console.error(
      `Storage failure ${error.errorId}: the ontology registry is not ` +
        "implemented on this backend yet",
    );
    return Promise.reject(error);
  };
  return {
    createOntology: (): Promise<Row> => unavailable(),
    listOntologies: (): Promise<Row[]> => unavailable(),
    getOntology: (): Promise<Row | null> => unavailable(),
    getOntologyByDisplayName: (): Promise<Row | null> => unavailable(),
    renameOntology: (): Promise<Row | null> => unavailable(),
    deleteOntology: (): Promise<boolean> => unavailable(),
  };
}

export async function closeStores(): Promise<void> {
  await closeDriver();
}

/**
 * Ensure all vector indexes exist for the configured dimensions.
 *
 * The startup path (architecture step 5): width mismatches are REPORTED and
 * nothing is repaired — only the rebuild operation recreates a drifted
 * index, immediately before regenerating the vectors that fill it
 * (`docs/decisions.md#behaviour`).
 */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  await ensureVectorIndexes(getDriver(), dimensions, false);
}
