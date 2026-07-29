/**
 * Neo4j query functions for the modeling store.
 *
 * Adapter-private. Every function takes a `Session` as its first argument
 * and is invoked exclusively by `Neo4jModelingStore`, which owns the
 * session lifecycle.
 */

import type { Session } from "neo4j-driver";

export interface ReservedTypeKeyInUse {
  kind: "entityType" | "relationType";
  key: string;
}

/**
 * Find stored types whose key is reserved (created before the check existed).
 *
 * The id filters keep this read correct in exactly the state it detects: an
 * instance of a collided type carries the schema label too, so an unfiltered
 * read would return counterfeit rows.
 */
export async function findReservedTypeKeysInUse(
  session: Session,
  entityTypeKeys: string[],
  relationTypeKeys: string[],
): Promise<ReservedTypeKeyInUse[]> {
  const result = await session.run(
    `
    MATCH (et:EntityType)
    WHERE et.entityTypeId IS NOT NULL AND et.key IN $entityTypeKeys
    RETURN 'entityType' AS kind, et.key AS key
    UNION
    MATCH (rt:RelationType)
    WHERE rt.relationTypeId IS NOT NULL AND rt.key IN $relationTypeKeys
    RETURN 'relationType' AS kind, rt.key AS key
    `,
    { entityTypeKeys, relationTypeKeys },
  );
  return result.records.map((record) => ({
    kind: record.get("kind") as ReservedTypeKeyInUse["kind"],
    key: record.get("key") as string,
  }));
}
