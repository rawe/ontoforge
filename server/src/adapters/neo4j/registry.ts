/**
 * `OntologyRegistry` on Neo4j: capped at exactly one ontology.
 *
 * The adapter stores everything in one graph, and the label derivation
 * and Cypher throughout this package assume they own it — so the
 * registry holds at most one ontology and rejects a second create as a
 * domain conflict (spec: multiple isolated ontologies, §6.6). With one
 * ontology the binding key selects nothing physical; lifting the cap is
 * a separate future effort.
 *
 * The registry row lives on a single `_OntologyRegistry` node.
 * Underscore-prefixed like `_Entity` and `_Chunk`, the label reserves no
 * type key (`ddl.ts`). Delete is the hard cascade at this adapter's
 * scale: the ontology's physical home is the whole graph, so every node
 * — schema objects, instances, chunks, and the registry node itself —
 * and every vector index (width and filter-property imprints of the
 * deleted schema) go together; the boot constraints stay, as the
 * server-wide skeleton.
 */

import type { Driver } from "neo4j-driver";

import { ConflictError } from "../../core/exceptions.js";
import type { OntologyRegistry, Row } from "../../core/ports.js";
import { ensureEntityVectorIndex, ensureSavedQueryVectorIndex } from "./ddl.js";
import { runSession } from "./errors.js";
import { convertNeo4jProperties } from "./temporal.js";

const REGISTRY_LABEL = "_OntologyRegistry";

/** The port row: driver temporals converted, an absent display name
 * (Neo4j stores no null properties) surfacing as null. */
function toRegistryRow(props: Row): Row {
  return { displayName: null, ...convertNeo4jProperties(props) };
}

/** The cap, as a domain condition — nothing physical in the message. */
function capConflict(): ConflictError {
  return new ConflictError(
    "The storage backend holds at most one ontology; " +
      "delete the existing ontology first",
  );
}

/** Whether the registry holds its one ontology — what the adapter's
 * semantic-index maintenance checks before touching the graph
 * (`index.ts`). */
export async function registryHoldsOntology(driver: Driver): Promise<boolean> {
  return runSession(driver, async (session) => {
    const result = await session.run(
      `MATCH (r:${REGISTRY_LABEL}) RETURN count(r) AS registered`,
    );
    return ((result.records[0]?.get("registered") as number) ?? 0) > 0;
  });
}

/** The key of the one registered ontology, or null when there is none.
 * The adapter's maintenance names the ontology by this key when it has
 * something to report (`index.ts`). */
export async function registeredOntologyKey(driver: Driver): Promise<string | null> {
  return runSession(driver, async (session) => {
    const result = await session.run(
      `MATCH (r:${REGISTRY_LABEL}) RETURN r.key AS key LIMIT 1`,
    );
    return (result.records[0]?.get("key") as string | undefined) ?? null;
  });
}

export class Neo4jOntologyRegistry implements OntologyRegistry {
  constructor(private readonly driver: Driver) {}

  async createOntology(
    ontologyId: string,
    key: string,
    displayName: string | null,
    embeddingDimensions: number | null,
  ): Promise<Row> {
    // The cap first, so a rejected create touches nothing — the
    // conflict is an expected condition and must have no side effects.
    if (await registryHoldsOntology(this.driver)) {
      throw capConflict();
    }
    // Then the fixed semantic indexes, then the node: index DDL cannot
    // share a transaction with the node write, and this order keeps the
    // port's atomicity promise — a create that dies mid-way has changed
    // nothing observable through the port (no registry entry, no
    // ontology; a retry provisions identically), because an empty fixed
    // index is an adapter-private physical object the next create
    // re-ensures idempotently. The reverse order could register an
    // ontology whose home lacks its indexes.
    if (embeddingDimensions !== null) {
      await ensureEntityVectorIndex(this.driver, embeddingDimensions);
      await ensureSavedQueryVectorIndex(this.driver, embeddingDimensions);
    }
    const created = await runSession(this.driver, async (session) => {
      // Check again and create in one statement — the backstop that
      // keeps the cap inside this transaction: with a registry node
      // present the WHERE filters the row away and nothing is created.
      const result = await session.run(
        `
        OPTIONAL MATCH (existing:${REGISTRY_LABEL})
        WITH existing LIMIT 1
        WHERE existing IS NULL
        CREATE (r:${REGISTRY_LABEL} {
            ontologyId: $ontologyId,
            key: $key,
            displayName: $displayName,
            createdAt: datetime(),
            updatedAt: datetime()
        })
        RETURN r {.*} AS ontology
        `,
        { ontologyId, key, displayName },
      );
      const record = result.records[0];
      return record === undefined ? null : (record.get("ontology") as Row);
    });
    if (created === null) {
      throw capConflict();
    }
    return toRegistryRow(created);
  }

  async listOntologies(): Promise<Row[]> {
    return runSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (r:${REGISTRY_LABEL}) RETURN r {.*} AS ontology ORDER BY r.key`,
      );
      return result.records.map((record) => toRegistryRow(record.get("ontology") as Row));
    });
  }

  async getOntology(key: string): Promise<Row | null> {
    return runSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (r:${REGISTRY_LABEL} {key: $key}) RETURN r {.*} AS ontology`,
        { key },
      );
      const record = result.records[0];
      return record === undefined ? null : toRegistryRow(record.get("ontology") as Row);
    });
  }

  async getOntologyByDisplayName(displayName: string): Promise<Row | null> {
    return runSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (r:${REGISTRY_LABEL} {displayName: $displayName}) RETURN r {.*} AS ontology`,
        { displayName },
      );
      const record = result.records[0];
      return record === undefined ? null : toRegistryRow(record.get("ontology") as Row);
    });
  }

  async renameOntology(key: string, displayName: string): Promise<Row | null> {
    return runSession(this.driver, async (session) => {
      const result = await session.run(
        `
        MATCH (r:${REGISTRY_LABEL} {key: $key})
        SET r.displayName = $displayName, r.updatedAt = datetime()
        RETURN r {.*} AS ontology
        `,
        { key, displayName },
      );
      const record = result.records[0];
      return record === undefined ? null : toRegistryRow(record.get("ontology") as Row);
    });
  }

  async deleteOntology(key: string): Promise<boolean> {
    return runSession(this.driver, async (session) => {
      const found = await session.run(
        `MATCH (r:${REGISTRY_LABEL} {key: $key}) RETURN r.key AS key`,
        { key },
      );
      if (found.records.length === 0) {
        return false;
      }
      await session.run("MATCH (n) DETACH DELETE n");
      const indexes = await session.run("SHOW VECTOR INDEXES YIELD name RETURN name");
      for (const record of indexes.records) {
        await session.run(`DROP INDEX \`${record.get("name") as string}\` IF EXISTS`);
      }
      return true;
    });
  }
}
