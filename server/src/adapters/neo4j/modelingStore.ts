/**
 * Neo4j implementation of the modeling store (schema persistence).
 *
 * Implements the modeling side of the persistence port (see
 * `core/ports.ts`). Each method owns its session — opened through
 * `runSession`, so driver failures surface as `StoreError` (rule 4) — and
 * delegates to the query functions in `modelingQueries.ts`.
 */

import type { Driver } from "neo4j-driver";

import { reservedEntityTypeKeys, reservedRelationTypeKeys } from "./ddl.js";
import { runSession } from "./errors.js";
import * as queries from "./modelingQueries.js";
import type { OwnerLabel, ReservedTypeKeyInUse } from "./modelingQueries.js";

type Row = Record<string, unknown>;

export class Neo4jModelingStore {
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
    ownerLabel: OwnerLabel,
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
        ownerLabel,
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

  async listProperties(ownerId: string, ownerLabel: OwnerLabel): Promise<Row[]> {
    return runSession(this.driver, (session) =>
      queries.listProperties(session, ownerId, ownerLabel),
    );
  }

  async getProperty(
    ownerId: string,
    ownerLabel: OwnerLabel,
    propertyId: string,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getProperty(session, ownerId, ownerLabel, propertyId),
    );
  }

  async getPropertyByKey(
    ownerId: string,
    ownerLabel: OwnerLabel,
    key: string,
  ): Promise<Row | null> {
    return runSession(this.driver, (session) =>
      queries.getPropertyByKey(session, ownerId, ownerLabel, key),
    );
  }

  async updateProperty(
    ownerId: string,
    ownerLabel: OwnerLabel,
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
        ownerLabel,
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
    ownerLabel: OwnerLabel,
    propertyId: string,
  ): Promise<boolean> {
    return runSession(this.driver, (session) =>
      queries.deleteProperty(session, ownerId, ownerLabel, propertyId),
    );
  }

  // ------------------------------------------------------------------
  // Scope inclusions (cascade-protocol support; lens CRUD is session 03)
  // ------------------------------------------------------------------

  async removeAllIncludesForType(typeLabel: OwnerLabel, typeId: string): Promise<number> {
    return runSession(this.driver, (session) =>
      queries.removeAllIncludesForType(session, typeLabel, typeId),
    );
  }

  async findOntologiesIncludingType(
    typeLabel: OwnerLabel,
    typeId: string,
  ): Promise<string[]> {
    return runSession(this.driver, (session) =>
      queries.findOntologiesIncludingType(session, typeLabel, typeId),
    );
  }

  async findOntologiesWithExplicitProperty(
    typeLabel: OwnerLabel,
    typeId: string,
    propertyKey: string,
  ): Promise<string[]> {
    return runSession(this.driver, (session) =>
      queries.findOntologiesWithExplicitProperty(session, typeLabel, typeId, propertyKey),
    );
  }

  async addPropertyToIncludesLists(
    typeLabel: OwnerLabel,
    typeId: string,
    propertyKey: string,
  ): Promise<number> {
    return runSession(this.driver, (session) =>
      queries.addPropertyToIncludesLists(session, typeLabel, typeId, propertyKey),
    );
  }

  async removePropertyFromIncludesLists(
    typeLabel: OwnerLabel,
    typeId: string,
    propertyKey: string,
  ): Promise<number> {
    return runSession(this.driver, (session) =>
      queries.removePropertyFromIncludesLists(session, typeLabel, typeId, propertyKey),
    );
  }

  // ------------------------------------------------------------------
  // Full schema (get_schema now; validation and export later)
  // ------------------------------------------------------------------

  async getFullSchema(): Promise<Row> {
    return runSession(this.driver, (session) => queries.getFullSchema(session));
  }
}
