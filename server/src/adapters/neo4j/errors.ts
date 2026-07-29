/**
 * Driver-error translation at the persistence-port boundary.
 *
 * Port contract rule 4 (`core/ports.ts`): driver exceptions never cross the
 * port. Every database access in this adapter goes through `runSession`,
 * which turns any driver failure into `StoreError` — the domain exception
 * for a storage failure no domain exception describes.
 *
 * Expected conditions are not handled here: they are pre-checked by the
 * services or expressed as `null` returns from the query modules. What
 * reaches this translation is the unexpected — connection loss, timeouts,
 * index state problems, constraint violations the code did not anticipate.
 *
 * The driver's own message never reaches the caller: it names the vendor
 * and leaks physical naming, both of which stay out of the public surface.
 * It is logged instead, against the `errorId` the client receives, so a
 * reported failure can be traced back to its server-side record.
 *
 * The catch is narrow: only `Neo4jError` (the driver's single error
 * hierarchy, covering both server-side and client-side failures) is
 * translated. Domain exceptions raised inside the scope — and ordinary
 * programming errors like `TypeError` — propagate unchanged.
 */

import type { Driver, Session } from "neo4j-driver";
import { Neo4jError } from "neo4j-driver";

import { StoreError } from "../../core/exceptions.js";

/** Log a driver failure and return the `StoreError` that replaces it. */
export function toStoreError(exc: Error): StoreError {
  const error = new StoreError();
  error.cause = exc;
  console.error(
    `Storage failure ${error.errorId}: ${exc.name}: ${exc.message}`,
    exc.stack ?? "",
  );
  return error;
}

/**
 * Run `work` in a driver session whose failures surface as `StoreError`.
 *
 * The adapter's only door to the database — no other module may call
 * `driver.session()` (pinned by a test). Catches only driver exceptions,
 * so domain exceptions thrown inside `work` (and ordinary bugs) keep
 * propagating unchanged.
 */
export async function runSession<T>(
  driver: Driver,
  work: (session: Session) => Promise<T>,
): Promise<T> {
  try {
    const session = driver.session();
    try {
      return await work(session);
    } finally {
      await session.close();
    }
  } catch (exc) {
    if (exc instanceof Neo4jError) {
      throw toStoreError(exc);
    }
    throw exc;
  }
}
