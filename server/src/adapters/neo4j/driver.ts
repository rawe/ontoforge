/**
 * Neo4j driver lifecycle and schema constraints.
 *
 * Adapter-private: nothing outside `adapters/neo4j` may import the driver.
 */

import type { Driver } from "neo4j-driver";
import neo4j, { Neo4jError } from "neo4j-driver";

import { settings } from "../../config.js";
import { CONSTRAINTS } from "./ddl.js";
import { runSession, toStoreError } from "./errors.js";

let driverInstance: Driver | null = null;

async function ensureConstraints(driver: Driver): Promise<void> {
  await runSession(driver, async (session) => {
    for (const constraint of CONSTRAINTS) {
      await session.run(constraint);
    }
  });
}

export async function initDriver(): Promise<Driver> {
  driverInstance = neo4j.driver(
    settings.DB_URI,
    neo4j.auth.basic(settings.DB_USER, settings.DB_PASSWORD),
    // Plain JS numbers cross the port, never driver Integer objects.
    { disableLosslessIntegers: true },
  );
  try {
    await driverInstance.verifyConnectivity();
  } catch (exc) {
    if (exc instanceof Neo4jError) {
      throw toStoreError(exc);
    }
    throw exc;
  }
  await ensureConstraints(driverInstance);
  return driverInstance;
}

export function getDriver(): Driver {
  if (driverInstance === null) {
    throw new Error("Neo4j driver not initialized");
  }
  return driverInstance;
}

export async function closeDriver(): Promise<void> {
  if (driverInstance !== null) {
    await driverInstance.close();
    driverInstance = null;
  }
}
