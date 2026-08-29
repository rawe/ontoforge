/**
 * Modeling API client — `/api/model/...`, addressed by UUID
 * (`lensId`, `entityTypeId`, `relationTypeId`, `propertyId`).
 */

import { buildQuery, request } from './http'
import type {
  AiAgent,
  AiAgentInput,
  EntityType,
  EntityTypeInput,
  JsonValue,
  Lens,
  LensInput,
  PropertyDefinition,
  PropertyInput,
  RelationType,
  RelationTypeInput,
  SavedQuery,
  SavedQueryInput,
  ScopeInclude,
  ValidationResult,
} from './types'

const BASE = '/api/model'

/* --------------------------------- lenses -------------------------------- */

export const listLenses = () => request<Lens[]>(`${BASE}/lenses`)

export const createLens = (body: LensInput) =>
  request<Lens>(`${BASE}/lenses`, { method: 'POST', body })

export const getLens = (lensId: string) =>
  request<Lens>(`${BASE}/lenses/${lensId}`)

export const updateLens = (lensId: string, body: LensInput) =>
  request<Lens>(`${BASE}/lenses/${lensId}`, { method: 'PUT', body })

export const deleteLens = (lensId: string) =>
  request<undefined>(`${BASE}/lenses/${lensId}`, { method: 'DELETE' })

/* -------------------------------- entity types ------------------------------- */

export const listEntityTypes = () => request<EntityType[]>(`${BASE}/entity-types`)

export const createEntityType = (body: EntityTypeInput) =>
  request<EntityType>(`${BASE}/entity-types`, { method: 'POST', body })

export const getEntityType = (entityTypeId: string) =>
  request<EntityType>(`${BASE}/entity-types/${entityTypeId}`)

export const updateEntityType = (entityTypeId: string, body: EntityTypeInput) =>
  request<EntityType>(`${BASE}/entity-types/${entityTypeId}`, { method: 'PUT', body })

/** Without `cascade`, a needed cascade → 409 CASCADE_REQUIRED. */
export const deleteEntityType = (entityTypeId: string, cascade = false) =>
  request<undefined>(
    `${BASE}/entity-types/${entityTypeId}${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'DELETE' },
  )

/* ------------------------------- relation types ------------------------------ */

export const listRelationTypes = () => request<RelationType[]>(`${BASE}/relation-types`)

export const createRelationType = (body: RelationTypeInput) =>
  request<RelationType>(`${BASE}/relation-types`, { method: 'POST', body })

export const getRelationType = (relationTypeId: string) =>
  request<RelationType>(`${BASE}/relation-types/${relationTypeId}`)

export const updateRelationType = (relationTypeId: string, body: RelationTypeInput) =>
  request<RelationType>(`${BASE}/relation-types/${relationTypeId}`, {
    method: 'PUT',
    body,
  })

export const deleteRelationType = (relationTypeId: string, cascade = false) =>
  request<undefined>(
    `${BASE}/relation-types/${relationTypeId}${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'DELETE' },
  )

/* --------------------------------- properties -------------------------------- */
/* Nested under both entity types and relation types. */

type TypeKind = 'entity-types' | 'relation-types'

export const listProperties = (kind: TypeKind, typeId: string) =>
  request<PropertyDefinition[]>(`${BASE}/${kind}/${typeId}/properties`)

export const createProperty = (
  kind: TypeKind,
  typeId: string,
  body: PropertyInput,
  cascade = false,
) =>
  request<PropertyDefinition>(
    `${BASE}/${kind}/${typeId}/properties${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'POST', body },
  )

export const updateProperty = (
  kind: TypeKind,
  typeId: string,
  propertyId: string,
  body: PropertyInput,
) =>
  request<PropertyDefinition>(`${BASE}/${kind}/${typeId}/properties/${propertyId}`, {
    method: 'PUT',
    body,
  })

export const deleteProperty = (
  kind: TypeKind,
  typeId: string,
  propertyId: string,
  cascade = false,
) =>
  request<undefined>(
    `${BASE}/${kind}/${typeId}/properties/${propertyId}${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'DELETE' },
  )

/* ------------------------------ scope (includes) ----------------------------- */

export const listScopeEntityTypes = (lensId: string) =>
  request<ScopeInclude[]>(`${BASE}/lenses/${lensId}/includes/entity-types`)

export const addScopeEntityType = (lensId: string, body: ScopeInclude) =>
  request<ScopeInclude>(`${BASE}/lenses/${lensId}/includes/entity-types`, {
    method: 'POST',
    body,
  })

export const updateScopeEntityType = (
  lensId: string,
  entityTypeId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(
    `${BASE}/lenses/${lensId}/includes/entity-types/${entityTypeId}`,
    { method: 'PUT', body },
  )

export const removeScopeEntityType = (lensId: string, entityTypeId: string) =>
  request<undefined>(
    `${BASE}/lenses/${lensId}/includes/entity-types/${entityTypeId}`,
    { method: 'DELETE' },
  )

export const listScopeRelationTypes = (lensId: string) =>
  request<ScopeInclude[]>(`${BASE}/lenses/${lensId}/includes/relation-types`)

export const addScopeRelationType = (lensId: string, body: ScopeInclude) =>
  request<ScopeInclude>(`${BASE}/lenses/${lensId}/includes/relation-types`, {
    method: 'POST',
    body,
  })

export const updateScopeRelationType = (
  lensId: string,
  relationTypeId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(
    `${BASE}/lenses/${lensId}/includes/relation-types/${relationTypeId}`,
    { method: 'PUT', body },
  )

export const removeScopeRelationType = (lensId: string, relationTypeId: string) =>
  request<undefined>(
    `${BASE}/lenses/${lensId}/includes/relation-types/${relationTypeId}`,
    { method: 'DELETE' },
  )

/* --------------------------------- validation -------------------------------- */

export const validateLens = (lensId: string) =>
  request<ValidationResult>(`${BASE}/lenses/${lensId}/validate`, {
    method: 'POST',
  })

export const validateSchema = () =>
  request<ValidationResult>(`${BASE}/schema/validate`, { method: 'POST' })

/* ---------------------------------- transfer --------------------------------- */

export const exportSchema = () => request<Record<string, JsonValue>>(`${BASE}/export`)

/** 201 on success; RESOURCE_CONFLICT on clash. */
export const importSchema = (data: Record<string, JsonValue>) =>
  request<Record<string, JsonValue>>(`${BASE}/import`, { method: 'POST', body: data })

export const rebuildEmbeddings = () =>
  request<Record<string, JsonValue>>(`${BASE}/rebuild-embeddings`, { method: 'POST' })

/* ---------------------------------- AI agents -------------------------------- */
/* Unlike the routes above, ai-agent and saved-query routes address the lens
   by its KEY, not its UUID. */

export const listAiAgents = (lensKey: string) =>
  request<AiAgent[]>(`${BASE}/lenses/${lensKey}/ai-agents`)

/** Upsert — 201 created / 200 updated. */
export const upsertAiAgent = (
  lensKey: string,
  agentKey: string,
  body: AiAgentInput,
) =>
  request<AiAgent>(`${BASE}/lenses/${lensKey}/ai-agents/${agentKey}`, {
    method: 'PUT',
    body,
  })

export const deleteAiAgent = (lensKey: string, agentKey: string) =>
  request<undefined>(`${BASE}/lenses/${lensKey}/ai-agents/${agentKey}`, {
    method: 'DELETE',
  })

/* -------------------------------- saved queries ------------------------------ */

export const listSavedQueries = (lensKey: string) =>
  request<SavedQuery[]>(`${BASE}/lenses/${lensKey}/saved-queries`)

/** Upsert — 201 created / 200 updated. */
export const upsertSavedQuery = (
  lensKey: string,
  queryKey: string,
  body: SavedQueryInput,
) =>
  request<SavedQuery>(`${BASE}/lenses/${lensKey}/saved-queries/${queryKey}`, {
    method: 'PUT',
    body,
  })

export const deleteSavedQuery = (lensKey: string, queryKey: string) =>
  request<undefined>(`${BASE}/lenses/${lensKey}/saved-queries/${queryKey}`, {
    method: 'DELETE',
  })
