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

/** A requested resource does not exist. -> 404 RESOURCE_NOT_FOUND;
 * `details.code` may narrow it. */
export class NotFoundError extends OntoForgeError {
  details: Record<string, unknown> | null;

  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.details = details;
  }
}

/** An operation conflicts with existing state. -> 409 RESOURCE_CONFLICT;
 * `details.code` may narrow it. */
export class ConflictError extends OntoForgeError {
  details: Record<string, unknown> | null;

  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.details = details;
  }
}

/** Another entity of the type has the identity a write would give an
 * entity. -> 409 RESOURCE_CONFLICT, `details.code` `IDENTITY_TAKEN` with
 * the identity and the type's identity properties; it never names the
 * other entity. The adapter raises it without the properties (it knows
 * only the constraint); the service fills them in (`withIdentityProperties`). */
export class IdentityTakenError extends ConflictError {
  readonly entityTypeKey: string;
  readonly identity: string;

  constructor(entityTypeKey: string, identity: string, properties: string[] | null = null) {
    super(`Identity '${identity}' is already taken in entity type '${entityTypeKey}'`, {
      code: "IDENTITY_TAKEN",
      identity,
      properties,
    });
    this.entityTypeKey = entityTypeKey;
    this.identity = identity;
  }

  /** The same refusal, naming the type's identity properties. */
  withIdentityProperties(properties: string[]): IdentityTakenError {
    return new IdentityTakenError(this.entityTypeKey, this.identity, properties);
  }
}

/** A relation of a one-per-pair relation type already links the pair a
 * write would link. -> 409 RESOURCE_CONFLICT, `details.code`
 * `PAIR_TAKEN` with the relation type; it never names the other relation. */
export class PairTakenError extends ConflictError {
  constructor(relationTypeKey: string) {
    super(`Relation type '${relationTypeKey}' is one per pair: this source and target are already linked by it`, {
      code: "PAIR_TAKEN",
      relationTypeKey,
    });
  }
}

/** The ontology's design changed between the design a write checked
 * against and its commit; nothing was written. The write retries against
 * the new design and answers this only when it keeps changing. -> 409
 * RESOURCE_CONFLICT */
export class DesignChangedError extends ConflictError {
  constructor() {
    super("The ontology's design changed while this write ran; try again");
  }
}

/** A design change expected another design revision than the one in
 * force (`DesignChangeOptions.expected`); nothing was written. -> 409
 * RESOURCE_CONFLICT, `details.code` `DESIGN_CHANGED` with the `current`
 * revision. */
export class StaleDesignError extends ConflictError {
  constructor(current: { ontologyId: string; revision: number }) {
    super("The ontology's design changed since it was checked; check again against the current design", {
      code: "DESIGN_CHANGED",
      current,
    });
  }
}

/** No valid credential for a protected operation. -> 401 UNAUTHENTICATED;
 * `invalidToken` when a bearer token was sent and rejected. */
export class UnauthenticatedError extends OntoForgeError {
  invalidToken: boolean;

  constructor(message = "Sign in or send a valid bearer token", invalidToken = false) {
    super(message);
    this.invalidToken = invalidToken;
  }
}

/** An authenticated caller lacks the role an operation needs. -> 403 FORBIDDEN */
export class ForbiddenError extends OntoForgeError {
  constructor(message: string) {
    super(message);
  }
}

/** The identity provider cannot be reached, so no credential can be
 * checked; nothing is admitted. -> 503 PROVIDER_UNAVAILABLE */
export class ProviderUnavailableError extends OntoForgeError {
  constructor(message = "The identity provider cannot be reached; try again later") {
    super(message);
  }
}

/** Request or business-logic validation failed. -> 422 VALIDATION_ERROR */
export class ValidationError extends OntoForgeError {
  details: Record<string, unknown> | null;

  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.details = details;
  }
}

/** A schema change would break scoped lenses or custom search indices
 * and cascade was not requested. -> 409 CASCADE_REQUIRED. Both lists hold
 * sorted keys; either may be empty. */
export class CascadeRequiredError extends OntoForgeError {
  affectedLenses: string[];
  affectedIndices: string[];

  constructor(message: string, affectedLenses: string[], affectedIndices: string[] = []) {
    super(message);
    this.affectedLenses = affectedLenses;
    this.affectedIndices = affectedIndices;
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

/** Why a language-model call gave no usable answer, as far as the provider
 * tells; `failed` when it does not. */
export type ModelFailure =
  | "context_full"
  | "rate_limited"
  | "unavailable"
  | "misconfigured"
  | "answer_cut_off"
  | "failed";

const MODEL_FAILURES: Record<ModelFailure, { code: string | null; message: string }> = {
  context_full: {
    code: "CONTEXT_FULL",
    message: "This conversation is too long for the language model; start a new conversation.",
  },
  rate_limited: {
    code: "RATE_LIMITED",
    message: "The language model is busy; try again in a moment.",
  },
  unavailable: {
    code: "UNAVAILABLE",
    message: "The language model cannot be reached; try again later.",
  },
  misconfigured: {
    code: "MISCONFIGURED",
    message: "The language model refused the server's credentials or model name; an administrator has to fix the configuration.",
  },
  answer_cut_off: {
    code: "ANSWER_CUT_OFF",
    message: "The language model's answer was cut off at its output limit; ask for less at once.",
  },
  failed: { code: null, message: "The language model failed; no automatic retry." },
};

/**
 * A language-model call gave no usable answer. -> 502 MODEL_ERROR,
 * `details.code` naming the reason when the provider told it.
 *
 * Carries nothing of the provider's own answer: the originating failure is
 * set as `cause` and logged where the call was made.
 */
export class ModelError extends OntoForgeError {
  readonly reason: ModelFailure;
  readonly details: Record<string, unknown> | null;

  constructor(reason: ModelFailure, cause?: unknown) {
    super(MODEL_FAILURES[reason].message);
    this.reason = reason;
    const { code } = MODEL_FAILURES[reason];
    this.details = code === null ? null : { code };
    if (cause !== undefined) this.cause = cause;
  }
}
