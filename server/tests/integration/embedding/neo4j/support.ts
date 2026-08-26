/**
 * Neo4j vector-index helpers for the drift scenarios — inducing a genuine
 * width drift means putting real indexes into a state the code never
 * produces on its own, so everything here reaches past the persistence
 * port on purpose.
 */

import * as ddl from "../../../../src/adapters/neo4j/ddl.js";
import { getDriver } from "../../../../src/adapters/neo4j/driver.js";
import { runSession } from "../../../../src/adapters/neo4j/errors.js";

/** The width an existing vector index is configured for, or null. */
export async function indexDimensions(indexName: string): Promise<number | null> {
  return ddl.existingVectorIndexDimensions(getDriver(), indexName);
}

/** Wait until a vector index reports ONLINE. */
export async function waitForIndexOnline(indexName: string, timeoutMs = 15_000): Promise<void> {
  const driver = getDriver();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await runSession(driver, async (session) => {
      const result = await session.run(
        "SHOW VECTOR INDEXES YIELD name, state WHERE name = $name RETURN state",
        { name: indexName },
      );
      return result.records[0]?.get("state") as string | undefined;
    });
    if (state === "ONLINE") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Index ${indexName} did not come online within ${timeoutMs}ms`);
}

/** Drop and recreate one of the two drifting indexes at a given width. */
export async function rebuildIndexAt(indexName: string, dimensions: number): Promise<void> {
  const driver = getDriver();
  await runSession(driver, async (session) => {
    await session.run(`DROP INDEX ${indexName} IF EXISTS`);
  });
  if (indexName === ddl.ENTITY_VECTOR_INDEX_NAME) {
    await ddl.ensureEntityVectorIndex(driver, dimensions);
  } else {
    await ddl.createVectorIndex(driver, indexName.replace(/_embedding$/, ""), dimensions);
  }
  await waitForIndexOnline(indexName);
}
