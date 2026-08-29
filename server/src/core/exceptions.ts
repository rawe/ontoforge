/**
 * Exception taxonomy. The interface layer maps each class to its HTTP
 * status and envelope code (see `app.ts`).
 */

import { randomBytes } from "node:crypto";

/** Base class for all OntoForge domain errors. */
export class OntoForgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A requested resource does not exist. -> 404 RESOURCE_NOT_FOUND */
export class NotFoundError extends OntoForgeError {}

/** An operation conflicts with existing state. -> 409 RESOURCE_CONFLICT */
export class ConflictError extends OntoForgeError {}

/** Request or business-logic validation failed. -> 422 VALIDATION_ERROR */
export class ValidationError extends OntoForgeError {
  details: Record<string, unknown> | null;

  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.details = details;
  }
}

/** A schema change would break scoped lenses and cascade was not
 * requested. -> 409 CASCADE_REQUIRED */
export class CascadeRequiredError extends OntoForgeError {
  affectedLenses: string[];

  constructor(message: string, affectedLenses: string[]) {
    super(message);
    this.affectedLenses = affectedLenses;
  }
}

/**
 * The persistence adapter failed in a way no domain exception describes.
 * -> 500 STORAGE_ERROR
 *
 * Deliberately carries no storage detail: the originating failure is set as
 * `cause` and logged by the adapter against `errorId`, which is the only
 * thing the client receives that ties its response to that log entry.
 * Nothing vendor-specific reaches the caller.
 */
export class StoreError extends OntoForgeError {
  errorId: string;

  constructor(message = "A storage operation failed", errorId?: string) {
    super(message);
    this.errorId = errorId ?? randomBytes(4).toString("hex");
  }
}
