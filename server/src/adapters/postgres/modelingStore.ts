/**
 * `ModelingStore` on PostgreSQL — M1 skeleton.
 *
 * The reserved-key surface is final: under the jsonb mapping a type key
 * is only ever a value in a `type_key` column, never a table, column, or
 * index name, so both reserved sets are provably empty and
 * `findReservedTypeKeysInUse` answers without touching the database.
 *
 * Every other method throws until its operations land (M2.5 modeling
 * operations, M4.2 vector-index lifecycle) — never a silent no-op.
 */

import type { ModelingStore, ReservedTypeKeyInUse, Row } from "../../core/ports.js";
import { notImplemented } from "./notImplemented.js";

const NO_RESERVED_KEYS: ReadonlySet<string> = new Set();

export class PostgresModelingStore implements ModelingStore {
  // ------------------------------------------------------------------
  // Reserved keys
  // ------------------------------------------------------------------

  reservedEntityTypeKeys(): ReadonlySet<string> {
    return NO_RESERVED_KEYS;
  }

  reservedRelationTypeKeys(): ReadonlySet<string> {
    return NO_RESERVED_KEYS;
  }

  findReservedTypeKeysInUse(): Promise<ReservedTypeKeyInUse[]> {
    return Promise.resolve([]);
  }

  // ------------------------------------------------------------------
  // Ontologies
  // ------------------------------------------------------------------

  createOntology(): Promise<Row> {
    return notImplemented("createOntology");
  }

  listOntologies(): Promise<Row[]> {
    return notImplemented("listOntologies");
  }

  getOntology(): Promise<Row | null> {
    return notImplemented("getOntology");
  }

  getOntologyByName(): Promise<Row | null> {
    return notImplemented("getOntologyByName");
  }

  getOntologyByKey(): Promise<Row | null> {
    return notImplemented("getOntologyByKey");
  }

  updateOntology(): Promise<Row | null> {
    return notImplemented("updateOntology");
  }

  deleteOntology(): Promise<boolean> {
    return notImplemented("deleteOntology");
  }

  // ------------------------------------------------------------------
  // Entity types
  // ------------------------------------------------------------------

  createEntityType(): Promise<Row> {
    return notImplemented("createEntityType");
  }

  listEntityTypes(): Promise<Row[]> {
    return notImplemented("listEntityTypes");
  }

  getEntityType(): Promise<Row | null> {
    return notImplemented("getEntityType");
  }

  getEntityTypeByKey(): Promise<Row | null> {
    return notImplemented("getEntityTypeByKey");
  }

  updateEntityType(): Promise<Row | null> {
    return notImplemented("updateEntityType");
  }

  deleteEntityType(): Promise<boolean> {
    return notImplemented("deleteEntityType");
  }

  isEntityTypeReferenced(): Promise<boolean> {
    return notImplemented("isEntityTypeReferenced");
  }

  // ------------------------------------------------------------------
  // Relation types
  // ------------------------------------------------------------------

  createRelationType(): Promise<Row> {
    return notImplemented("createRelationType");
  }

  listRelationTypes(): Promise<Row[]> {
    return notImplemented("listRelationTypes");
  }

  getRelationType(): Promise<Row | null> {
    return notImplemented("getRelationType");
  }

  getRelationTypeByKey(): Promise<Row | null> {
    return notImplemented("getRelationTypeByKey");
  }

  updateRelationType(): Promise<Row | null> {
    return notImplemented("updateRelationType");
  }

  deleteRelationType(): Promise<boolean> {
    return notImplemented("deleteRelationType");
  }

  // ------------------------------------------------------------------
  // Property definitions
  // ------------------------------------------------------------------

  createProperty(): Promise<Row> {
    return notImplemented("createProperty");
  }

  listProperties(): Promise<Row[]> {
    return notImplemented("listProperties");
  }

  getProperty(): Promise<Row | null> {
    return notImplemented("getProperty");
  }

  getPropertyByKey(): Promise<Row | null> {
    return notImplemented("getPropertyByKey");
  }

  updateProperty(): Promise<Row | null> {
    return notImplemented("updateProperty");
  }

  deleteProperty(): Promise<boolean> {
    return notImplemented("deleteProperty");
  }

  // ------------------------------------------------------------------
  // Scope inclusions (lifecycle)
  // ------------------------------------------------------------------

  addIncludesType(): Promise<Row | null> {
    return notImplemented("addIncludesType");
  }

  listIncludesTypes(): Promise<Row[]> {
    return notImplemented("listIncludesTypes");
  }

  updateIncludesType(): Promise<Row | null> {
    return notImplemented("updateIncludesType");
  }

  removeIncludesType(): Promise<boolean> {
    return notImplemented("removeIncludesType");
  }

  // ------------------------------------------------------------------
  // Scope inclusions (cascade-protocol support)
  // ------------------------------------------------------------------

  removeAllIncludesForType(): Promise<number> {
    return notImplemented("removeAllIncludesForType");
  }

  findOntologiesIncludingType(): Promise<string[]> {
    return notImplemented("findOntologiesIncludingType");
  }

  findOntologiesWithExplicitProperty(): Promise<string[]> {
    return notImplemented("findOntologiesWithExplicitProperty");
  }

  addPropertyToIncludesLists(): Promise<number> {
    return notImplemented("addPropertyToIncludesLists");
  }

  removePropertyFromIncludesLists(): Promise<number> {
    return notImplemented("removePropertyFromIncludesLists");
  }

  // ------------------------------------------------------------------
  // Document-property cleanup
  // ------------------------------------------------------------------

  deleteChunksForTypeProperty(): Promise<void> {
    return notImplemented("deleteChunksForTypeProperty");
  }

  // ------------------------------------------------------------------
  // Full schema
  // ------------------------------------------------------------------

  getFullSchema(): Promise<Row> {
    return notImplemented("getFullSchema");
  }

  // ------------------------------------------------------------------
  // AI agent configs
  // ------------------------------------------------------------------

  listAiAgents(): Promise<Row[]> {
    return notImplemented("listAiAgents");
  }

  upsertAiAgent(): Promise<[Row, boolean]> {
    return notImplemented("upsertAiAgent");
  }

  listAiAgentsForExport(): Promise<Row[]> {
    return notImplemented("listAiAgentsForExport");
  }

  deleteAiAgent(): Promise<boolean> {
    return notImplemented("deleteAiAgent");
  }

  // ------------------------------------------------------------------
  // Saved query configs
  // ------------------------------------------------------------------

  listSavedQueries(): Promise<Row[]> {
    return notImplemented("listSavedQueries");
  }

  listSavedQueriesForExport(): Promise<Row[]> {
    return notImplemented("listSavedQueriesForExport");
  }

  upsertSavedQuery(): Promise<[Row, boolean]> {
    return notImplemented("upsertSavedQuery");
  }

  deleteSavedQuery(): Promise<boolean> {
    return notImplemented("deleteSavedQuery");
  }

  // ------------------------------------------------------------------
  // Embedding maintenance (rebuild support)
  // ------------------------------------------------------------------

  getEntityTypesWithProperties(): Promise<Row[]> {
    return notImplemented("getEntityTypesWithProperties");
  }

  setEntityEmbedding(): Promise<void> {
    return notImplemented("setEntityEmbedding");
  }

  listSavedQueryRefs(): Promise<Row[]> {
    return notImplemented("listSavedQueryRefs");
  }

  setSavedQueryEmbedding(): Promise<void> {
    return notImplemented("setSavedQueryEmbedding");
  }

  // ------------------------------------------------------------------
  // Vector-index DDL (M4.2)
  // ------------------------------------------------------------------

  createVectorIndex(): Promise<void> {
    return notImplemented("createVectorIndex");
  }

  dropVectorIndex(): Promise<void> {
    return notImplemented("dropVectorIndex");
  }

  rebuildVectorIndex(): Promise<void> {
    return notImplemented("rebuildVectorIndex");
  }

  createDocumentVectorIndex(): Promise<void> {
    return notImplemented("createDocumentVectorIndex");
  }

  dropDocumentVectorIndex(): Promise<void> {
    return notImplemented("dropDocumentVectorIndex");
  }

  ensureSavedQueryVectorIndex(): Promise<void> {
    return notImplemented("ensureSavedQueryVectorIndex");
  }

  ensureVectorIndexes(): Promise<void> {
    return notImplemented("ensureVectorIndexes");
  }
}
