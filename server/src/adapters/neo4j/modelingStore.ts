/**
 * Neo4j implementation of the modeling store (schema persistence).
 *
 * Implements the modeling side of the persistence port (see
 * `core/ports.ts`). Each method owns its session — opened through
 * `runSession`, so driver failures surface as `StoreError` (rule 4) — and
 * delegates to the query functions in `modelingQueries.ts`.
 */

import type { Driver } from "neo4j-driver";

import type { ModelingStore, ReservedTypeKeyInUse, Row } from "../../core/ports.js";
import type { TypeKind } from "../../core/schemas.js";
import * as ddl from "./ddl.js";
import { reservedEntityTypeKeys, reservedRelationTypeKeys } from "./ddl.js";
import { runSession } from "./errors.js";
import * as queries from "./modelingQueries.js";

export class Neo4jModelingStore implements ModelingStore {
  constructor(private readonly driver: Driver) {}

  // ------------------------------------------------------------------
  // Reserved keys
  // ------------------------------------------------------------------

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
      queries.findReservedTypeKeysInUse(
        session,
        [...reservedEntityTypeKeys()].sort(),
        [...reservedRelationTypeKeys()].sort(),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Lenses
  // ------------------------------------------------------------------

  async createLens(
    lensId: string,
    key: string,
    name: string,
    description: string | null,
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createLens(session, lensId, key, name, description),
    );
  }

  async listLenses(): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.listLenses(session));
  }

  async getLens(lensId: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getLens(session, lensId));
  }

  async getLensByName(name: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getLensByName(session, name));
  }

  async getLensByKey(key: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getLensByKey(session, key));
  }

  async updateLens(
    lensId: string,
    name: string | null,
    description: string | null,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateLens(session, lensId, name, description),
    );
  }

  async deleteLens(lensId: string): Promise<boolean> {
    return runSession(this.driver, (session) => queries.deleteLens(session, lensId));
  }

  // ------------------------------------------------------------------
  // Entity types
  // ------------------------------------------------------------------

  async createEntityType(
    entityTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createEntityType(session, entityTypeId, key, displayName, description),
    );
  }

  async listEntityTypes(): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.listEntityTypes(session));
  }

  async getEntityType(entityTypeId: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getEntityType(session, entityTypeId));
  }

  async getEntityTypeByKey(key: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getEntityTypeByKey(session, key));
  }

  async updateEntityType(
    entityTypeId: string,
    displayName: string | null,
    description: string | null,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateEntityType(session, entityTypeId, displayName, description),
    );
  }

  async deleteEntityType(entityTypeId: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteEntityType(session, entityTypeId),
    );
  }

  async isEntityTypeReferenced(entityTypeId: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.isEntityTypeReferenced(session, entityTypeId),
    );
  }

  // ------------------------------------------------------------------
  // Relation types
  // ------------------------------------------------------------------

  async createRelationType(
    relationTypeId: string,
    key: string,
    displayName: string,
    description: string | null,
    sourceEntityTypeKey: string,
    targetEntityTypeKey: string,
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createRelationType(
        session,
        relationTypeId,
        key,
        displayName,
        description,
        sourceEntityTypeKey,
        targetEntityTypeKey,
      ),
    );
  }

  async listRelationTypes(): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.listRelationTypes(session));
  }

  async getRelationType(relationTypeId: string): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getRelationType(session, relationTypeId),
    );
  }

  async getRelationTypeByKey(key: string): Promise<Row | null> {
    return runSession(this.driver, (session) => queries.getRelationTypeByKey(session, key));
  }

  async updateRelationType(
    relationTypeId: string,
    displayName: string | null,
    description: string | null,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateRelationType(session, relationTypeId, displayName, description),
    );
  }

  async deleteRelationType(relationTypeId: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteRelationType(session, relationTypeId),
    );
  }

  // ------------------------------------------------------------------
  // Property definitions
  // ------------------------------------------------------------------

  async createProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
    key: string,
    displayName: string,
    description: string | null,
    dataType: string,
    required: boolean,
    defaultValue: string | null,
  ): Promise<Row> {
    return runSession(this.driver, (session) =>
      queries.createProperty(
        session,
        ownerId,
        typeKind,
        propertyId,
        key,
        displayName,
        description,
        dataType,
        required,
        defaultValue,
      ),
    );
  }

  async listProperties(ownerId: string, typeKind: TypeKind): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.listProperties(session, ownerId, typeKind),
    );
  }

  async getProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getProperty(session, ownerId, typeKind, propertyId),
    );
  }

  async getPropertyByKey(
    ownerId: string,
    typeKind: TypeKind,
    key: string,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getPropertyByKey(session, ownerId, typeKind, key),
    );
  }

  async updateProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
    displayName: string | null,
    description: string | null,
    required: boolean | null,
    defaultValue: string | null,
    clearDefault: boolean,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateProperty(
        session,
        ownerId,
        typeKind,
        propertyId,
        displayName,
        description,
        required,
        defaultValue,
        clearDefault,
      ),
    );
  }

  async deleteProperty(
    ownerId: string,
    typeKind: TypeKind,
    propertyId: string,
  ): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteProperty(session, ownerId, typeKind, propertyId),
    );
  }

  // ------------------------------------------------------------------
  // Scope inclusions (lifecycle)
  // ------------------------------------------------------------------

  async addIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeKey: string,
    properties: string[] | null,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.addIncludesType(session, lensId, typeKind, typeKey, properties),
    );
  }

  async listIncludesTypes(lensId: string, typeKind: TypeKind): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.listIncludesTypes(session, lensId, typeKind),
    );
  }

  async updateIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeId: string,
    properties: string[] | null,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.updateIncludesType(session, lensId, typeKind, typeId, properties),
    );
  }

  async removeIncludesType(
    lensId: string,
    typeKind: TypeKind,
    typeId: string,
  ): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.removeIncludesType(session, lensId, typeKind, typeId),
    );
  }

  // ------------------------------------------------------------------
  // Scope inclusions (cascade-protocol support)
  // ------------------------------------------------------------------

  async removeAllIncludesForType(typeKind: TypeKind, typeId: string): Promise<number> {
    return runSession(this.driver, (session) =>
      queries.removeAllIncludesForType(session, typeKind, typeId),
    );
  }

  async findLensesIncludingType(
    typeKind: TypeKind,
    typeId: string,
  ): Promise<string[]> {
    return runSession(this.driver, (session) =>
      queries.findLensesIncludingType(session, typeKind, typeId),
    );
  }

  async findLensesWithExplicitProperty(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<string[]> {
    return runSession(this.driver, (session) =>
      queries.findLensesWithExplicitProperty(session, typeKind, typeId, propertyKey),
    );
  }

  async addPropertyToIncludesLists(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<number> {
    return runSession(this.driver, (session) =>
      queries.addPropertyToIncludesLists(session, typeKind, typeId, propertyKey),
    );
  }

  async removePropertyFromIncludesLists(
    typeKind: TypeKind,
    typeId: string,
    propertyKey: string,
  ): Promise<number> {
    return runSession(this.driver, (session) =>
      queries.removePropertyFromIncludesLists(session, typeKind, typeId, propertyKey),
    );
  }

  // ------------------------------------------------------------------
  // Document-property cleanup
  // ------------------------------------------------------------------

  /** Delete every chunk of one (entity type, document property) pair.
   * Invoked when the property, or its owning type, is removed. */
  async deleteChunksForTypeProperty(entityTypeKey: string, propertyKey: string): Promise<void> {
    return runSession(this.driver, (session) =>
      queries.deleteChunksForTypeProperty(session, entityTypeKey, propertyKey),
    );
  }

  // ------------------------------------------------------------------
  // Full schema (get_schema now; validation and export later)
  // ------------------------------------------------------------------

  async getFullSchema(): Promise<Row> {
    return runSession(this.driver, (session) => queries.getFullSchema(session));
  }

  // ------------------------------------------------------------------
  // AI agent configs
  // ------------------------------------------------------------------

  async listAiAgents(lensId: string): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.listAiAgents(session, lensId));
  }

  async upsertAiAgent(
    lensId: string,
    agentConfigId: string,
    key: string,
    name: string,
    description: string | null,
    systemPrompt: string | null,
    tools: string[] | null,
  ): Promise<[Row, boolean]> {
    return runSession(this.driver, (session) =>
      queries.upsertAiAgent(
        session,
        lensId,
        agentConfigId,
        key,
        name,
        description,
        systemPrompt,
        tools,
      ),
    );
  }

  async listAiAgentsForExport(lensId: string): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.listAiAgentsForExport(session, lensId),
    );
  }

  async deleteAiAgent(lensId: string, agentKey: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteAiAgent(session, lensId, agentKey),
    );
  }

  // ------------------------------------------------------------------
  // Saved query configs
  // ------------------------------------------------------------------

  async listSavedQueries(lensId: string): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.listSavedQueries(session, lensId));
  }

  async listSavedQueriesForExport(lensId: string): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.listSavedQueriesForExport(session, lensId),
    );
  }

  async upsertSavedQuery(
    lensId: string,
    savedQueryId: string,
    key: string,
    name: string,
    description: string,
    stepsJson: string,
    parametersJson: string,
    lensKey: string | null = null,
    embedding: number[] | null = null,
  ): Promise<[Row, boolean]> {
    return runSession(this.driver, (session) =>
      queries.upsertSavedQuery(
        session,
        lensId,
        savedQueryId,
        key,
        name,
        description,
        stepsJson,
        parametersJson,
        lensKey,
        embedding,
      ),
    );
  }

  async deleteSavedQuery(lensId: string, queryKey: string): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteSavedQuery(session, lensId, queryKey),
    );
  }

  // ------------------------------------------------------------------
  // Embedding maintenance (rebuild support)
  // ------------------------------------------------------------------

  async getEntityTypesWithProperties(): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.getEntityTypesWithProperties(session));
  }

  async setEntityEmbedding(entityId: string, embedding: number[]): Promise<void> {
    return runSession(this.driver, (session) =>
      queries.setEntityEmbedding(session, entityId, embedding),
    );
  }

  async listSavedQueryRefs(): Promise<Row[]> {
    return runSession(this.driver, (session) => queries.listSavedQueryRefs(session));
  }

  async setSavedQueryEmbedding(savedQueryId: string, embedding: number[]): Promise<void> {
    return runSession(this.driver, (session) =>
      queries.setSavedQueryEmbedding(session, savedQueryId, embedding),
    );
  }

  // ------------------------------------------------------------------
  // Vector-index DDL
  // ------------------------------------------------------------------

  async createVectorIndex(
    entityTypeKey: string,
    dimensions: number,
    filterProperties: string[] | null = null,
  ): Promise<void> {
    await ddl.createVectorIndex(this.driver, entityTypeKey, dimensions, filterProperties);
  }

  async dropVectorIndex(entityTypeKey: string): Promise<void> {
    await ddl.dropVectorIndex(this.driver, entityTypeKey);
  }

  async rebuildVectorIndex(entityTypeKey: string, dimensions: number): Promise<void> {
    await ddl.rebuildVectorIndex(this.driver, entityTypeKey, dimensions);
  }

  async createDocumentVectorIndex(
    entityTypeKey: string,
    propertyKey: string,
    dimensions: number,
  ): Promise<void> {
    await ddl.createDocumentVectorIndex(this.driver, entityTypeKey, propertyKey, dimensions);
  }

  async dropDocumentVectorIndex(entityTypeKey: string, propertyKey: string): Promise<void> {
    await ddl.dropDocumentVectorIndex(this.driver, entityTypeKey, propertyKey);
  }

  async ensureSavedQueryVectorIndex(dimensions: number): Promise<void> {
    await ddl.ensureSavedQueryVectorIndex(this.driver, dimensions);
  }

  async ensureVectorIndexes(dimensions: number, recreateOnMismatch = false): Promise<void> {
    await ddl.ensureVectorIndexes(this.driver, dimensions, recreateOnMismatch);
  }
}
