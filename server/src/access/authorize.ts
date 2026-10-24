/**
 * The one authorization service: judges a route's need (`routes.ts`) for
 * the request's access (`caller.ts`), and tells handlers what a caller may
 * see. Every entrance — REST, the MCP mounts, the chat's nested tool calls
 * — goes through it.
 *
 * Fixed roles, nothing inherited between them:
 * - Platform Administrator manages users and assignments; it sees every
 *   ontology's and lens's metadata, to assign roles, and nothing more:
 *   no design, no data.
 * - Ontology Administrator: all modeling of its ontology, ruleset
 *   maintenance, rename and delete — no runtime data without a lens role.
 * - Reader reads through its lens; Writer does everything a lens allows.
 *
 * An ontology or lens the caller holds no role in answers not found, as
 * an unknown key does, so keys do not leak; a known one the caller lacks
 * the role for answers forbidden.
 */

import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../core/exceptions.js";
import { getModelingStore, getOntologyRegistry, type WriteAccess } from "../core/ports.js";
import type { Operation } from "../runtime/writeAccess.js";
import type { Access, Caller, Need } from "./caller.js";
import type { Assignment } from "./store.js";

/** An ontology the caller may know about. */
interface KnownOntology {
  ontologyId: string;
  key: string;
}

const PLATFORM_ROLE_NAMES = {
  platform_admin: "Platform Administrator",
  ontology_creator: "Ontology Creator",
} as const;

export function isPlatformAdmin(caller: Caller): boolean {
  return caller.assignments.some((a) => a.role === "platform_admin");
}

export function isOntologyAdmin(caller: Caller, ontologyId: string): boolean {
  return caller.assignments.some((a) => a.role === "ontology_admin" && a.ontologyId === ontologyId);
}

/** The caller's Reader or Writer assignment on one lens, if any. */
export function lensRole(caller: Caller, lensId: string): Assignment | undefined {
  return caller.assignments.find((a) => (a.role === "reader" || a.role === "writer") && a.lensId === lensId);
}

/** Whether a lens role allows an operation: Reader reads, Writer does everything. */
function roleAllows(role: Assignment, operation: Operation): boolean {
  return role.role === "writer" || operation === "read";
}

export function ontologyNotFound(key: string): NotFoundError {
  return new NotFoundError(`Ontology '${key}' not found`);
}

export function lensNotFound(key: string): NotFoundError {
  return new NotFoundError(`Lens '${key}' not found`);
}

/**
 * The caller's Reader and Writer roles in one ontology whose lens still
 * exists: a role a deleted lens left behind counts for nothing.
 */
async function liveLensRoles(caller: Caller, ontology: KnownOntology): Promise<Assignment[]> {
  const roles = caller.assignments.filter((a) => a.lensId !== null && a.ontologyId === ontology.ontologyId);
  if (roles.length === 0) return [];
  let lenses;
  try {
    lenses = await (await getModelingStore(ontology.key)).listLenses();
  } catch (error) {
    // Deleted since the registry was read.
    if (error instanceof NotFoundError) return [];
    throw error;
  }
  const live = new Set(lenses.map((lens) => lens.lensId as string));
  return roles.filter((a) => live.has(a.lensId!));
}

/**
 * The ontology of `key` if it exists and the caller administers it, holds
 * a role on one of its lenses or is Platform Administrator; otherwise not
 * found, alike.
 */
export async function knownOntology(caller: Caller, key: string): Promise<KnownOntology> {
  const row = await getOntologyRegistry().getOntology(key);
  if (row === null) throw ontologyNotFound(key);
  const ontology = { ontologyId: row.ontologyId as string, key };
  if (isPlatformAdmin(caller) || isOntologyAdmin(caller, ontology.ontologyId)) return ontology;
  if ((await liveLensRoles(caller, ontology)).length === 0) throw ontologyNotFound(key);
  return ontology;
}

/** The id of the lens `lensKey` of an ontology, or null. */
async function lensIdOf(ontologyKey: string, lensKey: string): Promise<string | null> {
  const row = await (await getModelingStore(ontologyKey)).getLensByKey(lensKey);
  return row === null ? null : (row.lensId as string);
}

async function lensExists(ontologyKey: string, lensId: string): Promise<boolean> {
  return (await (await getModelingStore(ontologyKey)).getLens(lensId)) !== null;
}

/**
 * Judge `need` for `access`; `params` are the route's path parameters.
 * Returns when allowed; throws UnauthenticatedError, ForbiddenError or
 * NotFoundError otherwise. Trusted access (authentication off) passes.
 */
export async function authorize(access: Access, need: Need, params: Record<string, string>): Promise<void> {
  if (access.kind === "trusted" || need.kind === "public") return;
  if (access.kind === "anonymous") throw new UnauthenticatedError();
  const { caller } = access;

  switch (need.kind) {
    case "signed-in":
      return;
    case "platform":
      if (!caller.assignments.some((a) => a.role === need.role)) {
        throw new ForbiddenError(`This needs the ${PLATFORM_ROLE_NAMES[need.role]} role`);
      }
      return;
    case "user-admin":
      if (!isPlatformAdmin(caller) && !caller.assignments.some((a) => a.role === "ontology_admin")) {
        throw new ForbiddenError("Managing users needs the Platform Administrator or an Ontology Administrator role");
      }
      return;
  }

  const ontology = await knownOntology(caller, params.ontologyKey ?? "");
  switch (need.kind) {
    case "ontology-member":
      return;
    case "ontology-admin":
      if (!isOntologyAdmin(caller, ontology.ontologyId)) {
        throw new ForbiddenError(`This needs the Ontology Administrator role on ontology '${ontology.key}'`);
      }
      return;
    case "lens":
      return authorizeLens(caller, ontology, need.operation, need.orAdmin === true, params);
  }
}

async function authorizeLens(
  caller: Caller,
  ontology: KnownOntology,
  operation: Operation,
  orAdmin: boolean,
  params: Record<string, string>,
): Promise<void> {
  const admin = isOntologyAdmin(caller, ontology.ontologyId);
  if (orAdmin && admin) return;

  // A lensless lens need (the ruleset reads): a role on any lens of the ontology.
  if (params.lensKey === undefined && params.lensId === undefined) {
    if ((await liveLensRoles(caller, ontology)).some((role) => roleAllows(role, operation))) return;
    throw new ForbiddenError(`This needs a role on a lens of ontology '${ontology.key}'`);
  }

  const label = params.lensKey ?? params.lensId!;
  const lensId = params.lensId ?? (await lensIdOf(ontology.key, params.lensKey!));
  if (lensId === null) throw lensNotFound(label);
  const role = lensRole(caller, lensId);
  if (role !== undefined) {
    if (roleAllows(role, operation)) return;
    throw new ForbiddenError(`Reader on lens '${label}' cannot write`);
  }
  // Administrators know every lens of the ontology; anyone else learns nothing.
  if (admin || isPlatformAdmin(caller)) {
    if (params.lensId !== undefined && !(await lensExists(ontology.key, lensId))) throw lensNotFound(label);
    throw new ForbiddenError(`This needs a Reader or Writer role on lens '${label}'`);
  }
  throw lensNotFound(label);
}

/**
 * The write access a caller's role gives on one lens: Writer `full`,
 * Reader (or no role) `none`; trusted access `full`. On a ruleset mount
 * the lower of this and the ruleset's level applies.
 */
export async function lensLevel(access: Access, ontologyKey: string, lensKey: string): Promise<WriteAccess> {
  if (access.kind === "trusted") return "full";
  if (access.kind === "anonymous") return "none";
  const lensId = await lensIdOf(ontologyKey, lensKey);
  const role = lensId === null ? undefined : lensRole(access.caller, lensId);
  return role?.role === "writer" ? "full" : "none";
}

/** Which of `ontologies` a caller sees listed: every one for trusted access
 * and Platform Administrators, else those `knownOntology` lets it know. */
export async function visibleOntologies<T extends KnownOntology>(access: Access, ontologies: T[]): Promise<T[]> {
  if (access.kind === "trusted") return ontologies;
  if (access.kind === "anonymous") return [];
  const { caller } = access;
  if (isPlatformAdmin(caller)) return ontologies;
  const visible: T[] = [];
  for (const ontology of ontologies) {
    if (isOntologyAdmin(caller, ontology.ontologyId) || (await liveLensRoles(caller, ontology)).length > 0) {
      visible.push(ontology);
    }
  }
  return visible;
}

/** Which lenses of an ontology a caller sees listed: every one for trusted
 * access and administrators, else those it holds a lens role on. */
export function lensFilter(access: Access, ontologyId: string): (lensId: string) => boolean {
  if (access.kind === "trusted") return () => true;
  if (access.kind === "anonymous") return () => false;
  const { caller } = access;
  if (isPlatformAdmin(caller) || isOntologyAdmin(caller, ontologyId)) return () => true;
  const held = new Set(caller.assignments.filter((a) => a.lensId !== null).map((a) => a.lensId));
  return (lensId) => held.has(lensId);
}

/** The principal that owns what a request creates (assistant threads); null when trusted. */
export function ownerOf(access: Access): string | null {
  return access.kind === "caller" ? access.caller.principal.id : null;
}
