/**
 * Vector-index lifecycle hooks for schema mutations.
 *
 * Seam: session 08 (semantic search) fills these with the vector-index DDL
 * the Python service performs when an embedding provider is configured —
 * create the type's index on entity-type creation, drop indexes and stored
 * document passages on deletion, rebuild the index and manage per-document
 * indexes on property changes. Until a provider can be configured every
 * hook is a no-op, but the modeling service already calls each one at the
 * same point the Python service does, so wiring does not change when the
 * implementations arrive.
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
 * After an entity type is deleted (Python: drop the document artifacts of
 * each `document` property, then `drop_vector_index`). `properties` are the
 * type's property definitions, fetched before the delete removed them.
 */
export async function onEntityTypeDeleted(
  store: ModelingStore,
  entityTypeKey: string,
  properties: Record<string, unknown>[],
): Promise<void> {
  void store;
  void entityTypeKey;
  void properties;
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
 * After a property is deleted from an entity type (Python: rebuild the
 * type's vector index; drop the document artifacts of a `document`
 * property).
 */
export async function onEntityTypePropertyDeleted(
  store: ModelingStore,
  entityTypeId: string,
  property: Record<string, unknown>,
): Promise<void> {
  void store;
  void entityTypeId;
  void property;
}
