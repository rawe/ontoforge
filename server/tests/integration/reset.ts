/**
 * Test-harness database reset — deliberately outside the persistence
 * port: an adapter ships no test-only surface, so the wipe
 * implementations live here, one per adapter, dispatched on `DB_BACKEND`.
 *
 * `wipeDatabase` is the per-file fast reset every integration file runs
 * between tests. It needs the adapter initialized (`initStores`) and
 * deletes all stored data while keeping schema objects.
 */

import { getDriver } from "../../src/adapters/neo4j/driver.js";
import { runSession } from "../../src/adapters/neo4j/errors.js";
import { withTransaction } from "../../src/adapters/postgres/errors.js";
import { quoteIdent } from "../../src/adapters/postgres/oql/bindings.js";
import { settings } from "../../src/config.js";

/** All ten tables — kept in step with the adapter's init DDL. */
const ALL_TABLES = [
  "ontology",
  "entity_type",
  "relation_type",
  "property_def",
  "ontology_includes",
  "ai_agent_config",
  "saved_query",
  "entity",
  "relation",
  "document_chunk",
];

/**
 * One `TRUNCATE` across all ten tables plus a drop of every
 * `vec_`-prefixed index, in one transaction. The index drop is
 * load-bearing: a re-created type key gets a fresh uuid-named index while
 * an orphan's `WHERE type_key = …` predicate would still match new rows.
 * The five fixed B-tree indexes and the two fixed vector indexes survive
 * — clearing the width imprint the latter carry is the suite-level hard
 * reset's job, not this one's.
 */
async function wipePostgres(): Promise<void> {
  await withTransaction(async (querier) => {
    await querier.query(`TRUNCATE ${ALL_TABLES.join(", ")}`);
    const indexes = await querier.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema() AND indexname LIKE 'vec\\_%'`,
    );
    for (const row of indexes.rows) {
      await querier.query(`DROP INDEX IF EXISTS ${quoteIdent(row["indexname"] as string)}`);
    }
  });
}

/** Neo4j keeps everything in one graph: deleting every node is the full
 * wipe (constraints and indexes are fixed objects the boot recreates
 * idempotently). */
async function wipeNeo4j(): Promise<void> {
  await runSession(getDriver(), async (session) => {
    await session.run("MATCH (n) DETACH DELETE n");
  });
}

/** Per-file fast reset: delete all stored data via the initialized
 * adapter connection. */
export async function wipeDatabase(): Promise<void> {
  switch (settings.DB_BACKEND) {
    case "postgres":
      await wipePostgres();
      return;
    case "neo4j":
      await wipeNeo4j();
      return;
    default:
      throw new Error(`Unknown DB_BACKEND '${settings.DB_BACKEND}'`);
  }
}
