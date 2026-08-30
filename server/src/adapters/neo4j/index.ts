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

/** Initialize the Neo4j adapter and return `[modelingStore, runtimeStore]`. */
export async function createStores(): Promise<[Neo4jModelingStore, Neo4jRuntimeStore]> {
  const driver = await initDriver();
  return [new Neo4jModelingStore(driver), new Neo4jRuntimeStore(driver)];
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
