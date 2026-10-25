import type { AccessAssignment, Assignment, AuthMe, Role } from '@/api/types'

/**
 * What the signed-in user may do, read from its assignments (`GET /api/auth/me`).
 * Roles do not inherit: a Platform Administrator manages users but neither
 * designs nor reads data by itself. The server enforces every rule; the UI
 * only hides what would be refused. With authentication off everything is allowed;
 * while the auth state is unknown (loading or unreadable) nothing is.
 */
export interface Access {
  /** Whether sign-in is on; false means today's app without any access UI. */
  authentication: boolean
  isPlatformAdmin: boolean
  canCreateOntology: boolean
  /** Keys of the ontologies the user administers. */
  adminOntologies: string[]
  /** The Users page: Platform Administrators, and Ontology Administrators for their lenses. */
  canManageUsers: boolean
  /** The Studio of an ontology, its rulesets, rename and delete. */
  canDesign: (ontologyKey: string) => boolean
  canRead: (ontologyKey: string, lensKey: string) => boolean
  /** Start, stage into and submit changesets: Proposers and Writers. */
  canStage: (ontologyKey: string, lensKey: string) => boolean
  /** Write at once and commit changesets: Writers only. */
  canWrite: (ontologyKey: string, lensKey: string) => boolean
}

export const ALLOW_ALL: Access = {
  authentication: false,
  isPlatformAdmin: true,
  canCreateOntology: true,
  adminOntologies: [],
  canManageUsers: false,
  canDesign: () => true,
  canRead: () => true,
  canStage: () => true,
  canWrite: () => true,
}

/**
 * Access from the auth state. Only an answer saying authentication is off
 * allows everything; an unknown state holds no role, like signed out.
 */
export function accessFrom(me: AuthMe | undefined): Access {
  if (me !== undefined && !me.authentication) return ALLOW_ALL
  const assignments = me === undefined || me.user === null ? [] : me.assignments
  const has = (role: Role) => assignments.some((a) => a.role === role)
  const onLens = (o: string, l: string, roles: Role[]) =>
    assignments.some((a) => roles.includes(a.role) && a.ontologyKey === o && a.lensKey === l)
  const adminOntologies = assignments
    .filter((a) => a.role === 'ontology_admin' && a.ontologyKey !== null)
    .map((a) => a.ontologyKey!)
  return {
    authentication: true,
    isPlatformAdmin: has('platform_admin'),
    canCreateOntology: has('ontology_creator'),
    adminOntologies,
    canManageUsers: has('platform_admin') || adminOntologies.length > 0,
    canDesign: (o) => adminOntologies.includes(o),
    canRead: (o, l) => onLens(o, l, LENS_ROLES),
    canStage: (o, l) => onLens(o, l, ['proposer', 'writer']),
    canWrite: (o, l) => onLens(o, l, ['writer']),
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Platform Administrator',
  ontology_creator: 'Ontology Creator',
  ontology_admin: 'Ontology Administrator',
  reader: 'Reader',
  proposer: 'Proposer',
  writer: 'Writer',
}

/** The roles held on one lens, weakest first; one per user and lens. */
export const LENS_ROLES: Role[] = ['reader', 'proposer', 'writer']

/** What a role is held on: the platform, one ontology, or one lens. */
export function roleScope(role: Role): 'platform' | 'ontology' | 'lens' {
  if (LENS_ROLES.includes(role)) return 'lens'
  return role === 'ontology_admin' ? 'ontology' : 'platform'
}

/** Platform Administrators grant every role; Ontology Administrators the lens roles. */
export function grantableRoles(access: Access): Role[] {
  if (access.isPlatformAdmin) return Object.keys(ROLE_LABELS) as Role[]
  return access.adminOntologies.length > 0 ? LENS_ROLES : []
}

/**
 * Whether the Explorer offers its connecting drag: it writes live only,
 * so a Writer while no changeset is pinned; never a Proposer, whose
 * writes can only be staged.
 */
export function canConnectLive(access: Access, ontologyKey: string, lensKey: string, pinned: string | null): boolean {
  return pinned === null && access.canWrite(ontologyKey, lensKey)
}

/** Removing takes the same right as granting. */
export function canRemoveAssignment(access: Access, assignment: Assignment): boolean {
  if (access.isPlatformAdmin) return true
  return (
    roleScope(assignment.role) === 'lens' &&
    assignment.ontologyKey !== null &&
    access.canDesign(assignment.ontologyKey)
  )
}

/** Where an assignment applies, in words: nothing, an ontology key, or `ontology / lens`. */
export function assignmentTarget(assignment: Assignment): string {
  if (assignment.ontologyKey === null) return ''
  return assignment.lensKey === null
    ? assignment.ontologyKey
    : `${assignment.ontologyKey} / ${assignment.lensKey}`
}

/**
 * An ontology's access list split for the Access page: its administrators,
 * and the lens role assignments per lens key, each sorted by user name.
 */
export function groupAccess(assignments: readonly AccessAssignment[]): {
  admins: AccessAssignment[]
  byLens: Map<string, AccessAssignment[]>
} {
  const byName = (a: AccessAssignment, b: AccessAssignment) =>
    a.user.displayName.localeCompare(b.user.displayName)
  const admins = assignments.filter((a) => a.role === 'ontology_admin').sort(byName)
  const byLens = new Map<string, AccessAssignment[]>()
  for (const a of assignments) {
    if (roleScope(a.role) !== 'lens' || a.lensKey === null) continue
    byLens.set(a.lensKey, [...(byLens.get(a.lensKey) ?? []), a])
  }
  for (const list of byLens.values()) list.sort(byName)
  return { admins, byLens }
}
