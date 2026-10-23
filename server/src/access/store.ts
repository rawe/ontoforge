/**
 * The access store: local principals, their external identities, their
 * role assignments and the audit of every change to them. It is the port
 * of the access database — a database of its own, apart from the ontology
 * database, with its own connection and its own schema version — and is
 * opened only when authentication is on.
 *
 * Assignments name ontologies and lenses by their immutable ids; keys are
 * resolved on every request. Nothing here knows about tokens or sessions.
 */

export type PrincipalKind = "user" | "service";
export type PrincipalStatus = "active" | "disabled";

export const PLATFORM_ROLES = ["platform_admin", "ontology_creator"] as const;
export const LENS_ROLES = ["reader", "writer"] as const;
export type Role = (typeof PLATFORM_ROLES)[number] | "ontology_admin" | (typeof LENS_ROLES)[number];
export const ROLES: readonly Role[] = ["platform_admin", "ontology_creator", "ontology_admin", "reader", "writer"];

export interface Principal {
  id: string;
  kind: PrincipalKind;
  displayName: string;
  email: string | null;
  username: string | null;
  status: PrincipalStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface Identity {
  issuer: string;
  subject: string;
  principalId: string;
  createdAt: Date;
}

export interface Assignment {
  id: string;
  principalId: string;
  role: Role;
  /** Null for a platform role. */
  ontologyId: string | null;
  /** Set for reader and writer only. */
  lensId: string | null;
  createdAt: Date;
  createdBy: string | null;
}

/** Display claims, refreshed at every sign-in; never used to find a principal. */
export interface Profile {
  displayName: string;
  email: string | null;
  username: string | null;
}

export interface NewAssignment {
  principalId: string;
  role: Role;
  ontologyId: string | null;
  lensId: string | null;
}

export interface PrincipalPage {
  items: Principal[];
  total: number;
}

export interface AccessStore {
  /**
   * The principal of `(issuer, subject)`, created with its identity in one
   * transaction on the first sign-in — concurrent first sign-ins create one.
   * A new principal starts with no role, except that `bootstrapAdmin` makes
   * a newly created one Platform Administrator in the same transaction. An
   * existing principal gets its profile and last sign-in refreshed; its
   * status and roles are never touched.
   */
  signIn(issuer: string, subject: string, profile: Profile, bootstrapAdmin: boolean): Promise<Principal>;
  /** The principal an identity is bound to, unchanged. */
  principalOf(issuer: string, subject: string): Promise<Principal | null>;
  principal(id: string): Promise<Principal | null>;
  identities(principalId: string): Promise<Identity[]>;
  assignmentsOf(principalId: string): Promise<Assignment[]>;
  assignment(id: string): Promise<Assignment | null>;
  assignmentsInOntology(ontologyId: string): Promise<Assignment[]>;

  /** Case-insensitive search over display name, email and username. */
  listPrincipals(query: { search?: string; limit: number; offset: number }): Promise<PrincipalPage>;

  // --- Changes: each one transaction with its audit row ---------------------------------
  /** A service principal with its identity; ConflictError if the identity is bound. */
  admitService(issuer: string, subject: string, displayName: string, actorId: string): Promise<Principal>;
  /** Null when the principal does not exist. Refuses to disable the last active
   * Platform Administrator (ConflictError). */
  setStatus(id: string, status: PrincipalStatus, actorId: string): Promise<Principal | null>;
  /**
   * Idempotent. One lens role per principal and lens: Reader replaces Writer
   * and the other way round.
   */
  assign(assignment: NewAssignment, actorId: string): Promise<Assignment>;
  /** The removed assignment, or null. Refuses to remove the last active Platform
   * Administrator's role (ConflictError). */
  revoke(id: string, actorId: string): Promise<Assignment | null>;
  /** Removes every assignment of a deleted ontology (or one deleted lens). */
  forgetOntology(ontologyId: string): Promise<number>;
  forgetLens(lensId: string): Promise<number>;
  /** Removes assignments whose ontology or lens no longer exists. */
  sweep(existing: { ontologyIds: ReadonlySet<string>; lensIds: ReadonlySet<string> }): Promise<number>;

  close(): Promise<void>;
}
