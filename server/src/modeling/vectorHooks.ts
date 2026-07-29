/**
 * Schema-mutation lifecycle hooks: document-chunk cleanup (live) and
 * vector-index DDL (session-08 seam).
 *
 * Chunk cleanup is UNCONDITIONAL — the Python service deletes the stored
 * chunks of a dropped document property (or entity type) whether or not an
 * embedding provider is configured, because chunks may survive from an
 * earlier configuration or an import.
 *
 * Seam: session 08 (semantic search) adds the vector-index DDL the Python
 * service performs when an embedding provider is configured — create the
 * type's index on entity-type creation, drop the entity and per-document
 * indexes on deletion, rebuild the index on property changes. The modeling
 * service already calls each hook at the same point the Python service
 * does, so wiring does not change when those implementations arrive.
 */

import type { ModelingStore } from "../core/ports.js";

/** After an entity type is created (Python: `create_vector_index`). */
export async function onEntityTypeCreated(
  store: ModelingStore,
  entityTypeKey: string,
): Promise<void> {
  void store;
  void entityTypeKey;
}

/**
 * After an entity type is deleted: drop the stored chunks of each
 * `document` property. `properties` are the type's property definitions,
 * fetched before the delete removed them. (Session 08 adds: drop each
 * document property's vector index, then `drop_vector_index` for the
 * type.)
 */
export async function onEntityTypeDeleted(
  store: ModelingStore,
  entityTypeKey: string,
  properties: Record<string, unknown>[],
): Promise<void> {
  for (const prop of properties) {
    if (prop.dataType === "document") {
      await store.deleteChunksForTypeProperty(entityTypeKey, prop.key as string);
    }
  }
}

/**
 * After a property is created on an entity type (Python: rebuild the
 * type's vector index; create the document index for a `document`
 * property).
 */
export async function onEntityTypePropertyCreated(
  store: ModelingStore,
  entityTypeId: string,
  property: Record<string, unknown>,
): Promise<void> {
  void store;
  void entityTypeId;
  void property;
}

/**
 * After a property is deleted from an entity type: drop the stored chunks
 * of a `document` property. (Session 08 adds: rebuild the type's vector
 * index; drop the document property's vector index.)
 */
export async function onEntityTypePropertyDeleted(
  store: ModelingStore,
  entityTypeId: string,
  property: Record<string, unknown>,
): Promise<void> {
  if (property.dataType === "document") {
    const et = await store.getEntityType(entityTypeId);
    if (et) {
      await store.deleteChunksForTypeProperty(et.key as string, property.key as string);
    }
  }
}
