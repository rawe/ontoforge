/**
 * Neo4j persistence adapter.
 *
 * Implements the persistence port (see `core/ports.ts`) on Neo4j.
 * Everything Neo4j-specific — the bolt driver, Cypher text, labels, index
 * DDL, driver temporal types — lives inside this package and must not be
 * imported from anywhere else in the server.
 */

import { closeDriver, getDriver, initDriver } from "./driver.js";
import { runSession } from "./errors.js";
import { Neo4jModelingStore } from "./modelingStore.js";
import { Neo4jRuntimeStore } from "./runtimeStore.js";

/** Initialize the Neo4j adapter and return `[modelingStore, runtimeStore]`. */
export async function createStores(): Promise<[Neo4jModelingStore, Neo4jRuntimeStore]> {
  const driver = await initDriver();
  return [new Neo4jModelingStore(driver), new Neo4jRuntimeStore(driver)];
}

export async function closeStores(): Promise<void> {
  await closeDriver();
}

/**
 * Ensure all vector indexes exist for the configured dimensions.
 *
 * Startup seam: vector-index DDL belongs to the semantic-search slice; until
 * it lands there is nothing to ensure, and this is deliberately a no-op.
 */
export async function ensureSemanticIndexes(dimensions: number): Promise<void> {
  void dimensions;
}

/** Delete all stored data. Test support only — never used by the app. */
export async function wipe(): Promise<void> {
  await runSession(getDriver(), async (session) => {
    await session.run("MATCH (n) DETACH DELETE n");
  });
}
