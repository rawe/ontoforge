/**
 * User management API client — `/api/users` and an ontology's access list.
 * Only with authentication on; with it off these answer 404.
 */

import { buildQuery, request } from './http'
import type { AccessAssignment, Assignment, AssignmentInput, User, UserDetail } from './types'

export const listUsers = (params: { search?: string; limit?: number; offset?: number }) =>
  request<{ items: User[]; total: number }>(`/api/users${buildQuery(params)}`)

/** Admits a service principal by its subject at the identity provider; 409 when the subject is taken. */
export const createServiceUser = (body: { displayName: string; subject: string }) =>
  request<User>('/api/users', { method: 'POST', body: { kind: 'service', ...body } })

/** An ontology administrator sees only the assignments within its ontologies. */
export const getUser = (userId: string) =>
  request<UserDetail>(`/api/users/${encodeURIComponent(userId)}`)

export const setUserStatus = (userId: string, status: User['status']) =>
  request<User>(`/api/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: { status },
  })

/** The lens roles on one lens replace each other. */
export const addAssignment = (userId: string, body: AssignmentInput) =>
  request<Assignment>(`/api/users/${encodeURIComponent(userId)}/assignments`, {
    method: 'POST',
    body,
  })

export const removeAssignment = (userId: string, assignmentId: string) =>
  request<undefined>(
    `/api/users/${encodeURIComponent(userId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'DELETE' },
  )

/** Every assignment within one ontology, with its holder. */
export const listOntologyAccess = (ontologyKey: string) =>
  request<{ assignments: AccessAssignment[] }>(
    `/api/ontologies/${encodeURIComponent(ontologyKey)}/access`,
  )
