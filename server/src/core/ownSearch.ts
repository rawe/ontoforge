/**
 * An adapter's own search storage: the per-entity vectors, document
 * chunks and vector indexes an adapter without search indices keeps
 * (`supportsSearchIndices()` false). The port methods that serve it are
 * optional (`core/ports.ts`, marked "own search storage"); this module
 * names them and narrows a store to them. A module of its own so the
 * many test doubles of `core/ports.ts` need not provide the guard.
 */

import type { ModelingStore, RuntimeStore } from "./ports.js";

/** The runtime methods of an adapter's own search storage: per-entity
 * vectors, document chunks and the rankings over them. */
type OwnSearchRuntimeMethods =
  | "validateVectorIndexedProperties"
  | "getChunkEmbeddingsForEntityProperty"
  | "deleteChunksForEntityProperty"
  | "createDocumentChunks"
  | "propertySearchSemantic"
  | "documentSearchSemantic";

/** The modeling methods of an adapter's own search storage: chunk
 * cleanup, the rebuild's entity reads and writes, and the per-type and
 * per-document vector-index DDL. */
type OwnSearchModelingMethods =
  | "deleteChunksForTypeProperty"
  | "getEntityTypesWithProperties"
  | "setEntityEmbedding"
  | "createVectorIndex"
  | "dropVectorIndex"
  | "rebuildVectorIndex"
  | "createDocumentVectorIndex"
  | "dropDocumentVectorIndex";

export type OwnSearchRuntimeStore = RuntimeStore & Required<Pick<RuntimeStore, OwnSearchRuntimeMethods>>;
export type OwnSearchModelingStore = ModelingStore & Required<Pick<ModelingStore, OwnSearchModelingMethods>>;

/**
 * Whether a store keeps its adapter's own search storage — exactly when
 * the adapter stores no search indices. Search indices maintain
 * themselves (`runtime/indexing/`); an adapter without them stores each
 * entity's vector and its documents' chunks with every write and searches
 * those (`docs/storage-adapters.md`, "Where the adapters diverge").
 */
export function keepsOwnSearch(store: RuntimeStore): store is OwnSearchRuntimeStore;
export function keepsOwnSearch(store: ModelingStore): store is OwnSearchModelingStore;
export function keepsOwnSearch(store: RuntimeStore | ModelingStore): boolean {
  return store.searchIndices === undefined;
}
