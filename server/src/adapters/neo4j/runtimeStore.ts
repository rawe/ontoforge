/**
 * Neo4j implementation of the runtime store (instance-data persistence).
 *
 * Implements the runtime side of the persistence port (see
 * `core/ports.ts`). No operations exist yet — the runtime slices add them;
 * the class exists so the port's two store surfaces are both real from the
 * first boot.
 */

import type { Driver } from "neo4j-driver";

export class Neo4jRuntimeStore {
  constructor(private readonly driver: Driver) {}
}
