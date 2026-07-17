/**
 * Modeling API client — `/api/model/...`, addressed by UUID
 * (`ontologyId`, `entityTypeId`, `relationTypeId`, `propertyId`).
 */

import { buildQuery, request } from './http'
import type {
  AiAgent,
  AiAgentInput,
  EntityType,
  EntityTypeInput,
  JsonValue,
  Ontology,
  OntologyInput,
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

/* --------------------------------- ontologies -------------------------------- */

export const listOntologies = () => request<Ontology[]>(`${BASE}/ontologies`)

export const createOntology = (body: OntologyInput) =>
  request<Ontology>(`${BASE}/ontologies`, { method: 'POST', body })

export const getOntology = (ontologyId: string) =>
  request<Ontology>(`${BASE}/ontologies/${ontologyId}`)

export const updateOntology = (ontologyId: string, body: OntologyInput) =>
  request<Ontology>(`${BASE}/ontologies/${ontologyId}`, { method: 'PUT', body })

export const deleteOntology = (ontologyId: string) =>
  request<undefined>(`${BASE}/ontologies/${ontologyId}`, { method: 'DELETE' })

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

export const listScopeEntityTypes = (ontologyId: string) =>
  request<ScopeInclude[]>(`${BASE}/ontologies/${ontologyId}/includes/entity-types`)

export const addScopeEntityType = (ontologyId: string, body: ScopeInclude) =>
  request<ScopeInclude>(`${BASE}/ontologies/${ontologyId}/includes/entity-types`, {
    method: 'POST',
    body,
  })

export const updateScopeEntityType = (
  ontologyId: string,
  entityTypeId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(
    `${BASE}/ontologies/${ontologyId}/includes/entity-types/${entityTypeId}`,
    { method: 'PUT', body },
  )

export const removeScopeEntityType = (ontologyId: string, entityTypeId: string) =>
  request<undefined>(
    `${BASE}/ontologies/${ontologyId}/includes/entity-types/${entityTypeId}`,
    { method: 'DELETE' },
  )

export const listScopeRelationTypes = (ontologyId: string) =>
  request<ScopeInclude[]>(`${BASE}/ontologies/${ontologyId}/includes/relation-types`)

export const addScopeRelationType = (ontologyId: string, body: ScopeInclude) =>
  request<ScopeInclude>(`${BASE}/ontologies/${ontologyId}/includes/relation-types`, {
    method: 'POST',
    body,
  })

export const updateScopeRelationType = (
  ontologyId: string,
  relationTypeId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(
    `${BASE}/ontologies/${ontologyId}/includes/relation-types/${relationTypeId}`,
    { method: 'PUT', body },
  )

export const removeScopeRelationType = (ontologyId: string, relationTypeId: string) =>
  request<undefined>(
    `${BASE}/ontologies/${ontologyId}/includes/relation-types/${relationTypeId}`,
    { method: 'DELETE' },
  )

/* --------------------------------- validation -------------------------------- */

export const validateOntology = (ontologyId: string) =>
  request<ValidationResult>(`${BASE}/ontologies/${ontologyId}/validate`, {
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
/* Unlike the routes above, ai-agent and saved-query routes address the ontology
   by its KEY, not its UUID. */

export const listAiAgents = (ontologyKey: string) =>
  request<AiAgent[]>(`${BASE}/ontologies/${ontologyKey}/ai-agents`)

/** Upsert — 201 created / 200 updated. */
export const upsertAiAgent = (
  ontologyKey: string,
  agentKey: string,
  body: AiAgentInput,
) =>
  request<AiAgent>(`${BASE}/ontologies/${ontologyKey}/ai-agents/${agentKey}`, {
    method: 'PUT',
    body,
  })

export const deleteAiAgent = (ontologyKey: string, agentKey: string) =>
  request<undefined>(`${BASE}/ontologies/${ontologyKey}/ai-agents/${agentKey}`, {
    method: 'DELETE',
  })

/* -------------------------------- saved queries ------------------------------ */

export const listSavedQueries = (ontologyKey: string) =>
  request<SavedQuery[]>(`${BASE}/ontologies/${ontologyKey}/saved-queries`)

/** Upsert — 201 created / 200 updated. */
export const upsertSavedQuery = (
  ontologyKey: string,
  queryKey: string,
  body: SavedQueryInput,
) =>
  request<SavedQuery>(`${BASE}/ontologies/${ontologyKey}/saved-queries/${queryKey}`, {
    method: 'PUT',
    body,
  })

export const deleteSavedQuery = (ontologyKey: string, queryKey: string) =>
  request<undefined>(`${BASE}/ontologies/${ontologyKey}/saved-queries/${queryKey}`, {
    method: 'DELETE',
  })
