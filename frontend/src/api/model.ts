/**
 * Modeling API client — `/api/ontologies/{ontologyKey}/model/...`. The
 * ontology is addressed by KEY; within it, lenses, types and properties
 * by UUID (`lensId`, `entityTypeId`, `relationTypeId`, `propertyId`).
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

const base = (ontologyKey: string) => `/api/ontologies/${ontologyKey}/model`

/* --------------------------------- lenses -------------------------------- */

export const listLenses = (ontologyKey: string) =>
  request<Lens[]>(`${base(ontologyKey)}/lenses`)

export const createLens = (ontologyKey: string, body: LensInput) =>
  request<Lens>(`${base(ontologyKey)}/lenses`, { method: 'POST', body })

export const getLens = (ontologyKey: string, lensId: string) =>
  request<Lens>(`${base(ontologyKey)}/lenses/${lensId}`)

export const updateLens = (ontologyKey: string, lensId: string, body: LensInput) =>
  request<Lens>(`${base(ontologyKey)}/lenses/${lensId}`, { method: 'PUT', body })

export const deleteLens = (ontologyKey: string, lensId: string) =>
  request<undefined>(`${base(ontologyKey)}/lenses/${lensId}`, { method: 'DELETE' })

/* -------------------------------- entity types ------------------------------- */

export const listEntityTypes = (ontologyKey: string) =>
  request<EntityType[]>(`${base(ontologyKey)}/entity-types`)

export const createEntityType = (ontologyKey: string, body: EntityTypeInput) =>
  request<EntityType>(`${base(ontologyKey)}/entity-types`, { method: 'POST', body })

export const getEntityType = (ontologyKey: string, entityTypeId: string) =>
  request<EntityType>(`${base(ontologyKey)}/entity-types/${entityTypeId}`)

export const updateEntityType = (
  ontologyKey: string,
  entityTypeId: string,
  body: EntityTypeInput,
) =>
  request<EntityType>(`${base(ontologyKey)}/entity-types/${entityTypeId}`, {
    method: 'PUT',
    body,
  })

/** Without `cascade`, a needed cascade → 409 CASCADE_REQUIRED. */
export const deleteEntityType = (
  ontologyKey: string,
  entityTypeId: string,
  cascade = false,
) =>
  request<undefined>(
    `${base(ontologyKey)}/entity-types/${entityTypeId}${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'DELETE' },
  )

/* ------------------------------- relation types ------------------------------ */

export const listRelationTypes = (ontologyKey: string) =>
  request<RelationType[]>(`${base(ontologyKey)}/relation-types`)

export const createRelationType = (ontologyKey: string, body: RelationTypeInput) =>
  request<RelationType>(`${base(ontologyKey)}/relation-types`, {
    method: 'POST',
    body,
  })

export const getRelationType = (ontologyKey: string, relationTypeId: string) =>
  request<RelationType>(`${base(ontologyKey)}/relation-types/${relationTypeId}`)

export const updateRelationType = (
  ontologyKey: string,
  relationTypeId: string,
  body: RelationTypeInput,
) =>
  request<RelationType>(`${base(ontologyKey)}/relation-types/${relationTypeId}`, {
    method: 'PUT',
    body,
  })

export const deleteRelationType = (
  ontologyKey: string,
  relationTypeId: string,
  cascade = false,
) =>
  request<undefined>(
    `${base(ontologyKey)}/relation-types/${relationTypeId}${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'DELETE' },
  )

/* --------------------------------- properties -------------------------------- */
/* Nested under both entity types and relation types. */

type TypeKind = 'entity-types' | 'relation-types'

export const listProperties = (ontologyKey: string, kind: TypeKind, typeId: string) =>
  request<PropertyDefinition[]>(`${base(ontologyKey)}/${kind}/${typeId}/properties`)

export const createProperty = (
  ontologyKey: string,
  kind: TypeKind,
  typeId: string,
  body: PropertyInput,
  cascade = false,
) =>
  request<PropertyDefinition>(
    `${base(ontologyKey)}/${kind}/${typeId}/properties${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'POST', body },
  )

export const updateProperty = (
  ontologyKey: string,
  kind: TypeKind,
  typeId: string,
  propertyId: string,
  body: PropertyInput,
) =>
  request<PropertyDefinition>(
    `${base(ontologyKey)}/${kind}/${typeId}/properties/${propertyId}`,
    { method: 'PUT', body },
  )

export const deleteProperty = (
  ontologyKey: string,
  kind: TypeKind,
  typeId: string,
  propertyId: string,
  cascade = false,
) =>
  request<undefined>(
    `${base(ontologyKey)}/${kind}/${typeId}/properties/${propertyId}${buildQuery(cascade ? { cascade } : undefined)}`,
    { method: 'DELETE' },
  )

/* ------------------------------ scope (includes) ----------------------------- */

export const listScopeEntityTypes = (ontologyKey: string, lensId: string) =>
  request<ScopeInclude[]>(`${base(ontologyKey)}/lenses/${lensId}/includes/entity-types`)

export const addScopeEntityType = (
  ontologyKey: string,
  lensId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(`${base(ontologyKey)}/lenses/${lensId}/includes/entity-types`, {
    method: 'POST',
    body,
  })

export const updateScopeEntityType = (
  ontologyKey: string,
  lensId: string,
  entityTypeId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(
    `${base(ontologyKey)}/lenses/${lensId}/includes/entity-types/${entityTypeId}`,
    { method: 'PUT', body },
  )

export const removeScopeEntityType = (
  ontologyKey: string,
  lensId: string,
  entityTypeId: string,
) =>
  request<undefined>(
    `${base(ontologyKey)}/lenses/${lensId}/includes/entity-types/${entityTypeId}`,
    { method: 'DELETE' },
  )

export const listScopeRelationTypes = (ontologyKey: string, lensId: string) =>
  request<ScopeInclude[]>(
    `${base(ontologyKey)}/lenses/${lensId}/includes/relation-types`,
  )

export const addScopeRelationType = (
  ontologyKey: string,
  lensId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(`${base(ontologyKey)}/lenses/${lensId}/includes/relation-types`, {
    method: 'POST',
    body,
  })

export const updateScopeRelationType = (
  ontologyKey: string,
  lensId: string,
  relationTypeId: string,
  body: ScopeInclude,
) =>
  request<ScopeInclude>(
    `${base(ontologyKey)}/lenses/${lensId}/includes/relation-types/${relationTypeId}`,
    { method: 'PUT', body },
  )

export const removeScopeRelationType = (
  ontologyKey: string,
  lensId: string,
  relationTypeId: string,
) =>
  request<undefined>(
    `${base(ontologyKey)}/lenses/${lensId}/includes/relation-types/${relationTypeId}`,
    { method: 'DELETE' },
  )

/* --------------------------------- validation -------------------------------- */

export const validateLens = (ontologyKey: string, lensId: string) =>
  request<ValidationResult>(`${base(ontologyKey)}/lenses/${lensId}/validate`, {
    method: 'POST',
  })

export const validateSchema = (ontologyKey: string) =>
  request<ValidationResult>(`${base(ontologyKey)}/schema/validate`, { method: 'POST' })

/* ---------------------------------- transfer --------------------------------- */

export const exportSchema = (ontologyKey: string) =>
  request<Record<string, JsonValue>>(`${base(ontologyKey)}/export`)

/** 201 on success; RESOURCE_CONFLICT on clash. */
export const importSchema = (ontologyKey: string, data: Record<string, JsonValue>) =>
  request<Record<string, JsonValue>>(`${base(ontologyKey)}/import`, {
    method: 'POST',
    body: data,
  })

export const rebuildEmbeddings = (ontologyKey: string) =>
  request<Record<string, JsonValue>>(`${base(ontologyKey)}/rebuild-embeddings`, {
    method: 'POST',
  })

/* ---------------------------------- AI agents -------------------------------- */
/* Unlike the routes above, ai-agent and saved-query routes address the lens
   by its KEY, not its UUID. */

export const listAiAgents = (ontologyKey: string, lensKey: string) =>
  request<AiAgent[]>(`${base(ontologyKey)}/lenses/${lensKey}/ai-agents`)

/** Upsert — 201 created / 200 updated. */
export const upsertAiAgent = (
  ontologyKey: string,
  lensKey: string,
  agentKey: string,
  body: AiAgentInput,
) =>
  request<AiAgent>(`${base(ontologyKey)}/lenses/${lensKey}/ai-agents/${agentKey}`, {
    method: 'PUT',
    body,
  })

export const deleteAiAgent = (ontologyKey: string, lensKey: string, agentKey: string) =>
  request<undefined>(`${base(ontologyKey)}/lenses/${lensKey}/ai-agents/${agentKey}`, {
    method: 'DELETE',
  })

/* -------------------------------- saved queries ------------------------------ */

export const listSavedQueries = (ontologyKey: string, lensKey: string) =>
  request<SavedQuery[]>(`${base(ontologyKey)}/lenses/${lensKey}/saved-queries`)

/** Upsert — 201 created / 200 updated. */
export const upsertSavedQuery = (
  ontologyKey: string,
  lensKey: string,
  queryKey: string,
  body: SavedQueryInput,
) =>
  request<SavedQuery>(
    `${base(ontologyKey)}/lenses/${lensKey}/saved-queries/${queryKey}`,
    { method: 'PUT', body },
  )

export const deleteSavedQuery = (
  ontologyKey: string,
  lensKey: string,
  queryKey: string,
) =>
  request<undefined>(
    `${base(ontologyKey)}/lenses/${lensKey}/saved-queries/${queryKey}`,
    { method: 'DELETE' },
  )
