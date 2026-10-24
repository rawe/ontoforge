import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AccessAssignment, Assignment, AuthMe, Role, User } from '../src/api/types.ts'
import {
  accessFrom,
  assignmentTarget,
  canRemoveAssignment,
  grantableRoles,
  groupAccess,
} from '../src/lib/access.ts'

const user: User = {
  id: 'u1',
  kind: 'user',
  displayName: 'Ada',
  email: null,
  username: 'ada',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
}

let next = 0
function assignment(role: Role, ontologyKey: string | null = null, lensKey: string | null = null): Assignment {
  next += 1
  return { id: `a${next}`, role, ontologyKey, lensKey, ontologyId: null, lensId: null, createdAt: '' }
}

const signedIn = (...assignments: Assignment[]): AuthMe => ({ authentication: true, user, assignments })

test('authentication off allows everything and shows no access UI', () => {
  const access = accessFrom({ authentication: false })
  assert.equal(access.authentication, false)
  assert.equal(access.canDesign('any'), true)
  assert.equal(access.canWrite('any', 'lens'), true)
  assert.equal(access.canCreateOntology, true)
  assert.equal(access.canManageUsers, false)
})

test('an unknown auth state (loading or unreadable) allows nothing', () => {
  const access = accessFrom(undefined)
  assert.equal(access.authentication, true)
  assert.equal(access.isPlatformAdmin, false)
  assert.equal(access.canDesign('any'), false)
  assert.equal(access.canRead('any', 'lens'), false)
  assert.equal(access.canWrite('any', 'lens'), false)
  assert.equal(access.canCreateOntology, false)
  assert.equal(access.canManageUsers, false)
})

test('a Writer reads and writes its lens only; a Reader only reads', () => {
  const access = accessFrom(signedIn(assignment('writer', 'o', 'main'), assignment('reader', 'o', 'side')))
  assert.equal(access.canWrite('o', 'main'), true)
  assert.equal(access.canRead('o', 'side'), true)
  assert.equal(access.canWrite('o', 'side'), false)
  assert.equal(access.canRead('other', 'main'), false)
  assert.equal(access.canDesign('o'), false)
  assert.equal(access.canManageUsers, false)
})

test('roles do not inherit: a Platform Administrator neither designs nor reads data', () => {
  const access = accessFrom(signedIn(assignment('platform_admin')))
  assert.equal(access.isPlatformAdmin, true)
  assert.equal(access.canManageUsers, true)
  assert.equal(access.canDesign('o'), false)
  assert.equal(access.canRead('o', 'main'), false)
  assert.equal(access.canCreateOntology, false)
  assert.equal(grantableRoles(access).length, 5)
})

test('an Ontology Administrator designs its ontology and grants Reader/Writer on it', () => {
  const access = accessFrom(signedIn(assignment('ontology_admin', 'o')))
  assert.equal(access.canDesign('o'), true)
  assert.equal(access.canDesign('p'), false)
  assert.equal(access.canRead('o', 'main'), false)
  assert.equal(access.canManageUsers, true)
  assert.deepEqual(access.adminOntologies, ['o'])
  assert.deepEqual(grantableRoles(access), ['reader', 'writer'])
  assert.equal(canRemoveAssignment(access, assignment('reader', 'o', 'main')), true)
  assert.equal(canRemoveAssignment(access, assignment('writer', 'p', 'main')), false)
  assert.equal(canRemoveAssignment(access, assignment('ontology_admin', 'o')), false)
})

test('signed out holds no role', () => {
  const access = accessFrom({ authentication: true, user: null, assignments: [] })
  assert.equal(access.authentication, true)
  assert.equal(access.canRead('o', 'main'), false)
  assert.equal(access.canCreateOntology, false)
})

test('assignmentTarget names the ontology and lens an assignment applies to', () => {
  assert.equal(assignmentTarget(assignment('platform_admin')), '')
  assert.equal(assignmentTarget(assignment('ontology_admin', 'o')), 'o')
  assert.equal(assignmentTarget(assignment('reader', 'o', 'main')), 'o / main')
})

test('groupAccess splits administrators from lens roles, sorted by name', () => {
  const bob = { ...user, id: 'u2', displayName: 'Bob' }
  const rows: AccessAssignment[] = [
    { ...assignment('writer', 'o', 'main'), user: bob },
    { ...assignment('reader', 'o', 'main'), user },
    { ...assignment('ontology_admin', 'o'), user: bob },
    { ...assignment('reader', 'o', 'side'), user: bob },
  ]
  const { admins, byLens } = groupAccess(rows)
  assert.deepEqual(admins.map((a) => a.user.displayName), ['Bob'])
  assert.deepEqual(byLens.get('main')?.map((a) => a.user.displayName), ['Ada', 'Bob'])
  assert.deepEqual(byLens.get('side')?.map((a) => a.role), ['reader'])
})
