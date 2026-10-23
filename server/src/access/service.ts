/**
 * User management: the rules behind `/api/users` and an ontology's access
 * list (`router.ts`). Only with authentication on.
 *
 * Platform Administrators manage everything: accounts, their status,
 * every role. Ontology Administrators find users and grant or revoke
 * Reader and Writer on the lenses of the ontologies they administer; of a
 * user they see only the assignments within those ontologies. Every
 * change goes through the access store, which audits it.
 *
 * Assignments are stored by ontology and lens id; their keys are resolved
 * on every read, and an assignment whose ontology or lens no longer
 * exists is left out.
 */

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../core/exceptions.js";
import { getModelingStore, getOntologyRegistry } from "../core/ports.js";
import { isOntologyAdmin, isPlatformAdmin, knownOntology, lensNotFound, ontologyNotFound } from "./authorize.js";
import type { Caller } from "./caller.js";
import type { AccessStore, Assignment, Principal, PrincipalStatus, Role } from "./store.js";

export interface UserView {
  id: string;
  kind: Principal["kind"];
  displayName: string;
  email: string | null;
  username: string | null;
  status: PrincipalStatus;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AssignmentView {
  id: string;
  role: Role;
  ontologyKey: string | null;
  lensKey: string | null;
  ontologyId: string | null;
  lensId: string | null;
  createdAt: string;
}

export interface GrantInput {
  role: Role;
  ontologyKey?: string | undefined;
  lensKey?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function userView(principal: Principal): UserView {
  return {
    id: principal.id,
    kind: principal.kind,
    displayName: principal.displayName,
    email: principal.email,
    username: principal.username,
    status: principal.status,
    createdAt: principal.createdAt.toISOString(),
    lastLoginAt: principal.lastLoginAt?.toISOString() ?? null,
  };
}

/** The assignments with their keys; those whose ontology or lens is gone are left out. */
export async function assignmentViews(assignments: Assignment[]): Promise<AssignmentView[]> {
  if (assignments.length === 0) return [];
  const ontologyKeys = new Map(
    (await getOntologyRegistry().listOntologies()).map((row) => [row.ontologyId as string, row.key as string]),
  );
  const lensKeys = new Map<string, string>();
  const withLenses = new Set(assignments.filter((a) => a.lensId !== null).map((a) => a.ontologyId!));
  for (const ontologyId of withLenses) {
    const ontologyKey = ontologyKeys.get(ontologyId);
    if (ontologyKey === undefined) continue;
    try {
      for (const lens of await (await getModelingStore(ontologyKey)).listLenses()) {
        lensKeys.set(lens.lensId as string, lens.key as string);
      }
    } catch (error) {
      // Deleted since the registry was read.
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return assignments.flatMap((a) => {
    const ontologyKey = a.ontologyId === null ? null : ontologyKeys.get(a.ontologyId);
    const lensKey = a.lensId === null ? null : lensKeys.get(a.lensId);
    if (ontologyKey === undefined || lensKey === undefined) return [];
    return [
      {
        id: a.id,
        role: a.role,
        ontologyKey,
        lensKey,
        ontologyId: a.ontologyId,
        lensId: a.lensId,
        createdAt: a.createdAt.toISOString(),
      },
    ];
  });
}

function requirePlatformAdmin(caller: Caller): void {
  if (!isPlatformAdmin(caller)) throw new ForbiddenError("This needs the Platform Administrator role");
}

/** Whether the caller may see an assignment: within an ontology it administers. */
function sees(caller: Caller, assignment: Assignment): boolean {
  if (isPlatformAdmin(caller)) return true;
  return assignment.ontologyId !== null && isOntologyAdmin(caller, assignment.ontologyId);
}

/** Whether the caller may grant or revoke an assignment it sees. */
function manages(caller: Caller, assignment: Pick<Assignment, "role" | "ontologyId">): boolean {
  if (isPlatformAdmin(caller)) return true;
  return (
    (assignment.role === "reader" || assignment.role === "writer") &&
    assignment.ontologyId !== null &&
    isOntologyAdmin(caller, assignment.ontologyId)
  );
}

async function principalOf(store: AccessStore, userId: string): Promise<Principal> {
  const principal = UUID.test(userId) ? await store.principal(userId) : null;
  if (principal === null) throw new NotFoundError(`User '${userId}' not found`);
  return principal;
}

export async function listUsers(
  store: AccessStore,
  query: { search?: string | undefined; limit: number; offset: number },
): Promise<{ items: UserView[]; total: number }> {
  const page = await store.listPrincipals(query);
  return { items: page.items.map(userView), total: page.total };
}

export async function getUser(
  store: AccessStore,
  caller: Caller,
  userId: string,
): Promise<UserView & { assignments: AssignmentView[] }> {
  const principal = await principalOf(store, userId);
  const assignments = (await store.assignmentsOf(principal.id)).filter((a) => sees(caller, a));
  return { ...userView(principal), assignments: await assignmentViews(assignments) };
}

export async function setUserStatus(
  store: AccessStore,
  caller: Caller,
  userId: string,
  status: PrincipalStatus,
): Promise<UserView> {
  requirePlatformAdmin(caller);
  if (status === "disabled" && userId === caller.principal.id) {
    throw new ConflictError("You cannot disable your own account");
  }
  await principalOf(store, userId);
  const updated = await store.setStatus(userId, status, caller.principal.id);
  if (updated === null) throw new NotFoundError(`User '${userId}' not found`);
  return userView(updated);
}

/** Admits a service principal of the configured issuer: before its first
 * call, or after it, while that call's role-less user holds no role. */
export async function admitService(
  store: AccessStore,
  caller: Caller,
  issuer: string,
  body: { displayName: string; subject: string },
): Promise<UserView> {
  requirePlatformAdmin(caller);
  return userView(await store.admitService(issuer, body.subject, body.displayName, caller.principal.id));
}

/** The ontology of `key` for granting: any existing one for a Platform
 * Administrator, else one the caller may know about. */
async function grantOntology(caller: Caller, key: string): Promise<{ ontologyId: string; key: string }> {
  if (!isPlatformAdmin(caller)) return knownOntology(caller, key);
  const row = await getOntologyRegistry().getOntology(key);
  if (row === null) throw ontologyNotFound(key);
  return { ontologyId: row.ontologyId as string, key };
}

/** Grants a role; idempotent. Reader and Writer on one lens replace each other. */
export async function grant(
  store: AccessStore,
  caller: Caller,
  userId: string,
  body: GrantInput,
): Promise<AssignmentView> {
  const { role, ontologyKey, lensKey } = body;
  let ontologyId: string | null = null;
  let lensId: string | null = null;
  if (role === "platform_admin" || role === "ontology_creator") {
    if (ontologyKey !== undefined || lensKey !== undefined) {
      throw new ValidationError(`Role '${role}' is a platform role: it takes no ontologyKey or lensKey`);
    }
    requirePlatformAdmin(caller);
  } else if (role === "ontology_admin") {
    if (ontologyKey === undefined || lensKey !== undefined) {
      throw new ValidationError("Role 'ontology_admin' takes an ontologyKey and no lensKey");
    }
    requirePlatformAdmin(caller);
    ontologyId = (await grantOntology(caller, ontologyKey)).ontologyId;
  } else {
    if (ontologyKey === undefined || lensKey === undefined) {
      throw new ValidationError(`Role '${role}' takes an ontologyKey and a lensKey`);
    }
    ontologyId = (await grantOntology(caller, ontologyKey)).ontologyId;
    if (!manages(caller, { role, ontologyId })) {
      throw new ForbiddenError(`Granting lens roles needs the Ontology Administrator role on ontology '${ontologyKey}'`);
    }
    const lens = await (await getModelingStore(ontologyKey)).getLensByKey(lensKey);
    if (lens === null) throw lensNotFound(lensKey);
    lensId = lens.lensId as string;
  }
  const principal = await principalOf(store, userId);
  const assignment = await store.assign({ principalId: principal.id, role, ontologyId, lensId }, caller.principal.id);
  return {
    id: assignment.id,
    role: assignment.role,
    ontologyKey: ontologyKey ?? null,
    lensKey: lensKey ?? null,
    ontologyId: assignment.ontologyId,
    lensId: assignment.lensId,
    createdAt: assignment.createdAt.toISOString(),
  };
}

/** Revokes one of a user's assignments, within the scope that may grant it. */
export async function revoke(store: AccessStore, caller: Caller, userId: string, assignmentId: string): Promise<void> {
  const assignment = UUID.test(assignmentId) ? await store.assignment(assignmentId) : null;
  if (assignment === null || assignment.principalId !== userId || !sees(caller, assignment)) {
    throw new NotFoundError(`Assignment '${assignmentId}' not found`);
  }
  if (!manages(caller, assignment)) {
    throw new ForbiddenError(`Revoking role '${assignment.role}' needs the Platform Administrator role`);
  }
  if ((await store.revoke(assignmentId, caller.principal.id)) === null) {
    throw new NotFoundError(`Assignment '${assignmentId}' not found`);
  }
}

/** Every assignment within one ontology, with its holder: its administrators and Platform Administrators. */
export async function ontologyAccess(
  store: AccessStore,
  caller: Caller,
  ontologyKey: string,
): Promise<{ assignments: (AssignmentView & { user: UserView })[] }> {
  const ontology = await grantOntology(caller, ontologyKey);
  if (!isPlatformAdmin(caller) && !isOntologyAdmin(caller, ontology.ontologyId)) {
    throw new ForbiddenError(`This needs the Ontology Administrator role on ontology '${ontologyKey}'`);
  }
  const assignments = await store.assignmentsInOntology(ontology.ontologyId);
  const users = new Map<string, UserView>();
  for (const principalId of new Set(assignments.map((a) => a.principalId))) {
    const principal = await store.principal(principalId);
    if (principal !== null) users.set(principalId, userView(principal));
  }
  const holders = new Map(assignments.map((a) => [a.id, a.principalId]));
  return {
    assignments: (await assignmentViews(assignments)).flatMap((view) => {
      const user = users.get(holders.get(view.id)!);
      return user === undefined ? [] : [{ ...view, user }];
    }),
  };
}
