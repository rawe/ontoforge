/**
 * `RuntimeStore` on PostgreSQL — M1 skeleton.
 *
 * Every method throws until its operations land (M3 CRUD/OQL, M4 vectors
 * and documents) — never a silent no-op.
 */

import type { Row, RuntimeStore } from "../../core/ports.js";
import { notImplemented } from "./notImplemented.js";

export class PostgresRuntimeStore implements RuntimeStore {
  // ------------------------------------------------------------------
  // Schema reading (for the runtime schema cache)
  // ------------------------------------------------------------------

  getFullSchema(): Promise<Row | null> {
    return notImplemented("getFullSchema");
  }

  getAiAgentConfigs(): Promise<Row[]> {
    return notImplemented("getAiAgentConfigs");
  }

  getSavedQueries(): Promise<Row[]> {
    return notImplemented("getSavedQueries");
  }

  // ------------------------------------------------------------------
  // Vector-index metadata validation
  // ------------------------------------------------------------------

  validateVectorIndexedProperties(): void {
    notImplemented("validateVectorIndexedProperties");
  }

  // ------------------------------------------------------------------
  // Entity instances
  // ------------------------------------------------------------------

  createEntity(): Promise<Row> {
    return notImplemented("createEntity");
  }

  listEntities(): Promise<[Row[], number]> {
    return notImplemented("listEntities");
  }

  getEntity(): Promise<Row | null> {
    return notImplemented("getEntity");
  }

  getEntityById(): Promise<Row | null> {
    return notImplemented("getEntityById");
  }

  updateEntity(): Promise<Row | null> {
    return notImplemented("updateEntity");
  }

  deleteEntity(): Promise<boolean> {
    return notImplemented("deleteEntity");
  }

  // ------------------------------------------------------------------
  // Document chunks
  // ------------------------------------------------------------------

  getChunkEmbeddingsForEntityProperty(): Promise<Record<string, number[]>> {
    return notImplemented("getChunkEmbeddingsForEntityProperty");
  }

  deleteChunksForEntityProperty(): Promise<void> {
    return notImplemented("deleteChunksForEntityProperty");
  }

  createDocumentChunks(): Promise<void> {
    return notImplemented("createDocumentChunks");
  }

  searchDocumentChunks(): Promise<Row[]> {
    return notImplemented("searchDocumentChunks");
  }

  getEntitiesByIds(): Promise<Record<string, Row>> {
    return notImplemented("getEntitiesByIds");
  }

  // ------------------------------------------------------------------
  // Semantic search
  // ------------------------------------------------------------------

  semanticSearch(): Promise<Row[]> {
    return notImplemented("semanticSearch");
  }

  semanticSearchAll(): Promise<Row[]> {
    return notImplemented("semanticSearchAll");
  }

  searchSavedQueries(): Promise<Row[]> {
    return notImplemented("searchSavedQueries");
  }

  // ------------------------------------------------------------------
  // Relation instances
  // ------------------------------------------------------------------

  createRelation(): Promise<Row> {
    return notImplemented("createRelation");
  }

  listRelations(): Promise<[Row[], number]> {
    return notImplemented("listRelations");
  }

  getRelation(): Promise<Row | null> {
    return notImplemented("getRelation");
  }

  updateRelation(): Promise<Row | null> {
    return notImplemented("updateRelation");
  }

  deleteRelation(): Promise<boolean> {
    return notImplemented("deleteRelation");
  }

  // ------------------------------------------------------------------
  // OQL
  // ------------------------------------------------------------------

  executeOql(): Promise<[string[], Row[]]> {
    return notImplemented("executeOql");
  }

  // ------------------------------------------------------------------
  // Graph traversal
  // ------------------------------------------------------------------

  getNeighbors(): Promise<Row[]> {
    return notImplemented("getNeighbors");
  }
}
