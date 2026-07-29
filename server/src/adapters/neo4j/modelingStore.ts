/**
 * Neo4j implementation of the modeling store (schema persistence).
 *
 * Implements the modeling side of the persistence port (see
 * `core/ports.ts`). Each method owns its session — opened through
 * `runSession`, so driver failures surface as `StoreError` (rule 4) — and
 * delegates to the query functions in `modelingQueries.ts`.
 *
 * Only the reserved-key surface exists yet; schema CRUD arrives with the
 * modeling slice.
 */

import type { Driver } from "neo4j-driver";

import { reservedEntityTypeKeys, reservedRelationTypeKeys } from "./ddl.js";
import { runSession } from "./errors.js";
import { findReservedTypeKeysInUse, type ReservedTypeKeyInUse } from "./modelingQueries.js";

export class Neo4jModelingStore {
  constructor(private readonly driver: Driver) {}

  /** Entity type keys this adapter cannot store (see `ddl.ts`). */
  reservedEntityTypeKeys(): ReadonlySet<string> {
    return reservedEntityTypeKeys();
  }

  /** Relation type keys this adapter cannot store (see `ddl.ts`). */
  reservedRelationTypeKeys(): ReadonlySet<string> {
    return reservedRelationTypeKeys();
  }

  /** Stored types with a now-reserved key, as `{kind, key}` rows. */
  async findReservedTypeKeysInUse(): Promise<ReservedTypeKeyInUse[]> {
    return runSession(this.driver, (session) =>
      findReservedTypeKeysInUse(
        session,
        [...reservedEntityTypeKeys()].sort(),
        [...reservedRelationTypeKeys()].sort(),
      ),
    );
  }
}
