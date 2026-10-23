/**
 * The design guard: one ontology's design revision and the lock that keeps
 * data writes and design changes apart.
 *
 * The revision is the one row of `design_revision` in the namespace. The
 * lock is a transaction-scoped advisory lock keyed by the namespace —
 * shared for a data write, which checks the revision it validated
 * against, exclusive for a design change, which advances it. Shared holds
 * never wait for each other; an exclusive request waits for them and new
 * shared requests queue behind it, so a design change is not starved by
 * steady writes. A wait past the lock timeout is the doors' 55P03, a
 * conflict. The design lock is always the first lock a transaction takes.
 */

import type { DesignRevision } from "../../core/ports.js";
import { runQuery, type Querier } from "./errors.js";
import { quoteIdent } from "./oql/bindings.js";

/** How long a transaction waits for the design lock (and, after it, for
 * any other lock it takes). */
const LOCK_TIMEOUT = "5s";

const LOCK_KEY = "hashtextextended('ontoforge.design.' || current_schema(), 0)";

const REVISION = "SELECT ontology_id, revision FROM design_revision";

function toDesign(row: Record<string, unknown> | undefined): DesignRevision {
  if (row === undefined) throw new Error("The namespace has no design revision");
  return { ontologyId: row["ontology_id"] as string, revision: row["revision"] as number };
}

/** The revision now, without a lock: on the transaction's connection, or
 * as one statement qualified by the namespace. */
export async function readDesign(querier: Querier | undefined, namespace: string | undefined): Promise<DesignRevision> {
  if (querier !== undefined) return toDesign((await querier.query(REVISION)).rows[0]);
  const table = namespace === undefined ? "design_revision" : `${quoteIdent(namespace)}.design_revision`;
  return toDesign((await runQuery(`SELECT ontology_id, revision FROM ${table}`)).rows[0]);
}

/** Hold the design for the rest of the transaction — shared or
 * exclusively — and read the revision after the wait, in a statement of
 * its own, so it is the one in force. */
async function hold(querier: Querier, mode: "shared" | "exclusive"): Promise<DesignRevision> {
  await querier.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  const lock = mode === "shared" ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock";
  await querier.query(`SELECT ${lock}(${LOCK_KEY})`);
  return toDesign((await querier.query(REVISION)).rows[0]);
}

/** Hold the design shared: what a data write does before its first read. */
export function holdDesignShared(querier: Querier): Promise<DesignRevision> {
  return hold(querier, "shared");
}

/** Hold the design exclusively: what a design change and a generation
 * creation do first. */
export function holdDesignExclusive(querier: Querier): Promise<DesignRevision> {
  return hold(querier, "exclusive");
}

/** Advance the revision within the transaction holding it exclusively. */
export async function advanceDesign(querier: Querier): Promise<DesignRevision> {
  return toDesign(
    (await querier.query(`UPDATE design_revision SET revision = revision + 1 RETURNING ontology_id, revision`)).rows[0],
  );
}
