/**
 * Schema-mutation lifecycle hooks: document-chunk cleanup and
 * vector-index DDL, called by the modeling service on every mutating path.
 *
 * Chunk cleanup is UNCONDITIONAL — the stored chunks of a dropped document
 * property (or entity type) are deleted whether or not an embedding
 * provider is configured, because chunks may survive from an earlier
 * configuration or an import. Dropping a vector index is a no-op against
 * an absent index, so document-index drops are unconditional too; index
 * CREATION is gated on the provider.
 */

import { getEmbeddingProvider } from "../core/embedding.js";
import type { ModelingStore } from "../core/ports.js";

/** After an entity type is created: create its per-type vector index. */
export async function onEntityTypeCreated(
  store: ModelingStore,
  entityTypeKey: string,
): Promise<void> {
  const provider = getEmbeddingProvider();
  if (provider) {
    await store.createVectorIndex(entityTypeKey, provider.dimensions);
  }
}

/** Remove all chunk nodes and the vector index of a document property. */
async function dropDocumentPropertyArtifacts(
  store: ModelingStore,
  entityTypeKey: string,
  propertyKey: string,
): Promise<void> {
  await store.deleteChunksForTypeProperty(entityTypeKey, propertyKey);
  await store.dropDocumentVectorIndex(entityTypeKey, propertyKey);
}

/** Rebuild the vector index for an entity type after property changes, so
 * its in-index filter properties stay in step with the schema. */
async function rebuildEntityTypeVectorIndex(
  store: ModelingStore,
  entityTypeId: string,
): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    return;
  }
  const et = await store.getEntityType(entityTypeId);
  if (et) {
    await store.rebuildVectorIndex(et.key as string, provider.dimensions);
  }
}

/**
 * After an entity type is deleted: drop the chunks and chunk index of each
 * `document` property, then the type's own vector index. `properties` are
 * the type's property definitions, fetched before the delete removed them.
 */
export async function onEntityTypeDeleted(
  store: ModelingStore,
  entityTypeKey: string,
  properties: Record<string, unknown>[],
): Promise<void> {
  for (const prop of properties) {
    if (prop.dataType === "document") {
      await dropDocumentPropertyArtifacts(store, entityTypeKey, prop.key as string);
    }
  }
  if (getEmbeddingProvider()) {
    await store.dropVectorIndex(entityTypeKey);
  }
}

/**
 * After a property is created on an entity type: rebuild the type's vector
 * index; for a `document` property, create its chunk index.
 */
export async function onEntityTypePropertyCreated(
  store: ModelingStore,
  entityTypeId: string,
  property: Record<string, unknown>,
): Promise<void> {
  await rebuildEntityTypeVectorIndex(store, entityTypeId);
  if (property.dataType === "document") {
    const provider = getEmbeddingProvider();
    if (provider) {
      const et = await store.getEntityType(entityTypeId);
      if (et) {
        await store.createDocumentVectorIndex(
          et.key as string,
          property.key as string,
          provider.dimensions,
        );
      }
    }
  }
}

/**
 * After a property is deleted from an entity type: rebuild the type's
 * vector index; for a `document` property, drop its chunks and chunk index.
 */
export async function onEntityTypePropertyDeleted(
  store: ModelingStore,
  entityTypeId: string,
  property: Record<string, unknown>,
): Promise<void> {
  await rebuildEntityTypeVectorIndex(store, entityTypeId);
  if (property.dataType === "document") {
    const et = await store.getEntityType(entityTypeId);
    if (et) {
      await dropDocumentPropertyArtifacts(store, et.key as string, property.key as string);
    }
  }
}
